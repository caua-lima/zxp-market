import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { createNotificationEventIdempotent, type NewNotificationEvent } from "./notification-events";
import {
  COLECAO_ENTREGAS,
  COLECAO_OUTBOX,
  processarEntregas,
  type Dependencias,
  type EspecPush,
  type MensagemDeLote,
} from "./notification-outbox";
import { decidirRajada, especDaVendaAvulsa } from "./notification-rajada";
import { interpretarPreferencias } from "./domain/notification-preferences";
import { COLECAO_EVENTOS, COLECAO_FEED } from "./domain/notificacao-publico";
import type { SalePushPayload } from "./domain/notifications";

/**
 * S09 da auditoria SaaS: evento e intenção de entrega nascem JUNTOS.
 *
 * Contra o emulador REAL do Firestore, com o FCM simulado. A pergunta de cada
 * teste é a da auditoria: se o processo morrer logo depois de criar o evento,
 * o push ainda sai — sem nenhum produtor chamar de novo, só com a varredura
 * (o worker de app/api/worker)?
 */

let db: Firestore;
const DONO = "dono@zxp.com";
const MEMBRO = "membro@zxp.com";
const CHAVE = "stock_low:MLB1";

function cenario() {
  const chamadas: MensagemDeLote[] = [];
  const deps: Dependencias = {
    db,
    // Relógio REAL: o push nasce junto do evento com Date.now(), e a validade conta dali.
    agora: () => Date.now(),
    aleatorio: () => 0.5,
    novoLeaseId: () => `lease-${Math.random().toString(36).slice(2)}`,
    enviarLote: async (m) => {
      chamadas.push(m);
      return m.tokens.map((t) => ({ success: true, messageId: `msg-${t}` }));
    },
    lerAcessos: async () => new Map([
      [DONO, { papel: "owner" as const, permissoesEdicao: [] }],
      [MEMBRO, { papel: "member" as const, permissoesEdicao: [] }],
    ]),
    lerPreferencias: async () => interpretarPreferencias(undefined),
  };
  return { deps, chamadas };
}

const evento = (over: Partial<NewNotificationEvent> = {}): NewNotificationEvent => ({
  type: "stock_low", severity: "warning", entityType: "system", entityId: "MLB1", dedupeKey: CHAVE,
  title: "Estoque baixo", body: "Menta Stronger: 3 unidades", financialState: "confirmed", deepLink: "/?tab=full",
  ...over,
});

const payload = (over: Partial<SalePushPayload> = {}): SalePushPayload => ({
  eventId: CHAVE, type: "stock_low", title: "Estoque baixo", body: "Menta Stronger: 3 unidades",
  tag: CHAVE, orderId: "", deepLink: "/?tab=full", timestamp: "2026-09-26T12:00:00.000Z", ...over,
});

const push = (over: Partial<EspecPush> = {}): EspecPush => ({
  pushId: CHAVE, eventId: CHAVE, type: "stock_low", payload: payload(), origem: "teste", ...over,
});

async function registrar(email: string, deviceId: string, token: string) {
  await db.collection("pushTokens").doc(`${email}__${deviceId}`).set({ email, deviceId, token, updatedAt: Date.now() });
}

async function limpar() {
  const cols = ["pushTokens", COLECAO_OUTBOX, COLECAO_ENTREGAS, COLECAO_EVENTOS, "notification_events_publico", "notification_janelas"];
  await Promise.all(cols.map((c) => db.recursiveDelete(db.collection(c))));
  await db.recursiveDelete(db.collection(COLECAO_FEED));
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "atomicidade-teste") ?? initializeApp({ projectId: "zxp-teste-atomicidade" }, "atomicidade-teste");
  db = getFirestore(app);
});
beforeEach(limpar);
afterAll(async () => { await db?.terminate(); });

describe("evento e push nascem juntos (S09)", () => {
  it("o processo morre logo depois de criar o evento: a VARREDURA entrega, sem o produtor chamar de novo", async () => {
    await registrar(DONO, "dev-1", "tok-dono");
    const { created } = await createNotificationEventIdempotent(evento(), db, { push: push() });
    expect(created).toBe(true);
    // ... e aqui o processo "morre": nenhuma entrega imediata.
    expect((await db.collection(COLECAO_OUTBOX).doc(CHAVE).get()).data()).toMatchObject({ fanoutPendente: true });

    const { deps, chamadas } = cenario();
    const r = await processarEntregas(deps);
    expect(r.aceitas).toBe(1);
    expect(chamadas.flatMap((c) => c.tokens)).toEqual(["tok-dono"]);
  });

  it("o jeito antigo (evento sem o push no lote) deixava a varredura sem nada pra achar", async () => {
    // Documenta o buraco que o S09 fecha: evento gravado, push nunca gravado.
    await registrar(DONO, "dev-1", "tok-dono");
    await createNotificationEventIdempotent(evento(), db);
    const { deps, chamadas } = cenario();
    expect((await processarEntregas(deps)).aceitas).toBe(0);
    expect(chamadas).toHaveLength(0);
  });

  it("o lote é atômico: se o push não pode nascer, o evento também não nasce", async () => {
    // Payload acima do limite de 1 MiB por documento: o push é recusado pelo Firestore.
    const gigante = push({ payload: payload({ body: "x".repeat(1_100_000) }) });
    await expect(createNotificationEventIdempotent(evento(), db, { push: gigante })).rejects.toThrow();
    expect((await db.collection(COLECAO_EVENTOS).doc(CHAVE).get()).exists).toBe(false);
    expect((await db.collection(COLECAO_OUTBOX).doc(CHAVE).get()).exists).toBe(false);
  });

  it("evento antigo que ficou sem push: o produtor repetindo cria o push, sem recriar o evento", async () => {
    await registrar(DONO, "dev-1", "tok-dono");
    await createNotificationEventIdempotent(evento(), db); // o evento de antes do S09
    const { created } = await createNotificationEventIdempotent(evento(), db, { push: push() });
    expect(created).toBe(false);
    expect((await db.collection(COLECAO_OUTBOX).doc(CHAVE).get()).exists).toBe(true);
    const { deps } = cenario();
    expect((await processarEntregas(deps)).aceitas).toBe(1);
  });

  it("retry com tudo já criado: nada duplica — um push, um destino por aparelho", async () => {
    await registrar(DONO, "dev-1", "tok-dono");
    await registrar(DONO, "dev-2", "tok-dono-2");
    expect((await createNotificationEventIdempotent(evento(), db, { push: push() })).created).toBe(true);
    expect((await createNotificationEventIdempotent(evento(), db, { push: push() })).created).toBe(false);
    const { deps } = cenario();
    await processarEntregas(deps);
    await processarEntregas(deps);
    expect((await db.collection(COLECAO_OUTBOX).get()).size).toBe(1);
    expect((await db.collection(COLECAO_ENTREGAS).get()).size).toBe(2);
  });

  it("venda: a rajada é decidida ANTES, o avulso nasce com o evento já com o agrupamento, e o retry não conta a venda de novo", async () => {
    await registrar(DONO, "dev-1", "tok-dono");
    const chave = "sale_paid:2000123456";
    const pl = payload({ eventId: chave, type: "sale_paid", tag: "sale-2000123456" });
    const venda = { eventId: chave, type: "sale_paid" as const, gross: 129.9 };

    const decisao = await decidirRajada(db, venda);
    expect(decisao).not.toBeNull();
    await createNotificationEventIdempotent(
      evento({ type: "sale_paid", dedupeKey: chave, entityType: "order", entityId: "2000123456" }),
      db,
      { push: especDaVendaAvulsa({ eventId: chave, type: "sale_paid", payload: pl }, decisao) },
    );
    // O processo morre aqui. O avulso já está no outbox, com a decisão gravada.
    expect((await db.collection(COLECAO_OUTBOX).doc(chave).get()).data()?.agrupamento)
      .toEqual({ janelaId: decisao!.janelaId, n: decisao!.n });
    const { deps, chamadas } = cenario();
    await processarEntregas(deps);
    expect(chamadas.flatMap((c) => c.tokens)).toEqual(["tok-dono"]);

    // Retry do produtor: relê a decisão gravada no push — a venda não entra de novo na janela.
    const outraVez = await decidirRajada(db, venda);
    expect(outraVez).toMatchObject({ janelaId: decisao!.janelaId, n: decisao!.n });
    const janela = await db.collection("notification_janelas").doc(decisao!.janelaId).get();
    expect(Object.keys(janela.data()?.membros ?? {})).toHaveLength(1);
  });

  it("evento direcionado (feed pessoal) nasce junto do push, e o push só alcança a audiência", async () => {
    await registrar(DONO, "dev-1", "tok-dono");
    await registrar(MEMBRO, "dev-2", "tok-membro");
    const chave = "task_due:membro@zxp.com:2026-09-26";
    const { created } = await createNotificationEventIdempotent(
      evento({ type: "task_due", dedupeKey: chave, entityType: "task", entityId: "t1" }),
      db,
      { audiencia: [MEMBRO], push: push({ pushId: chave, eventId: chave, type: "task_due", audiencia: [MEMBRO], payload: payload({ eventId: chave, type: "task_due" }) }) },
    );
    expect(created).toBe(true);
    expect((await db.collection(COLECAO_FEED).doc(MEMBRO).collection("itens").doc(chave).get()).exists).toBe(true);
    const { deps, chamadas } = cenario();
    await processarEntregas(deps);
    expect(chamadas.flatMap((c) => c.tokens)).toEqual(["tok-membro"]);
  });
});
