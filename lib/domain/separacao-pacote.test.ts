import { describe, expect, it } from "vitest";
import { canceladoPorSeparacao, motivoDoCancelamento, nasceuDeSeparacao, origemDaSeparacao, type PedidoParaOrigem } from "./separacao-pacote";

// Formas reais (pacote 2000016125187359, 18/11/2026), sem dado do comprador.
const original = {
  id: 2000019629390092, status: "cancelled",
  cancel_detail: { group: "internal", code: "pack_splitted", description: "Purchases has splitted the pack", requested_by: "meli" },
  tags: ["order_has_discount", "not_delivered", "not_paid", "pack_order"], pack_id: 2000016125187359,
};
const novo = { id: 2000019633615054, status: "paid", cancel_detail: null, tags: ["order_has_discount", "splitted_order", "paid", "not_delivered", "pack_order"], pack_id: 2000016129304971 };
const canceladoDeVerdade = { id: 1, status: "cancelled", cancel_detail: { group: "buyer", code: "buyer_cancel_express", requested_by: "buyer" }, tags: [] };

describe("separação de pacote", () => {
  it("o original cancelado pelo ML na separação", () => {
    expect(motivoDoCancelamento(original)).toBe("pack_splitted");
    expect(canceladoPorSeparacao(original)).toBe(true);
    expect(nasceuDeSeparacao(original)).toBe(false);
  });

  it("o pedido novo que nasceu da separação", () => {
    expect(nasceuDeSeparacao(novo)).toBe(true);
    expect(canceladoPorSeparacao(novo)).toBe(false);
  });

  it("cancelamento do comprador continua cancelamento", () => {
    expect(canceladoPorSeparacao(canceladoDeVerdade)).toBe(false);
    expect(motivoDoCancelamento({ status: "cancelled" })).toBeNull();
  });

  it("documento gravado (motivo_cancelamento) vale igual", () => {
    expect(canceladoPorSeparacao({ status: "cancelled", motivo_cancelamento: "pack_splitted" })).toBe(true);
    expect(canceladoPorSeparacao({ status: "paid", motivo_cancelamento: "pack_splitted" })).toBe(false);
    expect(canceladoPorSeparacao({ status: "cancelled", motivo_cancelamento: "fraud" })).toBe(false);
  });
});

describe("data da venda na separação de pacote (origemDaSeparacao)", () => {
  // Pacote 2000016125187359, medido em 26/11/2026: compra 17/11 22:10, separado 18/11 05:04.
  const originais: PedidoParaOrigem[] = [
    { orderId: "2000019629390092", buyerId: "B1", status: "cancelled", motivoCancelamento: "pack_splitted", canceladoEm: "2026-11-18T05:04:32.000-04:00", dateCreated: "2026-11-17T22:10:25.000-04:00", packId: "2000016125187359", itens: ["MLB5522105835"] },
    { orderId: "2000019629388530", buyerId: "B1", status: "cancelled", motivoCancelamento: "pack_splitted", canceladoEm: "2026-11-18T05:04:33.000-04:00", dateCreated: "2026-11-17T22:10:25.000-04:00", packId: "2000016125187359", itens: ["MLB4982932025"] },
  ];

  it("o pedido novo herda a data da COMPRA, não a da separação", () => {
    const o = origemDaSeparacao({ buyerId: "B1", dateCreated: "2026-11-18T05:05:20.000-04:00", itens: ["MLB4982932025"] }, originais)!;
    expect(o.dateCreated).toBe("2026-11-17T22:10:25.000-04:00");
    expect(o.pedidos).toEqual(["2000019629388530", "2000019629390092"]);
    expect(o.packId).toBe("2000016125187359");
  });

  it("3 tererés separados em 2 + 1: os dois envios novos herdam a mesma data", () => {
    const um: PedidoParaOrigem[] = [{ orderId: "O1", buyerId: "B2", status: "cancelled", motivoCancelamento: "pack_splitted", canceladoEm: "2026-11-26T09:00:10.000-03:00", dateCreated: "2026-11-25T20:12:00.000-03:00", packId: null, itens: ["MLB4982692927"] }];
    const a = origemDaSeparacao({ buyerId: "B2", dateCreated: "2026-11-26T09:00:40.000-03:00", itens: ["MLB4982692927"] }, um)!;
    const b = origemDaSeparacao({ buyerId: "B2", dateCreated: "2026-11-26T09:00:41.000-03:00", itens: ["MLB4982692927"] }, um)!;
    expect(a.dateCreated).toBe("2026-11-25T20:12:00.000-03:00");
    expect(b.dateCreated).toBe(a.dateCreated);
    expect(a.pedidos).toEqual(["O1"]);
  });

  it("não liga a cancelamento de verdade nem a outro comprador", () => {
    const cancelReal = originais.map((x) => ({ ...x, motivoCancelamento: "buyer_cancel" }));
    expect(origemDaSeparacao({ buyerId: "B1", dateCreated: "2026-11-18T05:05:20.000-04:00", itens: ["MLB4982932025"] }, cancelReal)).toBeNull();
    expect(origemDaSeparacao({ buyerId: "OUTRO", dateCreated: "2026-11-18T05:05:20.000-04:00", itens: ["MLB4982932025"] }, originais)).toBeNull();
  });

  it("anúncio que não estava na compra separada não herda", () => {
    expect(origemDaSeparacao({ buyerId: "B1", dateCreated: "2026-11-18T05:05:20.000-04:00", itens: ["MLB9999999999"] }, originais)).toBeNull();
  });

  it("cancelamento longe da criação do novo (mais de 2 h) não é esta separação", () => {
    expect(origemDaSeparacao({ buyerId: "B1", dateCreated: "2026-11-19T10:00:00.000-04:00", itens: ["MLB4982932025"] }, originais)).toBeNull();
  });

  it("original gravado sem a hora do cancelamento: janela de 10 dias", () => {
    const semHora = originais.map((x) => ({ ...x, canceladoEm: null }));
    expect(origemDaSeparacao({ buyerId: "B1", dateCreated: "2026-11-18T05:05:20.000-04:00", itens: ["MLB4982932025"] }, semHora)?.dateCreated).toBe("2026-11-17T22:10:25.000-04:00");
    expect(origemDaSeparacao({ buyerId: "B1", dateCreated: "2026-12-05T05:05:20.000-04:00", itens: ["MLB4982932025"] }, semHora)).toBeNull();
  });

  it("original criado DEPOIS do novo não serve", () => {
    expect(origemDaSeparacao({ buyerId: "B1", dateCreated: "2026-11-17T20:00:00.000-04:00", itens: ["MLB4982932025"] }, originais)).toBeNull();
  });
});
