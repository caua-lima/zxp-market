import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O cálculo da barra ao vivo com o pedido que ACABOU de mudar: a busca do ML
 * ainda não o lista (leva segundos), mas o número já tem que refleti-lo. ML e
 * banco simulados — nenhuma chamada real.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/ml/token", () => ({ getMlAccessToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/ml/vendedor", () => ({ sellerIdAtual: vi.fn(async () => "123") }));

let buscaDoMl: Record<string, unknown>[] = [];
vi.mock("@/lib/ml/orders", () => ({
  fetchOrdersLive: vi.fn(async () => buscaDoMl.map((p) => ({ ...p }))),
  loadOrders: vi.fn(async () => []),
}));

let banco: Record<string, Record<string, unknown>> = {};
const leiturasDoPedido = vi.fn();
const vazio = { docs: [], empty: true };
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (nome: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (nome === "ml_orders") leiturasDoPedido(id);
          return { exists: nome === "ml_orders" && id in banco, data: () => banco[id] };
        },
      }),
      where: () => ({ where: () => ({ get: async () => vazio }) }),
      orderBy: () => ({ limit: () => ({ get: async () => vazio }) }),
    }),
  }),
}));

const { calcularAoVivo } = await import("./ao-vivo-calculo");

const pedido = (id: string, valor: number, status = "paid") => ({
  order_id: id, status, date_created: "2026-10-23T14:30:00.000-03:00", total_amount: valor, pack_id: null,
  items: [{ item_id: "MLB1", title: "Limão", quantity: 1, unit_price: valor }],
});

let empresa = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T15:00:00.000-03:00"));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  buscaDoMl = [pedido("1", 100), pedido("2", 50)];
  banco = {};
  leiturasDoPedido.mockClear();
  empresa++; // cada teste com o cache limpo
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("calcularAoVivo com o pedido que acabou de mudar", () => {
  it("venda nova que a busca do ML ainda não lista entra pelo banco", async () => {
    banco["3"] = pedido("3", 189.9);
    const { body } = await calcularAoVivo({ empresa: `e${empresa}`, pedido: { orderId: "3", valida: true } });
    expect(body.hoje.vendas).toBeCloseTo(339.9, 2);
    expect(body.hoje.pedidos).toBe(3);
    expect(body.idsHoje).toContain("3");
    expect(leiturasDoPedido).toHaveBeenCalledWith("3");
  });

  it("o cache só serve se já reflete o pedido; refletindo, não relê", async () => {
    const e = `e${empresa}`;
    const a = await calcularAoVivo({ empresa: e });
    expect(a.doCache).toBe(false);
    banco["3"] = pedido("3", 10);
    const b = await calcularAoVivo({ empresa: e, pedido: { orderId: "3", valida: true } });
    expect(b.doCache).toBe(false); // o guardado não tinha o "3"
    const c = await calcularAoVivo({ empresa: e, pedido: { orderId: "3", valida: true } });
    expect(c.doCache).toBe(true);
    expect(c.body.hoje.pedidos).toBe(3);
  });

  it("cancelamento: o banco já diz cancelado, a busca ainda diz pago — vale o banco", async () => {
    const e = `e${empresa}`;
    expect((await calcularAoVivo({ empresa: e })).body.hoje.vendas).toBe(150);
    banco["2"] = pedido("2", 50, "cancelled");
    const { body, doCache } = await calcularAoVivo({ empresa: e, pedido: { orderId: "2", valida: false } });
    expect(doCache).toBe(false);
    expect(body.hoje.vendas).toBe(100);
    expect(body.idsHoje).not.toContain("2");
    expect(body.hoje.canceladoPedidos).toBe(1);
  });

  it("com o pedido em mãos (webhook), nem lê o banco", async () => {
    const { body } = await calcularAoVivo({ empresa: `e${empresa}`, pedido: { orderId: "9", valida: true, estado: pedido("9", 20) } });
    expect(body.idsHoje).toContain("9");
    expect(leiturasDoPedido).not.toHaveBeenCalled();
  });

  it("pedido que não existe em lugar nenhum não quebra nada", async () => {
    const { body } = await calcularAoVivo({ empresa: `e${empresa}`, pedido: { orderId: "404", valida: true } });
    expect(body.hoje.pedidos).toBe(2);
  });
});
