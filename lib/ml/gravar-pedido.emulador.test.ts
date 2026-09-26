import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S12 da auditoria SaaS contra o emulador REAL do Firestore:
 * `npm run test:emulador`.
 *
 * O Mercado Livre é simulado por URL. `estado.durante` roda no meio de uma
 * chamada ao ML — é assim que o webhook entra no meio do sync, como em
 * produção: o sync já leu a página de pedidos e ainda está buscando os envios.
 */

const estado = vi.hoisted(() => ({
  /** Resultado de /orders/search (o que o sync lê). */
  busca: [] as Record<string, unknown>[],
  /** Resposta de GET /orders/{id} (o que o webhook lê). */
  pedido: null as null | Record<string, unknown>,
  /** Roda uma vez, na primeira chamada cuja URL contém `duranteEm`. */
  durante: null as null | (() => Promise<void>),
  duranteEm: "",
}));

vi.mock("@/lib/ml/fetch-ml", () => ({
  fetchML: vi.fn(async (url: string) => {
    if (estado.durante && url.includes(estado.duranteEm)) {
      const d = estado.durante;
      estado.durante = null;
      await d();
    }
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/orders/search")) return json({ results: estado.busca, paging: { total: estado.busca.length } });
    if (/\/orders\/\d+$/.test(url)) return estado.pedido ? json(estado.pedido) : json({}, 404);
    if (/\/shipments\/\d+\/costs$/.test(url)) return json({ senders: [{ cost: 21.5 }], receiver: { cost: 0 } });
    if (/\/shipments\/\d+$/.test(url)) {
      return json({ status: "shipped", substatus: "", logistic_type: "fulfillment", lead_time: { estimated_delivery_time: { date: "2026-09-25" } } });
    }
    if (url.includes("/v1/payments/")) return json({ transaction_details: { net_received_amount: 100 }, money_release_date: "2026-10-10" });
    return json({}, 404);
  }),
}));

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "pedidos-teste") ?? initializeApp({ projectId: "zxp-teste-pedidos" }, "pedidos-teste");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

// Notificação e push não são o assunto aqui — e nada de efeito externo em teste.
vi.mock("@/lib/ml/notificar-venda", () => ({
  vendaRecente: () => false,
  carregarProdutos: vi.fn(),
  metaMargemAtual: vi.fn(),
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
  after: vi.fn(),
}));

const { gravarPedidos } = await import("./gravar-pedido");
const { syncOrdersRange } = await import("./sync");
const { POST: webhook } = await import("@/app/api/ml/webhook/route");
const { estadoDoPedido } = await import("@/lib/domain/estado-do-pedido");
const { createNotificationEventIdempotent } = await import("@/lib/notification-events");
const { getAdminDb } = await import("@/lib/firebase/admin");

const db = getAdminDb();
const ID = "2000001";
const doc = () => db.collection("ml_orders").doc(ID);

const V1 = "2026-09-20T10:05:00.000-04:00";
const V2 = "2026-09-20T10:09:00.000-04:00";

/** Um pedido do ML como a API devolve, nos campos que o app lê. */
function pedidoML(status: string, lastUpdated: string | undefined, id = ID): Record<string, unknown> {
  return {
    id: Number(id),
    status,
    date_created: "2026-09-20T10:00:00.000-04:00",
    ...(lastUpdated ? { last_updated: lastUpdated } : {}),
    total_amount: 129.9,
    currency_id: "BRL",
    buyer: { id: 555 },
    pack_id: null,
    shipping: { id: 4400 },
    payments: [{ id: 7700, money_release_date: "2026-10-10T00:00:00.000-04:00" }],
    order_items: [{ item: { id: "MLB1", seller_sku: "SKU-1", title: "Produto" }, quantity: 1, unit_price: 129.9, sale_fee: 18.2 }],
  };
}

function notificacao(orderId = ID) {
  const corpo = JSON.stringify({ topic: "orders_v2", resource: `/orders/${orderId}`, user_id: 999 });
  return new Request("http://localhost/api/ml/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(corpo.length) },
    body: corpo,
  });
}

beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  process.env.ML_SELLER_ID = "999";
  delete process.env.ML_APP_ID;
  estado.busca = [];
  estado.pedido = null;
  estado.durante = null;
  estado.duranteEm = "";
  vi.clearAllMocks();
  await db.recursiveDelete(db.collection("ml_orders"));
});

afterAll(async () => { await db.terminate(); });

describe("o caso da auditoria: webhook grava no meio do sync", () => {
  it("o sync leu 'paid'; enquanto buscava o envio, o webhook gravou o cancelamento — o cancelamento FICA, e o envio do sync entra", async () => {
    await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("paid", V1)) }]);

    estado.busca = [pedidoML("paid", V1)]; // o retrato que o sync leu no começo
    estado.pedido = pedidoML("cancelled", V2); // o que o webhook lê quando chega
    estado.duranteEm = "/shipments/";
    estado.durante = async () => {
      const r = await webhook(notificacao());
      expect(r.status).toBe(200);
    };

    const resultado = await syncOrdersRange("token-teste", { from: "2026-09-01T00:00:00.000-03:00", to: "2026-09-30T23:59:59.999-03:00" });
    expect(resultado.completo).toBe(true);
    expect(estado.durante).toBeNull(); // o webhook de fato rodou no meio

    const d = (await doc().get()).data()!;
    expect(d.status).toBe("cancelled"); // o código antigo voltava pra "paid"
    expect(d.last_updated).toBe(V2);
    // O que o sync trouxe de OUTRAS APIs entra mesmo com o retrato do pedido velho.
    expect(d.shipping_cost).toBe(21.5);
    expect(d.shipping_status).toBe("shipped");
    expect(d.net_received).toBe(100);
  });

  it("sem corrida, o sync grava o estado e o envio normalmente", async () => {
    estado.busca = [pedidoML("paid", V1)];
    await syncOrdersRange("token-teste", { from: "2026-09-01T00:00:00.000-03:00", to: "2026-09-30T23:59:59.999-03:00" });
    const d = (await doc().get()).data()!;
    expect(d).toMatchObject({ status: "paid", last_updated: V1, buyer_id: "555", shipping_id: "4400", shipping_cost: 21.5 });
    expect(d.items[0]).toMatchObject({ item_id: "MLB1", sale_fee: 18.2 });
  });
});

describe("webhook", () => {
  it("dois webhooks se cruzam: o que leu primeiro grava por último — e não cobre o cancelamento", async () => {
    await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("paid", V1)) }]);

    // Este webhook lê o pedido ainda pago; enquanto a resposta vem, o outro
    // (que leu depois) grava o cancelamento.
    estado.pedido = pedidoML("paid", V1);
    estado.duranteEm = `/orders/${ID}`;
    estado.durante = async () => {
      await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("cancelled", V2)) }]);
    };

    const r = await webhook(notificacao());
    expect(r.status).toBe(200);
    const d = (await doc().get()).data()!;
    expect(d.status).toBe("cancelled");
    expect(d.last_updated).toBe(V2);
  });

  it("retrato novo grava o estado, preserva o que o sync trouxe e ainda enxerga o 'antes' (cancelamento de venda conhecida)", async () => {
    await doc().set({
      ...estadoDoPedido(pedidoML("paid", V1)),
      shipping_cost: 21.5,
      shipping_status: "shipped",
    });
    estado.pedido = pedidoML("cancelled", V2);

    const r = await webhook(notificacao());
    expect(r.status).toBe(200);
    const d = (await doc().get()).data()!;
    expect(d).toMatchObject({ status: "cancelled", last_updated: V2, buyer_id: "555", shipping_cost: 21.5, shipping_status: "shipped" });
    // `antes` lido na transação ainda dizia "paid": o aviso de cancelamento sai.
    expect(vi.mocked(createNotificationEventIdempotent)).toHaveBeenCalledTimes(1);
  });
});

describe("gravarPedidos", () => {
  it("retrato velho sem nada de outra API: não toca o documento", async () => {
    await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("cancelled", V2)) }]);
    const antes = await doc().get();
    const [r] = await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("paid", V1)) }]);
    expect(r).toMatchObject({ gravouEstado: false, motivo: "gravado_mais_novo" });
    const depois = await doc().get();
    expect(depois.updateTime!.isEqual(antes.updateTime!)).toBe(true);
  });

  it("documento legado sem versão: o primeiro retrato versionado grava e passa a valer", async () => {
    await doc().set({ order_id: ID, status: "paid", shipping_cost: 10 });
    await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("cancelled", V1)) }]);
    const d = (await doc().get()).data()!;
    expect(d).toMatchObject({ status: "cancelled", last_updated: V1, shipping_cost: 10 });
  });

  it("retrato sem versão grava, mas a versão gravada continua barrando o mais velho", async () => {
    await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("paid", V2)) }]);
    await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("cancelled", undefined)) }]);
    expect((await doc().get()).data()).toMatchObject({ status: "cancelled", last_updated: V2 });
    await gravarPedidos(db, [{ orderId: ID, estado: estadoDoPedido(pedidoML("paid", V1)) }]);
    expect((await doc().get()).data()!.status).toBe("cancelled");
  });

  it("8 gravações do mesmo pedido ao mesmo tempo, em ordem embaralhada: fica o retrato mais novo", async () => {
    const base = Date.parse(V1);
    const versoes = [3, 7, 1, 5, 0, 6, 2, 4].map((k) => new Date(base + k * 60_000).toISOString());
    await Promise.all(versoes.map((v, k) =>
      gravarPedidos(db, [{ orderId: ID, estado: { ...estadoDoPedido(pedidoML("paid", v)), total_amount: k } }]),
    ));
    const d = (await doc().get()).data()!;
    expect(d.last_updated).toBe(versoes[1]); // a de +7 min
    expect(d.total_amount).toBe(1); // e o estado é o DELE, não o do último a gravar
  });

  it("mais de uma transação, com o mesmo pedido em duas páginas: todos gravados, e o repetido fica com o retrato mais novo", async () => {
    const pedidos = Array.from({ length: 150 }, (_, k) => ({
      orderId: String(3_000_000 + k),
      estado: estadoDoPedido(pedidoML("paid", V1, String(3_000_000 + k))),
    }));
    pedidos.push({ orderId: "3000000", estado: estadoDoPedido(pedidoML("cancelled", V2, "3000000")) });
    pedidos.push({ orderId: "3000001", estado: estadoDoPedido(pedidoML("cancelled", V1, "3000001")) });
    const r = await gravarPedidos(db, pedidos);
    expect(r).toHaveLength(150);
    expect((await db.collection("ml_orders").count().get()).data().count).toBe(150);
    expect((await db.collection("ml_orders").doc("3000000").get()).data()!.status).toBe("cancelled");
    // Mesma versão: fica o que veio depois, como fazia o batch antigo.
    expect((await db.collection("ml_orders").doc("3000001").get()).data()!.status).toBe("cancelled");
  });
});
