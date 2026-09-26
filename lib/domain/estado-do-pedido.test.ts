import { describe, expect, it } from "vitest";
import { estadoDoPedido, podeGravarEstado, versaoDoPedido } from "./estado-do-pedido";

const PEDIDO = {
  id: 2000001,
  status: "paid",
  date_created: "2026-09-20T10:00:00.000-04:00",
  last_updated: "2026-09-20T10:05:00.000-04:00",
  total_amount: 129.9,
  currency_id: "BRL",
  buyer: { id: 555 },
  pack_id: 2000009,
  shipping: { id: 4400 },
  order_items: [{ item: { id: "MLB1", seller_sku: "SKU-1", title: "Produto" }, quantity: 2, unit_price: 64.95, sale_fee: 9.1 }],
};

describe("versaoDoPedido", () => {
  it("lê o last_updated do ML como instante, respeitando o fuso", () => {
    expect(versaoDoPedido("2026-09-20T10:05:00.000-04:00")).toBe(Date.parse("2026-09-20T14:05:00.000Z"));
  });

  it("ordena por instante, não por texto: fusos diferentes", () => {
    // Como texto, "…11:00…-04:00" < "…12:00…Z"; como instante é o contrário
    // (11h em -04:00 são 15h UTC).
    const a = versaoDoPedido("2026-09-20T11:00:00.000-04:00")!;
    const b = versaoDoPedido("2026-09-20T12:00:00.000Z")!;
    expect(a).toBeGreaterThan(b);
  });

  it("ausente ou ilegível é null — nunca um número inventado", () => {
    for (const v of [undefined, null, "", "   ", "ontem", 123, {}]) expect(versaoDoPedido(v)).toBeNull();
  });
});

describe("podeGravarEstado — S12: retrato velho não cobre retrato novo", () => {
  const V1 = "2026-09-20T10:05:00.000-04:00";
  const V2 = "2026-09-20T10:09:00.000-04:00";

  it("o caso da auditoria: webhook gravou o cancelamento (V2), o sync chega com o 'paid' que leu antes (V1) — NÃO grava", () => {
    expect(podeGravarEstado(versaoDoPedido(V1), V2)).toEqual({ gravar: false, motivo: "gravado_mais_novo" });
  });

  it("retrato mais novo grava", () => {
    expect(podeGravarEstado(versaoDoPedido(V2), V1)).toEqual({ gravar: true, motivo: "igual_ou_mais_novo" });
  });

  it("mesmo retrato grava — traz o que só um dos caminhos tinha (o envio, do sync)", () => {
    expect(podeGravarEstado(versaoDoPedido(V1), V1).gravar).toBe(true);
  });

  it("documento novo, ou legado sem versão: grava", () => {
    expect(podeGravarEstado(versaoDoPedido(V1), undefined)).toEqual({ gravar: true, motivo: "sem_versao_gravada" });
    expect(podeGravarEstado(versaoDoPedido(V1), "lixo")).toEqual({ gravar: true, motivo: "sem_versao_gravada" });
  });

  it("retrato sem versão grava — como antes; a alternativa congelaria o pedido se o ML parasse de mandar o campo", () => {
    expect(podeGravarEstado(null, V2)).toEqual({ gravar: true, motivo: "retrato_sem_versao" });
  });
});

describe("estadoDoPedido — um mapeamento pros três caminhos", () => {
  it("leva a versão junto do estado", () => {
    expect(estadoDoPedido(PEDIDO)).toEqual({
      order_id: "2000001",
      status: "paid",
      date_created: "2026-09-20T10:00:00.000-04:00",
      total_amount: 129.9,
      currency: "BRL",
      buyer_id: "555",
      items: [{ item_id: "MLB1", sku: "SKU-1", title: "Produto", quantity: 2, unit_price: 64.95, sale_fee: 9.1 }],
      pack_id: "2000009",
      shipping_id: "4400",
      last_updated: "2026-09-20T10:05:00.000-04:00",
    });
  });

  it("itens com item_id e sale_fee — a rota legada gravava sem os dois, e a margem do pedido mudava", () => {
    const [item] = estadoDoPedido(PEDIDO).items as Record<string, unknown>[];
    expect(item.item_id).toBe("MLB1");
    expect(item.sale_fee).toBe(9.1);
  });

  it("sem comprador, sem envio ou sem versão: NÃO escreve o campo (merge apagaria o que outro retrato salvou)", () => {
    const e = estadoDoPedido({ ...PEDIDO, buyer: undefined, shipping: {}, last_updated: undefined });
    expect(e).not.toHaveProperty("buyer_id");
    expect(e).not.toHaveProperty("shipping_id");
    expect(e).not.toHaveProperty("last_updated");
  });

  it("nunca grava campo de envio que o pedido não traz (era o shipping_status: null da rota legada)", () => {
    expect(estadoDoPedido(PEDIDO)).not.toHaveProperty("shipping_status");
    expect(estadoDoPedido(PEDIDO)).not.toHaveProperty("raw");
  });
});
