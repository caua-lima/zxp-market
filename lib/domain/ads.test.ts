import { describe, expect, it } from "vitest";
import { calculateBreakEvenRoas, calculateTargetRoas, getAdRecommendation, lucroNoRoas, motivoSemRoasIdeal } from "./ads";

describe("calculateBreakEvenRoas", () => {
  it("lucroAntesAds <= 0 nunca tem ROAS que salve — retorna null, nao 0/Infinity", () => {
    expect(calculateBreakEvenRoas(100, 0)).toBeNull();
    expect(calculateBreakEvenRoas(100, -5)).toBeNull();
  });
  it("vendas <= 0 tambem retorna null", () => {
    expect(calculateBreakEvenRoas(0, 50)).toBeNull();
  });
  it("caso normal: vendas / lucroAntesAds", () => {
    expect(calculateBreakEvenRoas(200, 50)).toBe(4);
  });
});

describe("getAdRecommendation", () => {
  const base = { clicks: 100, vendas: 5, cost: 100, lucro: 50, roas: 3, roasTarget: 2, breakEvenRoas: 2, margem: 20, metaMargem: 10 };

  it("saudavel: margem e ROAS acima do alvo/break-even recomenda escalar", () => {
    const r = getAdRecommendation({ ...base, roas: 5, roasTarget: 2, breakEvenRoas: 2, margem: 25, metaMargem: 10 });
    expect(r.acao).toBe("escalar");
    expect(r.tone).toBe("opportunity");
  });

  it("lucro negativo com investimento relevante recomenda revisar/reduzir, nunca a palavra isolada 'Pausar'", () => {
    const r = getAdRecommendation({ ...base, lucro: -10, cost: 50 });
    expect(r.acao).toBe("pausar");
    expect(r.label.toLowerCase()).toContain("revisar");
    expect(r.label).not.toBe("Pausar");
    expect(r.tone).toBe("critical");
  });

  it("gasto sem nenhuma venda, com volume de cliques suficiente, e roas abaixo do alvo/break-even recomenda reduzir", () => {
    const r = getAdRecommendation({ ...base, vendas: 0, lucro: null, roas: 0, roasTarget: 2, breakEvenRoas: 2, margem: null, cost: 40 });
    expect(r.acao).toBe("reduzir");
    expect(r.label.toLowerCase()).toContain("revisar");
  });

  it("baixo volume (poucos cliques e nenhuma venda) vira sem-dados, mesmo com prejuizo", () => {
    const r = getAdRecommendation({ ...base, clicks: 5, vendas: 0, lucro: -50 });
    expect(r.acao).toBe("sem-dados");
    expect(r.tone).toBe("info");
  });

  it("dados insuficientes (lucro null, sem roasTarget nem breakEven) tambem vira sem-dados", () => {
    const r = getAdRecommendation({ ...base, lucro: null, roasTarget: 0, breakEvenRoas: null, margem: null });
    expect(r.acao).toBe("sem-dados");
  });

  it("abaixo do alvo E do break-even recomenda reduzir", () => {
    const r = getAdRecommendation({ ...base, lucro: 5, roas: 1, roasTarget: 2, breakEvenRoas: 2 });
    expect(r.acao).toBe("reduzir");
  });
});

describe("calculateTargetRoas", () => {
  it("com meta 0%, e exatamente o break-even (por construcao)", () => {
    const be = calculateBreakEvenRoas(1000, 250);
    expect(calculateTargetRoas(1000, 250, 0)).toBeCloseTo(be!, 10);
  });

  it("meta de margem exige ROAS MAIOR que o break-even", () => {
    const be = calculateBreakEvenRoas(1000, 250)!;   // 4x
    const alvo = calculateTargetRoas(1000, 250, 10)!; // margem 10%
    expect(alvo).toBeGreaterThan(be);
    // R / (L0 - m*R) = 1000 / (250 - 100) = 6,666...
    expect(alvo).toBeCloseTo(1000 / 150, 6);
  });

  it("produto que nao alcanca a margem nem gastando zero em ads devolve null", () => {
    // L0 = 100 e a meta de 20% sobre 1000 exigiria 200 de lucro: impossivel.
    expect(calculateTargetRoas(1000, 100, 20)).toBeNull();
  });

  it("sem venda ou sem lucro antes de ads, nao ha alvo", () => {
    expect(calculateTargetRoas(0, 250, 10)).toBeNull();
    expect(calculateTargetRoas(1000, 0, 10)).toBeNull();
    expect(calculateTargetRoas(1000, -50, 10)).toBeNull();
  });

  it("meta negativa e tratada como zero, nunca afrouxa abaixo do break-even", () => {
    const be = calculateBreakEvenRoas(1000, 250)!;
    expect(calculateTargetRoas(1000, 250, -30)).toBeCloseTo(be, 10);
  });
});

describe("lucroNoRoas — o ROAS ideal traduzido em dinheiro", () => {
  it("bate com a conta feita a mao", () => {
    // Receita 1000, lucro antes do ads 200. Pra ROAS 10x o ad pode custar
    // 1000/10 = 100 → sobra 200 − 100 = 100.
    expect(lucroNoRoas(1000, 200, 10)).toBeCloseTo(100, 2);
  });

  it("no proprio break-even o lucro e exatamente zero", () => {
    const be = calculateBreakEvenRoas(1000, 200)!;
    expect(lucroNoRoas(1000, 200, be)).toBeCloseTo(0, 6);
  });

  it("no ROAS ideal o lucro entrega a margem alvo", () => {
    const alvo = calculateTargetRoas(1000, 200, 10)!;
    // margem alvo 10% sobre receita de 1000 = 100 de lucro
    expect(lucroNoRoas(1000, 200, alvo)).toBeCloseTo(100, 2);
  });

  it("ROAS maior sobra mais — a curva anda pro lado certo", () => {
    expect(lucroNoRoas(1000, 200, 20)!).toBeGreaterThan(lucroNoRoas(1000, 200, 10)!);
  });

  it("sem alvo ou sem receita devolve null, nao zero", () => {
    expect(lucroNoRoas(1000, 200, null)).toBeNull();
    expect(lucroNoRoas(1000, 200, 0)).toBeNull();
    expect(lucroNoRoas(0, 200, 10)).toBeNull();
  });

  it("produto no prejuizo antes do ads segue negativo em qualquer ROAS", () => {
    expect(lucroNoRoas(1000, -50, 30)).toBeLessThan(0);
  });
});

describe("motivoSemRoasIdeal — explica o traco em vez de so mostrar '—'", () => {
  it("quando HA ROAS ideal, nao ha motivo", () => {
    expect(motivoSemRoasIdeal(1000, 200, 10)).toBeNull();
  });

  it("sem venda atribuida, diz que falta receita", () => {
    expect(motivoSemRoasIdeal(0, 200, 10)).toMatch(/Sem venda atribuída/);
  });

  it("produto que nao cobre o proprio custo tem texto proprio", () => {
    expect(motivoSemRoasIdeal(1000, -10, 10)).toMatch(/não cobre o próprio custo/);
  });

  it("margem real abaixo da meta aponta preco/custo, nao campanha", () => {
    // Rende 5% antes do ads; meta 10% → nenhum ROAS resolve.
    const m = motivoSemRoasIdeal(1000, 50, 10)!;
    expect(m).toMatch(/5\.0%/);
    expect(m).toMatch(/preço ou no custo/);
  });
});

describe("getAdRecommendation — nao chamar conclusao de 'sem dados'", () => {
  const base = {
    clicks: 30, vendas: 100, cost: 10, lucro: 5, roas: 10,
    roasTarget: 0, breakEvenRoas: 5, margem: 20, metaMargem: 10,
    lucroAntesAds: 15,
  };

  it("produto no vermelho ANTES do ads aponta preco/custo, nao a campanha", () => {
    // Caso medido: Boldo com ROAS 33x e lucroAntesAds -2,95. Antes isso caia
    // em "Sem dados suficientes", mandando esperar dado que ja existia.
    const r = getAdRecommendation({ ...base, clicks: 4, vendas: 39.8, cost: 1.2, lucro: -4.15, roas: 33.17, breakEvenRoas: null, margem: -10.4, lucroAntesAds: -2.95 });
    expect(r.label).toMatch(/vermelho antes do Ads/);
    expect(r.tone).toBe("critical");
  });

  it("vale mesmo com ROAS excelente — o ROAS nao salva produto que nao se paga", () => {
    const r = getAdRecommendation({ ...base, roas: 99, lucroAntesAds: -1 });
    expect(r.label).toMatch(/vermelho antes do Ads/);
  });

  it("gasto relevante sem venda atribuida vira alerta, nao 'sem dados'", () => {
    const r = getAdRecommendation({ ...base, vendas: 0, cost: 50, lucro: -50, roas: 0, breakEvenRoas: null, margem: null, lucroAntesAds: null });
    expect(r.acao).toBe("reduzir");
    expect(r.label).toMatch(/sem venda atribuída/);
  });

  it("gasto pequeno sem venda diz QUANTO e quantos cliques, nao so 'sem dados'", () => {
    const r = getAdRecommendation({ ...base, clicks: 10, vendas: 0, cost: 4.79, lucro: -4.79, roas: 0, breakEvenRoas: null, margem: null, lucroAntesAds: null });
    expect(r.label).toMatch(/10 clique/);
    expect(r.label).toMatch(/4,79/);
  });

  it("zero clique e zero venda: nao ha o que concluir mesmo", () => {
    const r = getAdRecommendation({ ...base, clicks: 0, vendas: 0, cost: 0.68, lucro: null, roas: 0, breakEvenRoas: null, margem: null, lucroAntesAds: null });
    expect(r.label).toBe("Sem cliques no período");
  });

  it("volume baixo COM venda diz o que falta pra concluir", () => {
    const r = getAdRecommendation({ ...base, clicks: 5, margem: 2, roasTarget: 0, breakEvenRoas: 3, roas: 4 });
    expect(r.label).toMatch(/Volume baixo/);
    expect(r.label).toMatch(/5 clique/);
  });

  it("saudavel continua saudavel — a mudanca nao rouba o caso bom", () => {
    const r = getAdRecommendation(base);
    expect(r.acao).toBe("escalar");
  });

  it("prejuizo confirmado com gasto relevante continua critico", () => {
    const r = getAdRecommendation({ ...base, lucro: -30, cost: 60, margem: -5, lucroAntesAds: 10 });
    expect(r.acao).toBe("pausar");
    expect(r.label).toMatch(/prejuízo confirmado/);
  });

  it("nenhum caminho devolve mais o texto generico antigo", () => {
    const casos = [
      { ...base },
      { ...base, clicks: 0, vendas: 0 },
      { ...base, vendas: 0, cost: 50 },
      { ...base, clicks: 5, margem: 2, breakEvenRoas: 3, roas: 4 },
      { ...base, lucroAntesAds: -1 },
    ];
    for (const c of casos) {
      expect(getAdRecommendation(c).label).not.toBe("Sem dados suficientes");
    }
  });
});

/**
 * Produto anunciado SEM custo cadastrado.
 *
 * Medido na conta: 5 anúncios sem vínculo no Estoque, R$ 1.975,13 em 60 dias
 * (5,3% do faturamento). A rota de ads somava o custo desses como ZERO, então
 * eles apareciam com margem perto de 100% — os melhores da tela, por falta de
 * dado. Corrigido o zero, o lucro chega zerado até aqui, e sem esta distinção
 * a tela passaria a mandar PAUSAR justamente esses anúncios.
 *
 * Os dois erros são simétricos e igualmente caros: um manda investir no que
 * não se conhece, o outro manda desligar o que talvez fosse o melhor.
 */
describe("anúncio de produto sem custo cadastrado", () => {
  const semCusto = {
    clicks: 100, vendas: 5, cost: 100, lucro: null, roas: 3, roasTarget: 2,
    breakEvenRoas: null, margem: null, metaMargem: 10,
    lucroAntesAds: 0, custoConhecido: false,
  };

  it("NÃO manda pausar — falta de cadastro não é diagnóstico de campanha", () => {
    const r = getAdRecommendation(semCusto);
    expect(r.acao).not.toBe("pausar");
    expect(r.acao).toBe("sem-dados");
  });

  it("diz o que fazer: cadastrar o custo, não mexer em preço", () => {
    expect(getAdRecommendation(semCusto).label).toMatch(/custo/i);
    expect(getAdRecommendation(semCusto).label).toMatch(/estoque/i);
  });

  it("com custo conhecido, lucro zero volta a significar 'no vermelho'", () => {
    // A regra antiga continua valendo quando o dado EXISTE — é a conclusão
    // certa ali, e o que mudou foi só deixar de confundi-la com ausência.
    const r = getAdRecommendation({ ...semCusto, custoConhecido: true });
    expect(r.acao).toBe("pausar");
    expect(r.label).toMatch(/vermelho/i);
  });

  it("sem informar custoConhecido, o comportamento é o de antes", () => {
    // Compatibilidade: quem já chamava sem o campo não muda de resposta.
    const semOCampo = { ...semCusto, custoConhecido: undefined };
    expect(getAdRecommendation(semOCampo).acao).toBe("pausar");
  });

  it("o motivo do ROAS ideal aponta o Estoque, não a campanha", () => {
    const m = motivoSemRoasIdeal(500, 0, 10, false);
    expect(m).toMatch(/Estoque/);
    expect(m).not.toMatch(/campanha/i);
  });

  it("com custo conhecido, o motivo volta a ser o de produto que não fecha conta", () => {
    expect(motivoSemRoasIdeal(500, 0, 10, true)).toMatch(/não cobre o próprio custo/);
  });
});
