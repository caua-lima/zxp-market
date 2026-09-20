import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { COLECAO_ENTREGAS, COLECAO_OUTBOX, processarEntregas, type Dependencias, type MensagemDeLote } from "./notification-outbox";
import { publicarVendaComRajada } from "./notification-rajada";
import { registrarVendaNaJanela, lerJanela } from "./notification-janelas";
import { consumirLimiteDaChave } from "./notification-limites";
import { interpretarPreferencias, type LeituraDePreferencias } from "./domain/notification-preferences";
import type { AcessoDoDestinatario } from "./domain/notificacao-publico";
import type { RespostaDeEnvio } from "./domain/push-envio";
import { buildSaleContent, type SalePushPayload } from "./domain/notifications";
import { JANELA_MS, idsDoResumo } from "./domain/janela-de-vendas";

/**
 * Rajada de vendas contra o emulador do Firestore, com o FCM simulado
 * (`npm run test:emulador`).
 *
 * É o cenário que a auditoria pede: dez vendas em 90 segundos, o retry das dez
 * e duas pessoas com preferências diferentes — com contagens e mensagens
 * PREVISÍVEIS, sem resumo estacionado em quatro e sem aviso avulso ressuscitado.
 */

let db: Firestore;
const T0 = 1_800_000_000_000;
const DONA = "dona@zxp.com"; // agrupa (o padrão)
const SOCIO = "socio@zxp.com"; // quer cada venda

type Cenario = {
  relogio: { agora: number };
  chamadas: MensagemDeLote[];
  prefs: Map<string, LeituraDePreferencias>;
  deps: Dependencias;
};

function novoCenario(): Cenario {
  const c = {
    relogio: { agora: T0 },
    chamadas: [] as MensagemDeLote[],
    prefs: new Map<string, LeituraDePreferencias>(),
  } as Cenario;
  const acessos = new Map<string, AcessoDoDestinatario>([
    [DONA, { papel: "owner", permissoesEdicao: [] }],
    [SOCIO, { papel: "partner", permissoesEdicao: [] }],
  ]);
  let seq = 0;
  c.deps = {
    db,
    agora: () => c.relogio.agora,
    aleatorio: () => 0.5,
    novoLeaseId: () => `lease-${++seq}-${Math.random().toString(36).slice(2, 8)}`,
    enviarLote: async (m): Promise<RespostaDeEnvio[]> => {
      c.chamadas.push(m);
      return m.tokens.map((t) => ({ success: true, messageId: `msg-${t}` }));
    },
    lerAcessos: async () => acessos,
    lerPreferencias: async (email) => c.prefs.get(email) ?? interpretarPreferencias(undefined),
  };
  return c;
}

function venda(i: number): { eventId: string; payload: SalePushPayload } {
  const eventId = `sale_paid:${2000000000 + i}`;
  const gross = 100 + i;
  const c = buildSaleContent({ type: "sale_paid", grossAmount: gross, estimatedProfit: 30, estimatedMargin: 30, metaMargem: null, productName: "Menta", itemCount: 1 });
  return {
    eventId,
    payload: {
      eventId, type: "sale_paid", title: c.title, body: c.body, tag: `sale-${eventId}`, orderId: String(2000000000 + i),
      deepLink: `/?tab=pedidos&order=${2000000000 + i}`, productName: "Menta", grossAmount: gross.toFixed(2),
      estimatedProfit: "30.00", estimatedMargin: "30.0", financialState: "estimated", timestamp: "1",
    },
  };
}

const resumo = (pushId: string, titulo: string, corpo: string, tag: string): SalePushPayload => ({
  eventId: pushId, type: "sale_paid", title: titulo, body: corpo, tag, deepLink: "/?tab=pedidos", timestamp: "1",
});

async function publicar(c: Cenario, i: number) {
  const v = venda(i);
  return publicarVendaComRajada(c.deps, { eventId: v.eventId, type: "sale_paid", payload: v.payload, gross: 100 + i, montarResumo: resumo });
}

async function registrar(email: string, deviceId: string, token: string) {
  await db.collection("pushTokens").doc(`${email}__${deviceId}`).set({ email, deviceId, token, updatedAt: T0 });
}

async function limpar() {
  for (const col of ["pushTokens", COLECAO_OUTBOX, COLECAO_ENTREGAS, "notification_events", "notification_janelas", "notification_limites"]) {
    const snap = await db.collection(col).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const lote = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
  }
}

const titulos = (c: Cenario, token: string) => c.chamadas.filter((m) => m.tokens.includes(token)).map((m) => m.data.title);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "rajada-teste") ?? initializeApp({ projectId: "zxp-teste-rajada" }, "rajada-teste");
  db = getFirestore(app);
});
beforeEach(limpar);
afterAll(async () => { await db?.terminate(); });

describe("dez vendas em 90 segundos — duas pessoas, preferências diferentes", () => {
  async function montarDezVendas() {
    const c = novoCenario();
    await registrar(DONA, "dev-1", "tok-dona");
    await registrar(SOCIO, "dev-2", "tok-socio");
    c.prefs.set(SOCIO, interpretarPreferencias({ groupFastSales: false }));
    for (let i = 0; i < 10; i++) {
      c.relogio.agora = T0 + i * 8_000; // dez vendas em 72 s
      await publicar(c, i);
    }
    return c;
  }

  it("quem AGRUPA recebe 3 avulsos + 1 resumo de abertura; quem NÃO agrupa recebe as 10 vendas", async () => {
    const c = await montarDezVendas();
    const dona = titulos(c, "tok-dona");
    const socio = titulos(c, "tok-socio");

    expect(dona).toHaveLength(4);
    expect(dona.slice(0, 3).every((t) => t === "Nova venda confirmada")).toBe(true);
    expect(dona[3]).toMatch(/vendas confirmadas em/); // a abertura, na 4ª venda
    expect(socio).toHaveLength(10);
    expect(socio.every((t) => t === "Nova venda confirmada")).toBe(true);
  });

  it("a abertura relata a rajada, não 'novas vendas' — as três primeiras já foram avisadas", async () => {
    const c = await montarDezVendas();
    const abertura = titulos(c, "tok-dona")[3];
    expect(abertura).not.toMatch(/novas/);
    expect(abertura).toMatch(/^4 vendas confirmadas em/);
  });

  it("o resumo NÃO fica estacionado em quatro: o de fechamento sai no fim da janela com o número FINAL", async () => {
    const c = await montarDezVendas();
    const antes = c.chamadas.length;

    // Antes do fim da janela, o fechamento espera.
    c.relogio.agora = T0 + 40_000;
    await processarEntregas(c.deps);
    expect(c.chamadas.length).toBe(antes);

    // Passado o fim, sai UM fechamento, com as dez vendas.
    c.relogio.agora = T0 + JANELA_MS + 1_000;
    await processarEntregas(c.deps);
    const novos = c.chamadas.slice(antes);
    expect(novos).toHaveLength(1);
    expect(novos[0].tokens).toEqual(["tok-dona"]);
    expect(novos[0].data.title).toMatch(/^10 vendas confirmadas em/);
  });

  it("abertura e fechamento têm a MESMA tag: o aparelho substitui em vez de empilhar", async () => {
    const c = await montarDezVendas();
    c.relogio.agora = T0 + JANELA_MS + 1_000;
    await processarEntregas(c.deps);
    const tags = c.chamadas.filter((m) => /vendas confirmadas em/.test(m.data.title)).map((m) => m.data.tag);
    expect(tags).toHaveLength(2);
    expect(new Set(tags).size).toBe(1);
    expect(tags[0]).toMatch(/^sales-summary-\d+$/); // o id da janela, não um bucket de relógio
  });

  it("RETRY das dez vendas: nenhum aviso novo, nenhuma venda contada de novo", async () => {
    const c = await montarDezVendas();
    const antes = c.chamadas.length;
    c.relogio.agora = T0 + 30_000;
    for (let i = 0; i < 10; i++) await publicar(c, i);
    expect(c.chamadas.length).toBe(antes);

    const janela = (await db.collection("notification_janelas").doc("_atual").get()).data();
    const j = await lerJanela(db, String(janela?.janelaId));
    expect(Object.keys(j!.membros)).toHaveLength(10); // continuam sendo dez
  });

  it("nenhum aviso avulso RESSUSCITA: as vendas 4–10 seguem suprimidas pra quem agrupa, depois do retry", async () => {
    const c = await montarDezVendas();
    c.relogio.agora = T0 + 30_000;
    for (let i = 0; i < 10; i++) await publicar(c, i);
    c.relogio.agora = T0 + 5 * 60_000;
    await processarEntregas(c.deps);

    const dona = titulos(c, "tok-dona");
    expect(dona.filter((t) => t === "Nova venda confirmada")).toHaveLength(3);
  });

  it("as vendas suprimidas por agrupamento NÃO são falha de entrega: terminam em 'suppressed'", async () => {
    await montarDezVendas();
    const snap = await db.collection(COLECAO_ENTREGAS).where("email", "==", DONA).get();
    const doEvento = (i: number) => snap.docs.find((d) => d.data().pushId === `sale_paid:${2000000000 + i}`)!.data();
    for (const i of [0, 1, 2]) expect(doEvento(i).status).toBe("accepted");
    for (const i of [3, 4, 5, 6, 7, 8, 9]) expect(doEvento(i)).toMatchObject({ status: "suppressed", motivo: "agrupada_em_resumo" });
    expect(snap.docs.filter((d) => d.data().status === "permanent_failure")).toHaveLength(0);
  });

  it("quem NÃO agrupa é suprimido nos resumos, com o motivo certo", async () => {
    const c = await montarDezVendas();
    c.relogio.agora = T0 + JANELA_MS + 1_000;
    await processarEntregas(c.deps);
    const janelaId = String((await db.collection("notification_janelas").doc("_atual").get()).data()?.janelaId);
    const ids = idsDoResumo(janelaId);
    for (const pushId of [ids.abertura, ids.fechamento]) {
      const e = (await db.collection(COLECAO_ENTREGAS).where("pushId", "==", pushId).get()).docs.map((d) => d.data());
      expect(e.find((x) => x.email === SOCIO)).toMatchObject({ status: "suppressed", motivo: "prefere_individual" });
      expect(e.find((x) => x.email === DONA)).toMatchObject({ status: "accepted" });
    }
  });

  it("o resumo enviado ao dono NÃO carrega o faturamento quando ele desligou o financeiro no push", async () => {
    const c = novoCenario();
    await registrar(DONA, "dev-1", "tok-dona");
    c.prefs.set(DONA, interpretarPreferencias({ showFinancialValuesInPush: false }));
    for (let i = 0; i < 5; i++) { c.relogio.agora = T0 + i * 1000; await publicar(c, i); }
    const abertura = c.chamadas.find((m) => /vendas confirmadas/.test(m.data.title))!;
    expect(abertura.data.body).not.toContain("R$");
  });
});

describe("rajada: prejuízo nunca agrupa e a janela é estável", () => {
  it("venda com prejuízo não entra na janela e sai sempre avulsa", async () => {
    const c = novoCenario();
    await registrar(DONA, "dev-1", "tok-dona");
    const v = venda(1);
    const r = await publicarVendaComRajada(c.deps, {
      eventId: v.eventId, type: "sale_negative_margin", payload: { ...v.payload, type: "sale_negative_margin" }, gross: 100, montarResumo: resumo,
    });
    expect(r.decisao).toBeNull();
    expect(r.agrupada).toBe(false);
    expect((await db.collection("notification_janelas").get()).size).toBe(0);
  });

  it("uma venda DEPOIS do fim da janela abre outra, e a contagem recomeça", async () => {
    const c = novoCenario();
    await registrar(DONA, "dev-1", "tok-dona");
    for (let i = 0; i < 5; i++) { c.relogio.agora = T0 + i * 1000; await publicar(c, i); }
    c.relogio.agora = T0 + JANELA_MS + 5_000;
    const r = await publicar(c, 100);
    expect(r.decisao).toMatchObject({ n: 1, modo: "individual" });
  });
});

describe("janela: concorrência e idempotência no Firestore", () => {
  it("20 vendas SIMULTÂNEAS ganham posições 1..20 sem repetir nem pular", async () => {
    const posicoes = await Promise.all(
      Array.from({ length: 20 }, (_, i) => registrarVendaNaJanela(db, { eventId: `e${i}`, gross: 10 }, T0 + i)),
    );
    expect(posicoes.map((p) => p.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(posicoes.map((p) => p.janelaId)).size).toBe(1);
  });

  it("a MESMA venda registrada 10 vezes ao mesmo tempo ocupa UMA posição", async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => registrarVendaNaJanela(db, { eventId: "mesma", gross: 10 }, T0)));
    expect(new Set(rs.map((r) => r.n)).size).toBe(1);
    const j = await lerJanela(db, rs[0].janelaId);
    expect(Object.keys(j!.membros)).toHaveLength(1);
  });
});

describe("limite de taxa das rotas de notificação", () => {
  it("20 chamadas simultâneas com teto 5: exatamente 5 passam", async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => consumirLimiteDaChave(db, "tarefa:dono@zxp.com", { max: 5, janelaMs: 60_000 }, T0)));
    expect(rs.filter((r) => r.permitido)).toHaveLength(5);
  });

  it("outra pessoa não divide o teto", async () => {
    await consumirLimiteDaChave(db, "tarefa:a@zxp.com", { max: 1, janelaMs: 60_000 }, T0);
    expect((await consumirLimiteDaChave(db, "tarefa:b@zxp.com", { max: 1, janelaMs: 60_000 }, T0)).permitido).toBe(true);
    expect((await consumirLimiteDaChave(db, "tarefa:a@zxp.com", { max: 1, janelaMs: 60_000 }, T0 + 1)).permitido).toBe(false);
  });

  it("depois da janela, reabre", async () => {
    await consumirLimiteDaChave(db, "tarefa:a@zxp.com", { max: 1, janelaMs: 1000 }, T0);
    expect((await consumirLimiteDaChave(db, "tarefa:a@zxp.com", { max: 1, janelaMs: 1000 }, T0 + 1000)).permitido).toBe(true);
  });
});
