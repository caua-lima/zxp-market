import { describe, expect, it } from "vitest";
import { buildSaleContent, corpoComValor } from "./notifications";

const base = {
  type: "sale_paid" as const,
  productName: "Erva Mate", itemCount: 1,
  grossAmount: 89.9, metaMargem: null,
};

describe("buildSaleContent — venda sem produto cadastrado", () => {
  it("diz o que houve e por que o numero esta errado", () => {
    const c = buildSaleContent({
      ...base, estimatedProfit: null, estimatedMargin: null, semCadastro: true,
    });
    expect(c.title).toBe("Venda de produto sem cadastro");
    expect(c.body).toContain("lucro está inflado");
  });

  it("sem cadastro NAO e o mesmo que calculo pendente", () => {
    // Dado que vai chegar sozinho vs. dado que so chega se alguem cadastrar:
    // a acao do usuario e diferente, entao o texto tem que ser diferente.
    const pendente = buildSaleContent({
      ...base, estimatedProfit: null, estimatedMargin: null, semCadastro: false,
    });
    expect(pendente.title).toBe("Nova venda confirmada");
    expect(pendente.body).toContain("em atualização");
  });

  it("venda normal com lucro nao e afetada pela flag", () => {
    const c = buildSaleContent({
      ...base, estimatedProfit: 20, estimatedMargin: 22, semCadastro: false,
    });
    expect(c.title).toBe("Nova venda confirmada");
  });
});

describe("buildSaleContent — pedido com mais de um produto", () => {
  it("2 itens nomeia os dois, nao fala 'itens no pedido'", () => {
    const c = buildSaleContent({
      ...base, itemCount: 2, estimatedProfit: 20, estimatedMargin: 22,
      itens: [{ title: "Erva Mate", quantity: 1 }, { title: "Cuia de vidro", quantity: 1 }],
    });
    expect(c.body).toContain("Erva Mate e Cuia de vidro");
  });

  it("3+ itens nomeia o primeiro e conta o resto", () => {
    const c = buildSaleContent({
      ...base, itemCount: 3, estimatedProfit: 20, estimatedMargin: 22,
      itens: [{ title: "Erva Mate", quantity: 1 }, { title: "Cuia", quantity: 1 }, { title: "Bomba", quantity: 1 }],
    });
    expect(c.body).toContain("Erva Mate e outros 2");
  });

  it("sem detalhe de itens, cai no texto antigo — nunca quebra", () => {
    const c = buildSaleContent({ ...base, itemCount: 4, estimatedProfit: 20, estimatedMargin: 22 });
    expect(c.body).toContain("4 itens no pedido");
  });
});

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

describe("corpoComValor — S29 da auditoria SaaS (Central duplicava o valor)", () => {
  it("nao duplica quando o corpo JA menciona o valor (sale_paid com lucro calculado)", () => {
    const c = buildSaleContent({ ...base, type: "sale_paid", estimatedProfit: 15, estimatedMargin: 16 });
    expect(c.body).toContain("R$"); // buildSaleContent ja embute o valor
    expect(corpoComValor(c.body, base.grossAmount)).toBe(c.body);
  });

  it("anexa o valor quando o corpo NAO menciona (sale_low_margin so mostra a margem %)", () => {
    const c = buildSaleContent({ ...base, type: "sale_low_margin", estimatedMargin: 3, estimatedProfit: 2.7 });
    expect(c.body).not.toContain("R$");
    const resultado = corpoComValor(c.body, base.grossAmount);
    expect(resultado).toBe(`${c.body} · ${brl(base.grossAmount)}`);
  });

  it("sem grossAmount, devolve o corpo intacto", () => {
    expect(corpoComValor("Produto X", undefined)).toBe("Produto X");
  });

  it("reproducao exata do achado: corpo que ja tem o valor nao ganha um segundo", () => {
    const corpo = `${brl(19.3)} · Produto`;
    expect(corpoComValor(corpo, 19.3)).toBe(corpo);
  });
});
