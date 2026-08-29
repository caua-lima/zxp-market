import { describe, expect, it } from "vitest";
import { estimateOrderFinance, type ProdutoCusto } from "./order-finance";
import { classifySale } from "@/lib/domain/notifications";

/**
 * Os números aqui NÃO são inventados: são o pedido 2000012170208604 desta
 * conta, conferido item a item contra a API do ML.
 *
 *   venda .......... R$ 38,60
 *   custo .......... R$ 26,38
 *   taxa do ML ..... R$  5,20
 *   imposto (4%) ... R$  1,544
 *   frete .......... R$  3,60   ← /shipments/{id}/costs
 *   ────────────────────────
 *   lucro .......... R$  1,876 →  4,86%
 *
 * Esse pedido foi notificado como "14,2% de margem". 14,2% é exatamente o
 * que dá quando o frete entra como zero — e era o que acontecia, porque o
 * app passava `order.shipping_cost` (o que o COMPRADOR pagou, sempre zero em
 * frete grátis) no lugar do custo do vendedor.
 */
const PEDIDO_REAL = [{ item_id: "MLB123", quantity: 1, unit_price: 38.6, sale_fee: 5.2, title: "Produto" }];
const CUSTOS = new Map<string, ProdutoCusto>([["123", { custo: 26.38, imposto: 4 }]]);
const SEM_SKU = new Map<string, ProdutoCusto>();
const DATA = "2026-08-28T10:00:00Z";

const estimar = (frete: number | null, itens = PEDIDO_REAL, custos = CUSTOS) =>
  estimateOrderFinance(itens, custos, SEM_SKU, frete, DATA, null);

describe("margem de um pedido real, conferida contra o ML", () => {
  it("com o frete do vendedor, bate com a realidade", () => {
    const r = estimar(3.6);
    expect(r.estimatedProfit).toBeCloseTo(1.876, 3);
    expect(r.estimatedMargin).toBeCloseTo(4.86, 2);
    expect(r.freteDesconhecido).toBe(false);
  });

  it("frete zerado devolve os 14,2% que o app anunciava — o erro, reproduzido", () => {
    // Este teste existe pra documentar o tamanho do estrago: quase 3x a
    // margem real, no número que decide preço.
    expect(estimar(0).estimatedMargin).toBeCloseTo(14.2, 1);
  });
});

describe("frete desconhecido não vira frete grátis", () => {
  it("null não é zero: sem o frete, não há margem a anunciar", () => {
    const r = estimar(null);
    expect(r.estimatedProfit).toBeNull();
    expect(r.estimatedMargin).toBeNull();
    expect(r.freteDesconhecido).toBe(true);
  });

  it("o valor bruto continua disponível — dá pra avisar da venda sem mentir a margem", () => {
    expect(estimar(null).grossAmount).toBeCloseTo(38.6, 2);
  });

  it("zero de verdade (comprador pagou o frete) segue calculando", () => {
    // fetchShippingCost devolve 0, e não null, quando o comprador arcou com o
    // frete. A distinção só serve se ela sobreviver até aqui.
    const r = estimar(0);
    expect(r.estimatedProfit).not.toBeNull();
    expect(r.freteDesconhecido).toBe(false);
  });

  it("produto sem cadastro também marca se o frete faltava", () => {
    const r = estimar(null, PEDIDO_REAL, SEM_SKU);
    expect(r.semCadastro).toBe(true);
    expect(r.freteDesconhecido).toBe(true);
    expect(r.estimatedProfit).toBeNull();
  });
});

describe("o efeito no alerta que o usuário recebe", () => {
  it("com o frete real, a venda cai no alerta de margem baixa", () => {
    expect(classifySale(estimar(3.6)).type).toBe("sale_low_margin");
  });

  it("sem o frete, a MESMA venda passava como saudável", () => {
    // 14,2% > 8% do limiar padrão. Era por isso que só 23 de 464 vendas
    // disparavam o alerta: as outras estavam sendo medidas sem o frete.
    expect(classifySale(estimar(0)).type).toBe("sale_paid");
  });

  it("frete desconhecido não classifica por margem — avisa a venda e cala sobre o resto", () => {
    expect(classifySale(estimar(null)).type).toBe("sale_paid");
  });
});
