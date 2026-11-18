import { describe, expect, it } from "vitest";
import { canceladoPorSeparacao, motivoDoCancelamento, nasceuDeSeparacao } from "./separacao-pacote";

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
