import { describe, expect, it } from "vitest";
import { comVendasNovas, sinalDoPedido, vendasAindaPendentes, type VendaNova } from "./ao-vivo-tempo-real";

// 23/10/2026 14:40 em São Paulo
const AGORA = Date.parse("2026-10-23T14:40:00.000-03:00");

const pedido = (o: Record<string, unknown> = {}) => ({
  order_id: "2000123", status: "paid", date_created: "2026-10-23T14:39:10.000-04:00", total_amount: 189.9,
  items: [{ title: "Limão Caipira 500 g", quantity: 2 }, { title: "Erva", quantity: 1 }], ...o,
});

describe("sinalDoPedido — quando o pedido vira sinal pra barra", () => {
  it("pedido novo e pago: sinal com valor, unidades, título e a data do pedido", () => {
    expect(sinalDoPedido(pedido(), undefined, AGORA)).toEqual({
      orderId: "2000123", valida: true, valor: 189.9, unidades: 3, titulo: "Limão Caipira 500 g",
      dateCreated: "2026-10-23T14:39:10.000-04:00", em: AGORA,
    });
  });

  it("mudança de envio num pedido já conhecido não é sinal (o webhook dispara a cada mudança)", () => {
    expect(sinalDoPedido(pedido(), { status: "paid" }, AGORA)).toBeNull();
    // status diferente mas ainda venda (pagamento aprovado depois): a barra já contava
    expect(sinalDoPedido(pedido(), { status: "payment_required" }, AGORA)).toBeNull();
  });

  it("virou cancelado: sinal de releitura; voltou de cancelado: sinal de venda", () => {
    expect(sinalDoPedido(pedido({ status: "cancelled" }), { status: "paid" }, AGORA)).toMatchObject({ valida: false, orderId: "2000123" });
    expect(sinalDoPedido(pedido(), { status: "cancelled" }, AGORA)).toMatchObject({ valida: true });
  });

  it("nasceu cancelado, pedido de outro dia ou sem id: nada", () => {
    expect(sinalDoPedido(pedido({ status: "cancelled" }), undefined, AGORA)).toBeNull();
    expect(sinalDoPedido(pedido({ date_created: "2026-10-20T10:00:00.000-03:00" }), undefined, AGORA)).toBeNull();
    expect(sinalDoPedido(pedido({ order_id: "" }), undefined, AGORA)).toBeNull();
  });

  it("ontem ainda vale (alimenta o 'vs ontem')", () => {
    expect(sinalDoPedido(pedido({ date_created: "2026-10-22T23:50:00.000-03:00" }), undefined, AGORA)).not.toBeNull();
  });
});

const dados = () => ({
  dia: "2026-10-23",
  hoje: { vendas: 1000, pedidos: 4, unidades: 6, canceladoValor: 0, canceladoPedidos: 0 },
  porHora: { hoje: Array(24).fill(0), ontem: Array(24).fill(0) },
  ultimaVenda: { em: Date.parse("2026-10-23T13:00:00.000-03:00"), valor: 50, titulo: "Erva" },
  idsHoje: ["a", "b", "c", "d"],
  metaDoDia: { alvo: 2000, metaIndex: 1, metaDoMes: 60000, pct: 50, falta: 1000, batida: false, mesBatido: false },
  visitas: 10,
});
const venda = (o: Partial<VendaNova> = {}): VendaNova => ({
  orderId: "n1", valor: 189.9, unidades: 3, titulo: "Limão", dateCreated: "2026-10-23T14:39:10.000-03:00", recebidaEm: AGORA, ...o,
});

describe("comVendasNovas — a venda aparece na hora, sem contar duas vezes", () => {
  it("soma valor, pedido, unidades, a hora, a última venda e refaz a meta", () => {
    const r = comVendasNovas(dados(), [venda()]);
    expect(r.hoje).toEqual({ vendas: 1189.9, pedidos: 5, unidades: 9, canceladoValor: 0, canceladoPedidos: 0 });
    expect(r.porHora.hoje[14]).toBe(189.9);
    expect(r.ultimaVenda).toEqual({ em: Date.parse("2026-10-23T14:39:10.000-03:00"), valor: 189.9, titulo: "Limão" });
    expect(r.metaDoDia).toMatchObject({ alvo: 2000, metaIndex: 1, falta: 810.1, batida: false });
    expect(r.metaDoDia!.pct).toBeCloseTo(59.495, 3);
    expect(r.idsHoje).toContain("n1");
    expect(r.visitas).toBe(10);
  });

  it("venda já contada pela rota, repetida ou de outro dia não entra", () => {
    const d = dados();
    expect(comVendasNovas(d, [venda({ orderId: "a" })])).toBe(d);
    expect(comVendasNovas(d, [venda({ dateCreated: "2026-10-22T10:00:00.000-03:00" })])).toBe(d);
    expect(comVendasNovas(d, [venda(), venda()]).hoje.pedidos).toBe(5);
  });

  it("bater o alvo vira 'batida'; não mexe no original", () => {
    const d = dados();
    const r = comVendasNovas(d, [venda({ valor: 1000 })]);
    expect(r.metaDoDia).toMatchObject({ falta: 0, batida: true, pct: 100 });
    expect(d.hoje.vendas).toBe(1000);
  });

  it("sem meta (null) continua sem", () => {
    expect(comVendasNovas({ ...dados(), metaDoDia: null }, [venda()]).metaDoDia).toBeNull();
  });
});

describe("vendasAindaPendentes", () => {
  it("some a que a rota já contou, a de outro dia e a velha demais", () => {
    const pend = [venda({ orderId: "a" }), venda({ orderId: "x" }), venda({ orderId: "y", recebidaEm: AGORA - 6 * 60_000 }), venda({ orderId: "z", dateCreated: "2026-10-22T10:00:00.000-03:00" })];
    expect(vendasAindaPendentes(pend, dados(), AGORA).map((v) => v.orderId)).toEqual(["x"]);
  });
});
