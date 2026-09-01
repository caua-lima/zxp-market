import { describe, expect, it } from "vitest";
import {
  duracaoDoEstoque,
  montarPlanoReposicao,
  necessarioParaJanela,
  type ProdutoReposicao,
} from "./reposicao";

const prod = (over: Partial<ProdutoReposicao> = {}): ProdutoReposicao => ({
  id: "p1", nome: "Erva Tradicional", estoqueTotal: 100, emCasa: 0,
  mediaDiaria: 2, custoUnitario: 10, ativo: true, ...over,
});

describe("duracaoDoEstoque", () => {
  it("100 unidades a 2 por dia duram 50 dias", () => {
    expect(duracaoDoEstoque(100, 2)).toBe(50);
  });

  it("arredonda pra BAIXO — dia parcial não é dia coberto", () => {
    expect(duracaoDoEstoque(10, 3)).toBe(3);
  });

  it("sem ritmo de venda não dá pra dizer quanto dura", () => {
    // null, e não Infinity: "não sei" não é "dura pra sempre".
    expect(duracaoDoEstoque(100, 0)).toBeNull();
    expect(duracaoDoEstoque(100, -1)).toBeNull();
  });

  it("estoque zerado dura zero dias", () => {
    expect(duracaoDoEstoque(0, 5)).toBe(0);
  });
});

describe("necessarioParaJanela", () => {
  it("arredonda pra CIMA — faltar custa mais que sobrar", () => {
    // 2,5 un/dia × 30 = 75; 2,4 × 30 = 72 exato; 2,41 × 30 = 72,3 → 73
    expect(necessarioParaJanela(2.41, 30)).toBe(73);
  });

  it("sem venda, não há necessidade a projetar", () => {
    expect(necessarioParaJanela(0, 45)).toBe(0);
  });

  it("janela zero não pede nada", () => {
    expect(necessarioParaJanela(5, 0)).toBe(0);
  });
});

/**
 * O caso que originou isto: o fornecedor fica 15 dias fora e a compra precisa
 * cobrir 30 dias DEPOIS de chegar.
 */
describe("o fornecedor fora por 15 dias", () => {
  it("a janela é a SOMA — prazo mais cobertura, não só a cobertura", () => {
    /**
     * É o erro que a conta ingênua comete: comprar pra 30 dias sem contar os
     * 15 de espera cobre 15, porque o estoque é consumido enquanto a
     * mercadoria não chega.
     */
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 0, mediaDiaria: 2 })], 15, 30);
    expect(plano.diasACobrir).toBe(45);
    expect(plano.itens[0].necessario).toBe(90); // 2 × 45, não 2 × 30
    expect(plano.itens[0].comprar).toBe(90);
  });

  it("desconta o que já existe em estoque", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 50, mediaDiaria: 2 })], 15, 30);
    expect(plano.itens[0].comprar).toBe(40); // 90 necessários − 50 em casa
  });

  it("estoque que já cobre a janela não entra na lista de compra", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 200, mediaDiaria: 2 })], 15, 30);
    expect(plano.itens).toEqual([]);
    expect(plano.suficientes).toBe(1);
  });

  it("MARCA quem acaba antes de o fornecedor voltar", () => {
    // 20 un a 2/dia = 10 dias. O fornecedor volta em 15: rompe antes.
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 20, mediaDiaria: 2 })], 15, 30);
    expect(plano.itens[0].duraDias).toBe(10);
    expect(plano.itens[0].rompeAntesDoPrazo).toBe(true);
    expect(plano.urgentes).toHaveLength(1);
  });

  it("quem atravessa a espera NÃO é marcado como urgente", () => {
    // 40 un a 2/dia = 20 dias > 15 de espera.
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 40, mediaDiaria: 2 })], 15, 30);
    expect(plano.itens[0].rompeAntesDoPrazo).toBe(false);
    expect(plano.urgentes).toEqual([]);
  });

  it("urgente aparece mesmo se por acaso não precisasse comprar", () => {
    /**
     * Cobertura 0 e prazo 15: o necessário é 30 e o estoque é 20, então
     * comprar > 0 aqui. O que este teste trava é a ORDEM da decisão: a marca
     * de ruptura é avaliada sempre, nunca some por causa de um filtro de
     * quantidade.
     */
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 20, mediaDiaria: 2 })], 15, 0);
    expect(plano.itens[0].rompeAntesDoPrazo).toBe(true);
  });
});

describe("ordem da lista", () => {
  it("urgentes primeiro, depois quem dura menos", () => {
    const plano = montarPlanoReposicao([
      prod({ id: "folgado", nome: "Folgado", estoqueTotal: 60, mediaDiaria: 2 }),   // 30 dias
      prod({ id: "urgente", nome: "Urgente", estoqueTotal: 10, mediaDiaria: 2 }),   // 5 dias
      prod({ id: "medio", nome: "Medio", estoqueTotal: 40, mediaDiaria: 2 }),       // 20 dias
    ], 15, 30);
    expect(plano.itens.map((i) => i.produtoId)).toEqual(["urgente", "medio", "folgado"]);
  });

  it("empate resolve por nome — a lista não pode dançar entre duas leituras", () => {
    const plano = montarPlanoReposicao([
      prod({ id: "b", nome: "Beta", estoqueTotal: 20, mediaDiaria: 1 }),
      prod({ id: "a", nome: "Alfa", estoqueTotal: 20, mediaDiaria: 1 }),
    ], 5, 30);
    expect(plano.itens.map((i) => i.nome)).toEqual(["Alfa", "Beta"]);
  });
});

describe("o que fica de fora", () => {
  it("produto sem venda no período não vira compra chutada", () => {
    const plano = montarPlanoReposicao([prod({ mediaDiaria: 0 })], 15, 30);
    expect(plano.itens).toEqual([]);
    expect(plano.semHistorico).toBe(1);
  });

  it("produto desativado é ignorado por completo", () => {
    const plano = montarPlanoReposicao([prod({ ativo: false, estoqueTotal: 0 })], 15, 30);
    expect(plano.itens).toEqual([]);
    expect(plano.semHistorico).toBe(0);
    expect(plano.suficientes).toBe(0);
  });
});

describe("totais", () => {
  it("soma unidades e investimento pra dar o tamanho do pedido", () => {
    const plano = montarPlanoReposicao([
      prod({ id: "a", nome: "A", estoqueTotal: 0, mediaDiaria: 1, custoUnitario: 10 }),  // 45 un
      prod({ id: "b", nome: "B", estoqueTotal: 0, mediaDiaria: 2, custoUnitario: 5 }),   // 90 un
    ], 15, 30);
    expect(plano.totalUnidades).toBe(135);
    expect(plano.totalInvestimento).toBeCloseTo(45 * 10 + 90 * 5, 2);
  });

  it("lista vazia devolve plano vazio, não quebra", () => {
    const plano = montarPlanoReposicao([], 15, 30);
    expect(plano.itens).toEqual([]);
    expect(plano.totalUnidades).toBe(0);
    expect(plano.totalInvestimento).toBe(0);
  });
});

describe("robustez dos parâmetros", () => {
  it("prazo zero = compra só a cobertura", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 0, mediaDiaria: 2 })], 0, 30);
    expect(plano.diasACobrir).toBe(30);
    expect(plano.itens[0].comprar).toBe(60);
  });

  it("valores negativos ou inválidos não viram janela negativa", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 0, mediaDiaria: 2 })], -5, Number.NaN);
    expect(plano.diasACobrir).toBe(0);
    expect(plano.itens).toEqual([]);
  });

  it("estoque negativo é tratado como zero", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: -10, mediaDiaria: 2 })], 15, 30);
    expect(plano.itens[0].comprar).toBe(90);
  });
});
