import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  COLECAO_ENTREGAS,
  COLECAO_OUTBOX,
  idDaEntrega,
  limparEntregasAntigas,
  processarEntregas,
  publicarEEntregar,
  publicarPush,
  situacaoDoPush,
  type Dependencias,
  type EspecPush,
  type MensagemDeLote,
} from "./notification-outbox";
import { interpretarPreferencias, type LeituraDePreferencias } from "./domain/notification-preferences";
import type { AcessoDoDestinatario } from "./domain/notificacao-publico";
import type { RespostaDeEnvio } from "./domain/push-envio";
import type { SalePushPayload } from "./domain/notifications";
import { ORCAMENTO_DATA_BYTES, tamanhoDoData } from "./domain/push-payload";

/**
 * O outbox contra o emulador do Firestore, com o FCM SIMULADO.
 *
 * O Firestore é de verdade — é ele que faz a concessão funcionar sob
 * concorrência, e isso não se prova com mock. O FCM é simulado porque o que se
 * quer provar é o comportamento diante de falhas (parcial, lote inteiro,
 * resposta incompleta), que o FCM real não produz sob demanda. NADA aqui fala
 * com o FCM de verdade nem com produção.
 */

let db: Firestore;
const T0 = 1_800_000_000_000;
const HORA = 3600_000;

const DONO = "dono@zxp.com";
const MEMBRO = "membro@zxp.com";

type Chamada = MensagemDeLote;

type Cenario = {
  relogio: { agora: number };
  chamadas: Chamada[];
  /** O que o FCM simulado responde por token; padrão: aceita. */
  respostas: Map<string, RespostaDeEnvio>;
  acessos: Map<string, AcessoDoDestinatario>;
  prefs: Map<string, LeituraDePreferencias>;
  /** Faz o envio inteiro lançar (rede caiu). */
  falharEnvio: boolean;
  /** Devolve menos respostas do que tokens. */
  respostaIncompleta: boolean;
  deps: Dependencias;
};

function novoCenario(over: Partial<Pick<Dependencias, "aleatorio">> = {}): Cenario {
  const c = {
    relogio: { agora: T0 },
    chamadas: [] as Chamada[],
    respostas: new Map<string, RespostaDeEnvio>(),
    acessos: new Map<string, AcessoDoDestinatario>([
      [DONO, { papel: "owner", permissoesEdicao: [] }],
      [MEMBRO, { papel: "member", permissoesEdicao: [] }],
    ]),
    prefs: new Map<string, LeituraDePreferencias>(),
    falharEnvio: false,
    respostaIncompleta: false,
  } as Cenario;
  let seq = 0;
  c.deps = {
    db,
    agora: () => c.relogio.agora,
    aleatorio: over.aleatorio ?? (() => 0.5),
    novoLeaseId: () => `lease-${++seq}-${Math.random().toString(36).slice(2, 8)}`,
    enviarLote: async (m) => {
      c.chamadas.push(m);
      if (c.falharEnvio) throw new Error("rede caiu");
      const respostas = m.tokens.map((t) => c.respostas.get(t) ?? { success: true, messageId: `msg-${t}` });
      return c.respostaIncompleta ? respostas.slice(0, Math.max(0, respostas.length - 1)) : respostas;
    },
    lerAcessos: async () => c.acessos,
    lerPreferencias: async (email) => c.prefs.get(email) ?? interpretarPreferencias(undefined),
  };
  return c;
}

const payload = (over: Partial<SalePushPayload> = {}): SalePushPayload => ({
  eventId: "sale_paid:2000123456", type: "sale_paid", title: "Nova venda confirmada", body: "Menta Stronger · R$ 129,90",
  tag: "sale-2000123456", orderId: "2000123456", deepLink: "/?tab=pedidos&order=2000123456",
  productName: "Menta Stronger", grossAmount: "129.90", estimatedProfit: "32.10", estimatedMargin: "24.7",
  financialState: "estimated", timestamp: "2026-09-20T12:00:00.000Z", ...over,
});

const spec = (over: Partial<EspecPush> = {}): EspecPush => ({
  pushId: "sale_paid:2000123456", eventId: "sale_paid:2000123456", type: "sale_paid", payload: payload(), origem: "teste", ...over,
});

async function registrar(email: string, deviceId: string, token: string): Promise<string> {
  const id = `${email}__${deviceId}`;
  await db.collection("pushTokens").doc(id).set({ email, deviceId, token, updatedAt: T0 });
  return id;
}

async function limpar() {
  for (const col of ["pushTokens", COLECAO_OUTBOX, COLECAO_ENTREGAS, "notification_events", "controleAcesso"]) {
    const snap = await db.collection(col).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const lote = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
  }
}

async function entregas(pushId = "sale_paid:2000123456") {
  const snap = await db.collection(COLECAO_ENTREGAS).where("pushId", "==", pushId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Record<string, unknown> & { id: string })[];
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "outbox-teste") ?? initializeApp({ projectId: "zxp-teste-outbox" }, "outbox-teste");
  db = getFirestore(app);
});
beforeEach(limpar);
afterAll(async () => { await db?.terminate(); });

describe("publicar", () => {
  it("cria um destino por aparelho, todos pendentes e devidos", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-dono-1");
    await registrar(DONO, "dev-2", "tok-dono-2");
    await registrar(MEMBRO, "dev-3", "tok-membro");
    const r = await publicarPush(c.deps, spec());
    expect(r).toMatchObject({ criado: true, destinos: 3, concluido: false });
    const e = await entregas();
    expect(e).toHaveLength(3);
    expect(e.every((x) => x.status === "pending" && x.proximaTentativaEm === T0)).toBe(true);
  });

  it("publicar de novo NÃO duplica destinos", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    const r = await publicarPush(c.deps, spec());
    expect(r.criado).toBe(false);
    expect(await entregas()).toHaveLength(1);
  });

  it("dois publicadores ao mesmo tempo terminam com um destino por aparelho", async () => {
    const c = novoCenario();
    for (let i = 0; i < 5; i++) await registrar(DONO, `dev-${i}`, `tok-${i}`);
    await Promise.all(Array.from({ length: 8 }, () => publicarPush(c.deps, spec())));
    expect(await entregas()).toHaveLength(5);
  });

  it("fan-out que ficou pela metade é completado pela varredura", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    // Simula o processo que morreu entre criar o push e criar os destinos.
    await db.collection(COLECAO_OUTBOX).doc("sale_paid:2000123456").set({
      pushId: "sale_paid:2000123456", eventId: "sale_paid:2000123456", type: "sale_paid", isSummary: false,
      payloadJson: JSON.stringify(payload()), audiencia: null, criadoEm: T0, expiraEm: T0 + 6 * HORA,
      origem: "teste", atualizaEvento: false, fanoutPendente: true,
    });
    expect(await entregas()).toHaveLength(0);
    const r = await processarEntregas(c.deps);
    // A varredura completa o fan-out e, no mesmo passe, já enxerga e envia os destinos novos.
    expect(r.aceitas).toBe(1);
    expect(await entregas()).toHaveLength(1);
    expect((await db.collection(COLECAO_OUTBOX).doc("sale_paid:2000123456").get()).data()?.fanoutPendente).toBe(false);
    expect((await processarEntregas(c.deps)).aceitas).toBe(0);
  });

  it("audiência: só as pessoas listadas viram destino", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-dono");
    await registrar(MEMBRO, "dev-2", "tok-membro");
    await publicarPush(c.deps, spec({ audiencia: [MEMBRO] }));
    const e = await entregas();
    expect(e).toHaveLength(1);
    expect(e[0].email).toBe(MEMBRO);
  });
});

describe("CONCORRÊNCIA: 20 workers, cada destino sai UMA vez", () => {
  it("20 workers processando o mesmo push enviam cada token exatamente uma vez", async () => {
    const c = novoCenario();
    for (let i = 0; i < 6; i++) await registrar(DONO, `dev-${i}`, `tok-${i}`);
    await publicarPush(c.deps, spec());

    await Promise.all(Array.from({ length: 20 }, () => processarEntregas(c.deps, { pushId: "sale_paid:2000123456" })));

    const porToken = new Map<string, number>();
    for (const ch of c.chamadas) for (const t of ch.tokens) porToken.set(t, (porToken.get(t) ?? 0) + 1);
    expect([...porToken.values()], JSON.stringify([...porToken])).toEqual(Array(6).fill(1));
    expect((await entregas()).every((e) => e.status === "accepted")).toBe(true);
  });

  it("20 workers em varredura geral (sem pushId) também não duplicam", async () => {
    const c = novoCenario();
    for (let i = 0; i < 4; i++) await registrar(DONO, `dev-${i}`, `tok-${i}`);
    await publicarPush(c.deps, spec());
    await Promise.all(Array.from({ length: 20 }, () => processarEntregas(c.deps)));
    const enviados = c.chamadas.flatMap((ch) => ch.tokens);
    expect(enviados.sort()).toEqual(["tok-0", "tok-1", "tok-2", "tok-3"]);
  });
});

describe("concessão vencida e falha depois da aceitação", () => {
  it("worker morreu com a concessão: outro assume quando ela vence, e a tentativa conta", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    const [d] = await entregas();
    // Estado que um worker morto deixa: leased, com concessão que já venceu.
    await db.collection(COLECAO_ENTREGAS).doc(d.id).update({ status: "leased", leaseId: "morto", leaseAte: T0 - 1, tentativas: 1, proximaTentativaEm: T0 - 1 });

    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r.aceitas).toBe(1);
    const [depois] = await entregas();
    expect(depois).toMatchObject({ status: "accepted", tentativas: 2 });
  });

  it("concessão AINDA ATIVA: o outro worker recua e nada é enviado", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    const [d] = await entregas();
    await db.collection(COLECAO_ENTREGAS).doc(d.id).update({ status: "leased", leaseId: "vivo", leaseAte: T0 + 30_000, tentativas: 1, proximaTentativaEm: T0 + 30_000 });
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r.reivindicadas).toBe(0);
    expect(c.chamadas).toHaveLength(0);
  });

  it("FALHA DEPOIS DA ACEITAÇÃO: o resultado não grava; a concessão vence e o destino é reenviado (pelo menos uma vez)", async () => {
    let quebrar = true;
    // O worker aceita no FCM e morre antes de gravar: `aleatorio` é chamado dentro da gravação do resultado.
    const c = novoCenario({ aleatorio: () => { if (quebrar) throw new Error("processo morreu"); return 0.5; } });
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());

    await expect(processarEntregas(c.deps, { pushId: "sale_paid:2000123456" })).rejects.toThrow("processo morreu");
    expect(c.chamadas).toHaveLength(1); // o FCM JÁ aceitou
    const [preso] = await entregas();
    expect(preso.status).toBe("leased"); // e o resultado não foi gravado

    quebrar = false;
    c.relogio.agora = T0 + 61_000; // a concessão venceu
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r.aceitas).toBe(1);
    expect(c.chamadas).toHaveLength(2); // reenviado: é "pelo menos uma vez", e a tag colapsa na tela
    expect((await entregas())[0]).toMatchObject({ status: "accepted", tentativas: 2 });
  });

  it("worker lento cuja concessão foi assumida NÃO sobrescreve o resultado do sucessor", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    const [d] = await entregas();
    const ref = db.collection(COLECAO_ENTREGAS).doc(d.id);

    // Enquanto o worker lento espera o FCM, a concessão dele vence e um sucessor conclui o destino.
    const lento = novoCenario();
    lento.deps.enviarLote = async () => {
      await ref.update({ status: "accepted", leaseId: "sucessor", acceptedByProviderAt: T0 + 5 });
      return [{ success: false, error: { code: "messaging/internal-error" } }];
    };
    const r = await processarEntregas(lento.deps, { pushId: "sale_paid:2000123456" });
    expect(r.concessaoPerdida).toBe(1);
    expect((await entregas())[0]).toMatchObject({ status: "accepted", leaseId: "sucessor" });
  });
});

describe("resultado por destino: 7 aceitos, 2 transitórios, 1 token morto", () => {
  async function montar() {
    const c = novoCenario();
    for (let i = 0; i < 10; i++) await registrar(DONO, `dev-${i}`, `tok-${i}`);
    c.respostas.set("tok-7", { success: false, error: { code: "messaging/internal-error" } });
    c.respostas.set("tok-8", { success: false, error: { code: "messaging/server-unavailable" } });
    c.respostas.set("tok-9", { success: false, error: { code: "messaging/registration-token-not-registered" } });
    await publicarPush(c.deps, spec());
    return c;
  }

  it("primeira passada: 7 aceitos, 2 reagendados, 1 falha permanente — e o token morto sai", async () => {
    const c = await montar();
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r).toMatchObject({ aceitas: 7, reagendadas: 2, falhas: 1 });
    const e = await entregas();
    expect(e.filter((x) => x.status === "accepted")).toHaveLength(7);
    expect(e.filter((x) => x.status === "retry_scheduled")).toHaveLength(2);
    expect(e.find((x) => x.registroDocId === `${DONO}__dev-9`)).toMatchObject({ status: "permanent_failure", motivo: "token_invalido" });
    expect((await db.collection("pushTokens").doc(`${DONO}__dev-9`).get()).exists).toBe(false);
    expect((await db.collection("pushTokens").doc(`${DONO}__dev-0`).get()).exists).toBe(true);
  });

  it("o retry envia SÓ pros 2 pendentes — quem já aceitou não recebe de novo", async () => {
    const c = await montar();
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    c.chamadas.length = 0;
    c.respostas.clear(); // o FCM se recuperou

    c.relogio.agora = T0 + 15 * 60_000; // depois do backoff
    const r = await processarEntregas(c.deps);
    expect(r.aceitas).toBe(2);
    expect(c.chamadas.flatMap((ch) => ch.tokens).sort()).toEqual(["tok-7", "tok-8"]);
    expect((await entregas()).filter((x) => x.status === "accepted")).toHaveLength(9);
  });

  it("antes do backoff vencer, nada é reenviado", async () => {
    const c = await montar();
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    c.chamadas.length = 0;
    c.relogio.agora = T0 + 5_000;
    await processarEntregas(c.deps);
    expect(c.chamadas).toHaveLength(0);
  });

  it("o retry insiste até o teto e então desiste com falha permanente", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    c.respostas.set("tok-1", { success: false, error: { code: "messaging/internal-error" } });
    await publicarPush(c.deps, spec({ validadeMs: 30 * HORA }));
    for (let i = 0; i < 8; i++) {
      c.relogio.agora += 20 * 60_000;
      await processarEntregas(c.deps);
    }
    const [e] = await entregas();
    expect(e).toMatchObject({ status: "permanent_failure", motivo: "tentativas_esgotadas", tentativas: 6 });
    expect(c.chamadas).toHaveLength(6);
  });

  it("o resumo do evento reflete os destinos, sem prometer 'entregue'", async () => {
    const c = await montar();
    await db.collection("notification_events").doc("sale_paid:2000123456").set({ id: "sale_paid:2000123456", type: "sale_paid" });
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    const ev = (await db.collection("notification_events").doc("sale_paid:2000123456").get()).data() ?? {};
    expect(ev.delivery.resumo).toMatchObject({ total: 10, aceitos: 7, pendentes: 2, falhas: 1, concluido: false });
    expect(ev.delivery.acceptedByProviderAt).toBe(T0);
    expect(ev.delivery).not.toHaveProperty("pushDeliveredAt");
  });
});

describe("501 destinos: lotes de até 500", () => {
  it("501 aparelhos viram dois lotes e TODOS são aceitos", async () => {
    const c = novoCenario();
    for (let i = 0; i < 501; i += 400) {
      const lote = db.batch();
      for (let j = i; j < Math.min(i + 400, 501); j++) {
        lote.set(db.collection("pushTokens").doc(`${DONO}__d${String(j).padStart(4, "0")}`), { email: DONO, deviceId: `d${j}`, token: `tok-${j}`, updatedAt: T0 });
      }
      await lote.commit();
    }
    expect((await db.collection("pushTokens").get()).size).toBe(501);

    await publicarPush(c.deps, spec());
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456", limite: 1000 });
    expect(r.aceitas).toBe(501);
    expect(c.chamadas.map((x) => x.tokens.length).sort((a, b) => b - a)).toEqual([500, 1]);
  }, 120_000);

  it("resposta com tamanho diferente do lote: NENHUM destino é dado como aceito", async () => {
    const c = novoCenario();
    for (let i = 0; i < 3; i++) await registrar(DONO, `dev-${i}`, `tok-${i}`);
    c.respostaIncompleta = true;
    await publicarPush(c.deps, spec());
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r.aceitas).toBe(0);
    expect(r.reagendadas).toBe(3);
  });

  it("a chamada inteira lançando: todos reagendados, ninguém perdido", async () => {
    const c = novoCenario();
    for (let i = 0; i < 3; i++) await registrar(DONO, `dev-${i}`, `tok-${i}`);
    c.falharEnvio = true;
    await publicarPush(c.deps, spec());
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r).toMatchObject({ aceitas: 0, reagendadas: 3 });
    c.falharEnvio = false;
    c.relogio.agora = T0 + 15 * 60_000;
    expect((await processarEntregas(c.deps)).aceitas).toBe(3);
  });
});

describe("acesso, preferência e conteúdo por destinatário", () => {
  it("member recebe a versão SEM financeiro; dono recebe a completa — no mesmo envio", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-dono");
    await registrar(MEMBRO, "dev-2", "tok-membro");
    await publicarPush(c.deps, spec({ type: "sale_negative_margin", payload: payload({ type: "sale_negative_margin", title: "Venda confirmada · revisar margem", body: "Menta · prejuízo estimado de R$ 18,40" }) }));
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });

    const doDono = c.chamadas.find((ch) => ch.tokens.includes("tok-dono"))!;
    const doMembro = c.chamadas.find((ch) => ch.tokens.includes("tok-membro"))!;
    expect(doDono.data.grossAmount).toBe("129.90");
    expect(doDono.data.type).toBe("sale_negative_margin");
    expect(doMembro.data.grossAmount).toBe("");
    expect(doMembro.data.type).toBe("sale_paid");
    expect(JSON.stringify(doMembro.data)).not.toContain("18,40");
  });

  it("dono que desligou o financeiro recebe a versão sem valores", async () => {
    const c = novoCenario();
    c.prefs.set(DONO, interpretarPreferencias({ showFinancialValuesInPush: false }));
    await registrar(DONO, "dev-1", "tok-dono");
    await publicarPush(c.deps, spec());
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(c.chamadas[0].data.grossAmount).toBe("");
  });

  it("quem perdeu o acesso entre o agendamento e o envio é suprimido", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-dono");
    await registrar("demitido@zxp.com", "dev-2", "tok-demitido");
    await publicarPush(c.deps, spec());
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(c.chamadas.flatMap((ch) => ch.tokens)).toEqual(["tok-dono"]);
    expect((await entregas()).find((e) => e.email === "demitido@zxp.com")).toMatchObject({ status: "suppressed", motivo: "sem_acesso" });
  });

  it("preferência desligada: suprimido, com o motivo", async () => {
    const c = novoCenario();
    c.prefs.set(MEMBRO, interpretarPreferencias({ toggles: { sale_paid: false } }));
    await registrar(MEMBRO, "dev-1", "tok-membro");
    await publicarPush(c.deps, spec());
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect((await entregas())[0]).toMatchObject({ status: "suppressed", motivo: "preferencia_toggle" });
    expect(c.chamadas).toHaveLength(0);
  });

  it("preferências de um destinatário indisponíveis: ADIA só ele; o outro segue", async () => {
    const c = novoCenario();
    c.prefs.set(MEMBRO, { estado: "indisponivel", motivo: "firestore: 14", prefs: interpretarPreferencias(undefined).prefs });
    await registrar(DONO, "dev-1", "tok-dono");
    await registrar(MEMBRO, "dev-2", "tok-membro");
    await publicarPush(c.deps, spec());
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r).toMatchObject({ aceitas: 1, reagendadas: 1 });
    const membro = (await entregas()).find((e) => e.email === MEMBRO)!;
    expect(membro).toMatchObject({ status: "retry_scheduled", adiamentos: 1, tentativas: 0 });
  });

  it("preferência que LANÇA erro é isolada — não derruba o grupo", async () => {
    const c = novoCenario();
    c.deps.lerPreferencias = async (email) => { if (email === MEMBRO) throw new Error("boom"); return interpretarPreferencias(undefined); };
    await registrar(DONO, "dev-1", "tok-dono");
    await registrar(MEMBRO, "dev-2", "tok-membro");
    await publicarPush(c.deps, spec());
    const r = await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(r.aceitas).toBe(1);
  });

  it("token que rodou depois do agendamento: envia o token ATUAL", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-velho");
    await publicarPush(c.deps, spec());
    await db.collection("pushTokens").doc(`${DONO}__dev-1`).update({ token: "tok-novo" });
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(c.chamadas[0].tokens).toEqual(["tok-novo"]);
  });

  it("registro removido depois do agendamento: suprimido, nada é enviado", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    await db.collection("pushTokens").doc(`${DONO}__dev-1`).delete();
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect((await entregas())[0]).toMatchObject({ status: "suppressed", motivo: "destino_removido" });
    expect(c.chamadas).toHaveLength(0);
  });
});

describe("validade, TTL e orçamento de bytes", () => {
  it("passou da validade: expira sem enviar", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    c.relogio.agora = T0 + 7 * HORA;
    const r = await processarEntregas(c.deps);
    expect(r.expiradas).toBe(1);
    expect(c.chamadas).toHaveLength(0);
    expect((await entregas())[0]).toMatchObject({ status: "expired", motivo: "validade" });
  });

  it("o TTL enviado ao provedor é o que RESTA da validade", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    c.respostas.set("tok-1", { success: false, error: { code: "messaging/internal-error" } });
    await publicarPush(c.deps, spec());
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(c.chamadas[0].ttlSegundos).toBe(6 * 3600);

    c.respostas.clear();
    c.relogio.agora = T0 + 4 * HORA;
    await processarEntregas(c.deps);
    expect(c.chamadas[1].ttlSegundos).toBe(2 * 3600);
  });

  it("15 itens de nome acentuado e longo: o payload que vai pro FCM cabe no orçamento", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    const itens = Array.from({ length: 15 }, (_, i) => ({ title: "Cápsulas de Açaí com Guaraná e Ginseng nº ção ".repeat(4) + i, quantity: 2 }));
    await publicarPush(c.deps, spec({ payload: payload({ itensJson: JSON.stringify(itens), body: "Pedido grande ção ".repeat(80) }) }));
    await processarEntregas(c.deps, { pushId: "sale_paid:2000123456" });
    expect(tamanhoDoData(c.chamadas[0].data)).toBeLessThanOrEqual(ORCAMENTO_DATA_BYTES);
    expect(c.chamadas[0].data.eventId).toBe("sale_paid:2000123456");
  });
});

describe("consumidor independente do produtor", () => {
  it("publicar SEM entregar; a varredura sozinha acha e envia", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    expect(c.chamadas).toHaveLength(0);
    const r = await processarEntregas(c.deps);
    expect(r.aceitas).toBe(1);
  });

  it("publicarEEntregar: agenda e envia no mesmo passo", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    const r = await publicarEEntregar(c.deps, spec());
    expect(r).toMatchObject({ criado: true, destinos: 1, aceitas: 1 });
  });

  it("republicar e reentregar um push já aceito não envia nada de novo", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarEEntregar(c.deps, spec());
    await publicarEEntregar(c.deps, spec());
    await processarEntregas(c.deps);
    expect(c.chamadas).toHaveLength(1);
  });

  it("um aparelho registrado DEPOIS do agendamento não recebe aviso velho (sem backfill)", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarPush(c.deps, spec());
    await registrar(DONO, "dev-2", "tok-novo");
    await publicarEEntregar(c.deps, spec());
    expect(c.chamadas.flatMap((ch) => ch.tokens)).toEqual(["tok-1"]);
  });

  it("situacaoDoPush conta os destinos", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarEEntregar(c.deps, spec());
    expect(await situacaoDoPush(c.deps, "sale_paid:2000123456")).toMatchObject({ total: 1, aceitos: 1, concluido: true });
  });
});

describe("retenção", () => {
  it("apaga pushes vencidos há mais de 14 dias e os destinos deles; mantém os recentes", async () => {
    const c = novoCenario();
    await registrar(DONO, "dev-1", "tok-1");
    await publicarEEntregar(c.deps, spec({ pushId: "velho", eventId: "velho" }));
    c.relogio.agora = T0 + 30 * 24 * HORA;
    await publicarEEntregar(c.deps, spec({ pushId: "novo", eventId: "novo" }));

    const removidos = await limparEntregasAntigas(c.deps);
    expect(removidos).toBe(1);
    expect((await db.collection(COLECAO_OUTBOX).doc("velho").get()).exists).toBe(false);
    expect(await entregas("velho")).toHaveLength(0);
    expect((await db.collection(COLECAO_OUTBOX).doc("novo").get()).exists).toBe(true);
    expect(await entregas("novo")).toHaveLength(1);
  });

  it("idDaEntrega é determinístico", () => {
    expect(idDaEntrega("p", "r")).toBe("p__r");
  });
});
