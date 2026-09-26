import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S07 da auditoria SaaS contra o emulador REAL do Firestore:
 * `npm run test:emulador`.
 *
 * A rota do webhook é a de verdade. `after()` é capturado: o que a rota agenda
 * pra depois da resposta só roda quando o teste chama `depoisDaResposta()` —
 * é assim que dá pra provar que NADA do trabalho pesado acontece antes de
 * responder ao ML.
 */

const ml = vi.hoisted(() => ({
  chamadas: [] as string[],
  status: 200,
  pedido: null as null | Record<string, unknown>,
  /** Roda uma vez, dentro da próxima consulta ao pedido. */
  durante: null as null | (() => Promise<void>),
}));
const posResposta = vi.hoisted(() => ({ fila: [] as (() => Promise<unknown>)[] }));

vi.mock("@/lib/ml/fetch-ml", () => ({
  fetchML: vi.fn(async (url: string) => {
    ml.chamadas.push(url);
    if (ml.durante) {
      const d = ml.durante;
      ml.durante = null;
      await d();
    }
    if (ml.status !== 200) return new Response("{}", { status: ml.status });
    return new Response(JSON.stringify(ml.pedido), { status: 200, headers: { "content-type": "application/json" } });
  }),
}));

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "inbox-teste") ?? initializeApp({ projectId: "zxp-teste-inbox" }, "inbox-teste");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

vi.mock("@/lib/ml/notificar-venda", () => ({
  notificarVendaConfirmada: vi.fn(async () => ({ estado: "antiga" })),
  buildPayload: vi.fn(() => ({})),
}));
vi.mock("@/lib/notification-events", () => ({
  createNotificationEventIdempotent: vi.fn(async () => ({ eventId: "evento-teste", created: true })),
}));
vi.mock("@/lib/notification-dispatch", () => ({
  enviarEPersistirEntrega: vi.fn(async () => {}),
  varrerEntregasPendentes: vi.fn(async () => {}),
}));
vi.mock("@/lib/ml/getToken", () => ({ getValidMlAccessToken: vi.fn(async () => "token-teste") }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn((fn: () => Promise<unknown>) => { posResposta.fila.push(fn); }),
}));

const { POST: webhook } = await import("@/app/api/ml/webhook/route");
const { podarInbox, processarItem, receberNotificacao, varrerInbox, COLECAO_INBOX } = await import("./webhook-inbox");
const { ESPERAS_MIN, MAX_TENTATIVAS } = await import("@/lib/domain/webhook-inbox");
const { getAdminDb } = await import("@/lib/firebase/admin");

const db = getAdminDb();
const ID = "2000001";
const VENDEDOR = "999";
const APP = "1234567890";
const itemRef = (id = ID) => db.collection(COLECAO_INBOX).doc(`orders_v2:${id}`);

/** Roda, em ordem, o que a rota agendou pra depois da resposta. */
async function depoisDaResposta() {
  while (posResposta.fila.length) await posResposta.fila.shift()!();
}

function pedidoML(status: string, lastUpdated: string, vendedor: number | string = VENDEDOR): Record<string, unknown> {
  return {
    id: Number(ID), status, last_updated: lastUpdated,
    date_created: "2026-09-20T10:00:00.000-04:00", total_amount: 129.9, currency_id: "BRL",
    seller: { id: Number(vendedor) }, buyer: { id: 555 }, shipping: { id: 4400 },
    order_items: [{ item: { id: "MLB1", title: "Produto" }, quantity: 1, unit_price: 129.9, sale_fee: 18.2 }],
  };
}

function notificacao(corpo: Record<string, unknown> = {}) {
  const texto = JSON.stringify({
    resource: `/orders/${ID}`, user_id: Number(VENDEDOR), topic: "orders_v2", application_id: Number(APP), attempts: 1,
    ...corpo,
  });
  return new Request("http://localhost/api/ml/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(texto.length) },
    body: texto,
  });
}

beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  process.env.ML_SELLER_ID = VENDEDOR;
  process.env.ML_APP_ID = APP;
  ml.chamadas = [];
  ml.status = 200;
  ml.pedido = pedidoML("paid", "2026-09-20T10:05:00.000-04:00");
  ml.durante = null;
  posResposta.fila = [];
  vi.clearAllMocks();
  await Promise.all(["ml_orders", COLECAO_INBOX, "webhook_log", "webhook_topicos"].map((c) => db.recursiveDelete(db.collection(c))));
});

afterAll(async () => {
  delete process.env.ML_APP_ID;
  await db.terminate();
});

describe("a rota confirma durável e só depois trabalha", () => {
  it("responde 200 SEM consultar o ML; o pedido é consultado e gravado depois da resposta", async () => {
    const r = await webhook(notificacao());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, recebido: true });
    expect(ml.chamadas).toHaveLength(0); // nada de API do ML antes de responder
    expect((await itemRef().get()).data()).toMatchObject({ estado: "pendente", geracao: 1, sellerId: VENDEDOR });
    expect((await db.collection("ml_orders").doc(ID).get()).exists).toBe(false);

    await depoisDaResposta();

    expect(ml.chamadas).toEqual([`https://api.mercadolibre.com/orders/${ID}`]);
    expect((await itemRef().get()).data()).toMatchObject({ estado: "feito", tentativas: 0 });
    expect((await itemRef().get()).data()).not.toHaveProperty("elegivelEm");
    expect((await db.collection("ml_orders").doc(ID).get()).data()).toMatchObject({ status: "paid" });
  });

  it("a reprodução da auditoria: { resource } sozinho não entra no inbox nem gera consulta", async () => {
    const texto = JSON.stringify({ resource: `/orders/${ID}` });
    const r = await webhook(new Request("http://localhost/api/ml/webhook", {
      method: "POST", headers: { "content-type": "application/json", "content-length": String(texto.length) }, body: texto,
    }));
    expect(await r.json()).toMatchObject({ ok: true, ignored: true, motivo: "campo_ausente" });
    expect((await itemRef().get()).exists).toBe(false);
    await depoisDaResposta();
    expect(ml.chamadas).toHaveLength(0);
  });

  it("inbox indisponível: responde ERRO, pra o ML retentar — sem registro durável não se confirma", async () => {
    const espiao = vi.spyOn(db, "runTransaction").mockRejectedValueOnce(new Error("indisponivel"));
    const r = await webhook(notificacao());
    espiao.mockRestore();
    expect(r.status).toBe(500);
    expect(posResposta.fila).toHaveLength(0);
    const log = await db.collection("webhook_log").get();
    expect(log.docs.map((d) => d.data().erro)).toEqual(["inbox: indisponivel"]);
  });
});

describe("coalescer sem deduplicar pra sempre", () => {
  it("5 notificações do mesmo pedido antes de processar: um item, UMA consulta ao ML", async () => {
    for (let i = 0; i < 5; i++) expect((await webhook(notificacao({ attempts: i + 1 }))).status).toBe(200);
    expect((await itemRef().get()).data()).toMatchObject({ geracao: 5, recebidas: 5, estado: "pendente" });
    await depoisDaResposta(); // cinco agendamentos: o primeiro processa, os outros não acham nada elegível
    expect(ml.chamadas).toHaveLength(1);
  });

  it("notificação que chega DURANTE o processamento não se perde: o item volta e é processado de novo", async () => {
    await webhook(notificacao());
    // Enquanto o ML responde a consulta, o pedido é cancelado e chega a notificação disso.
    ml.durante = async () => {
      ml.pedido = pedidoML("cancelled", "2026-09-20T10:09:00.000-04:00");
      expect((await webhook(notificacao())).status).toBe(200);
    };
    await depoisDaResposta();
    expect(ml.chamadas).toHaveLength(2);
    expect((await itemRef().get()).data()).toMatchObject({ estado: "feito", geracao: 2 });
    expect((await db.collection("ml_orders").doc(ID).get()).data()!.status).toBe("cancelled");
  });

  it("item já feito volta a pendente com notificação nova — pedido muda depois de processado", async () => {
    await webhook(notificacao());
    await depoisDaResposta();
    ml.pedido = pedidoML("cancelled", "2026-09-20T10:09:00.000-04:00");
    await webhook(notificacao());
    expect((await itemRef().get()).data()!.estado).toBe("pendente");
    await depoisDaResposta();
    expect((await db.collection("ml_orders").doc(ID).get()).data()!.status).toBe("cancelled");
  });
});

describe("retry e fila de falhas", () => {
  it("ML fora do ar: o item fica pendente com a próxima tentativa agendada e o erro registrado", async () => {
    ml.status = 500;
    const antes = Date.now();
    await webhook(notificacao());
    await depoisDaResposta();
    const d = (await itemRef().get()).data()!;
    expect(d).toMatchObject({ estado: "pendente", tentativas: 1, ultimoErro: "ML orders 500" });
    expect(d.elegivelEm).toBeGreaterThanOrEqual(antes + ESPERAS_MIN[0] * 60_000);
    // Não é reprocessado antes da hora (a varredura da mesma rodada já passou por ele).
    expect(ml.chamadas).toHaveLength(1);
    const log = await db.collection("webhook_log").where("ok", "==", false).get();
    expect(log.size).toBe(1);
  });

  it("esgotou as tentativas: fila de falhas, fora da varredura; notificação nova revive", async () => {
    ml.status = 500;
    await receberNotificacao({ topic: "orders_v2", orderId: ID, sellerId: VENDEDOR });
    await itemRef().update({ tentativas: MAX_TENTATIVAS - 1 });
    await processarItem(`orders_v2:${ID}`);
    const d = (await itemRef().get()).data()!;
    expect(d).toMatchObject({ estado: "falhou", tentativas: MAX_TENTATIVAS });
    expect(d).not.toHaveProperty("elegivelEm");
    expect((await varrerInbox()).elegiveis).toBe(0);

    ml.status = 200;
    await webhook(notificacao());
    await depoisDaResposta();
    expect((await itemRef().get()).data()).toMatchObject({ estado: "feito", tentativas: 0 });
  });

  it("processo que morreu no meio: com a concessão viva ninguém mexe; vencida, a varredura retoma", async () => {
    await receberNotificacao({ topic: "orders_v2", orderId: ID, sellerId: VENDEDOR });
    await itemRef().update({ estado: "processando", leaseDono: "morto", geracaoEmProcesso: 1, elegivelEm: Date.now() + 60_000 });
    expect((await varrerInbox()).elegiveis).toBe(0);
    expect(ml.chamadas).toHaveLength(0);

    await itemRef().update({ elegivelEm: Date.now() - 1 });
    const r = await varrerInbox();
    expect(r).toMatchObject({ elegiveis: 1, feitos: 1 });
    expect((await itemRef().get()).data()).toMatchObject({ estado: "feito" });
    expect((await itemRef().get()).data()).not.toHaveProperty("leaseDono");
  });
});

describe("poda do inbox", () => {
  it("apaga só concluído ANTIGO; fica a fila de falhas, o recente e o revivido", async () => {
    const velho = Date.now() - 40 * 86_400_000;
    const base = { topic: "orders_v2", sellerId: VENDEDOR, geracao: 1, recebidas: 1, tentativas: 0 };
    await Promise.all([
      itemRef("1").set({ ...base, orderId: "1", estado: "feito", concluidoEm: velho }),
      itemRef("2").set({ ...base, orderId: "2", estado: "descartado", concluidoEm: velho }),
      itemRef("3").set({ ...base, orderId: "3", estado: "falhou", concluidoEm: velho }),
      itemRef("4").set({ ...base, orderId: "4", estado: "feito", concluidoEm: Date.now() - 86_400_000 }),
      // Revivido por notificação nova: o concluidoEm antigo ficou, mas está pendente.
      itemRef("5").set({ ...base, orderId: "5", estado: "pendente", concluidoEm: velho, elegivelEm: Date.now() }),
    ]);
    expect(await podarInbox()).toEqual({ apagados: 2 });
    const restantes = (await db.collection(COLECAO_INBOX).get()).docs.map((d) => d.id).sort();
    expect(restantes).toEqual(["orders_v2:3", "orders_v2:4", "orders_v2:5"]);
  });
});

describe("o recurso canônico prova a posse", () => {
  it("pedido de OUTRO vendedor (ex.: a conta foi compradora): descartado, nada gravado como venda", async () => {
    ml.pedido = pedidoML("paid", "2026-09-20T10:05:00.000-04:00", 123);
    await webhook(notificacao());
    await depoisDaResposta();
    expect((await itemRef().get()).data()).toMatchObject({ estado: "descartado", resultado: "nao_e_do_vendedor" });
    expect((await db.collection("ml_orders").doc(ID).get()).exists).toBe(false);
  });

  it("pedido que o ML não acha (sandbox): descartado, sem retentar", async () => {
    ml.status = 404;
    await webhook(notificacao());
    await depoisDaResposta();
    expect((await itemRef().get()).data()).toMatchObject({ estado: "descartado", resultado: "nao_encontrado" });
  });
});
