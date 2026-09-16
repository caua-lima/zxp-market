import { describe, it, expect } from "vitest";
import {
  confiancaDaDecisao, rotuloDaConfianca, motivoDaConfianca,
  impactoDaDecisao, prioridadeDaDecisao, ordenarPorPrioridade,
  CLIQUES_PARA_CONFIANCA, DIAS_PARA_CONFIANCA, type BaseDaDecisao,
} from "./ads-prioridade";

const base = (o: Partial<BaseDaDecisao> = {}): BaseDaDecisao => ({
  cliques: 500, investido: 300, lucro: 200, dias: 30, atribuicaoCompleta: true, ...o,
});

describe("confiancaDaDecisao", () => {
  it("base ampla e completa dá confiança cheia", () => {
    expect(confiancaDaDecisao(base())).toBe(1);
  });

  it("poucos cliques derrubam proporcionalmente", () => {
    expect(confiancaDaDecisao(base({ cliques: 50 }))).toBeCloseTo(0.5, 3);
    expect(confiancaDaDecisao(base({ cliques: 0 }))).toBe(0);
  });

  it("satura: mil cliques não valem mais que o limiar", () => {
    expect(confiancaDaDecisao(base({ cliques: CLIQUES_PARA_CONFIANCA }))).toBe(1);
    expect(confiancaDaDecisao(base({ cliques: 10000 }))).toBe(1);
  });

  it("período curto derruba", () => {
    expect(confiancaDaDecisao(base({ dias: 7 }))).toBeCloseTo(0.5, 3);
  });

  it("sem custo cadastrado, a confiança despenca mesmo com muitos cliques", () => {
    expect(confiancaDaDecisao(base({ lucro: null }))).toBeCloseTo(0.35, 3);
  });

  it("é MULTIPLICATIVA: custo ausente não é compensável por volume", () => {
    const muito = confiancaDaDecisao(base({ lucro: null, cliques: 100000 }));
    expect(muito).toBeLessThan(0.5);
  });

  it("atribuição incompleta embaça sem invalidar", () => {
    expect(confiancaDaDecisao(base({ atribuicaoCompleta: false }))).toBeCloseTo(0.8, 3);
  });

  it("fatores se acumulam", () => {
    const c = confiancaDaDecisao(base({ cliques: 50, dias: 7 }));
    expect(c).toBeCloseTo(0.25, 3);
  });

  it("valores negativos não viram confiança negativa", () => {
    expect(confiancaDaDecisao(base({ cliques: -10 }))).toBe(0);
    expect(confiancaDaDecisao(base({ dias: -5 }))).toBe(0);
  });
});

describe("rotuloDaConfianca", () => {
  it("nomeia as três faixas", () => {
    expect(rotuloDaConfianca(1)).toBe("alta");
    expect(rotuloDaConfianca(0.5)).toBe("média");
    expect(rotuloDaConfianca(0.1)).toBe("baixa");
  });

  it("os limiares são inclusivos por baixo", () => {
    expect(rotuloDaConfianca(0.7)).toBe("alta");
    expect(rotuloDaConfianca(0.35)).toBe("média");
    expect(rotuloDaConfianca(0.3499)).toBe("baixa");
  });
});

describe("motivoDaConfianca — o motivo DOMINANTE, não a lista", () => {
  it("custo ausente ganha de tudo", () => {
    const m = motivoDaConfianca(base({ lucro: null, cliques: 2, dias: 1 }));
    expect(m).toContain("custo do produto");
  });

  it("depois vêm os cliques", () => {
    expect(motivoDaConfianca(base({ cliques: 3, dias: 1 }))).toContain("3 clique");
  });

  it("depois o período", () => {
    expect(motivoDaConfianca(base({ dias: 3 }))).toContain("3 dia");
  });

  it("depois a atribuição", () => {
    expect(motivoDaConfianca(base({ atribuicaoCompleta: false }))).toContain("assistida");
  });

  it("base completa não tem ressalva", () => {
    expect(motivoDaConfianca(base())).toBeNull();
  });

  it("nunca devolve mais de um motivo", () => {
    const m = motivoDaConfianca(base({ lucro: null, cliques: 1, dias: 1, atribuicaoCompleta: false }));
    expect(m?.split(".").filter(Boolean).length).toBeLessThanOrEqual(2);
  });
});

describe("impactoDaDecisao", () => {
  it("cortar um prejuízo de 800 vale tanto quanto escalar um lucro de 800", () => {
    expect(impactoDaDecisao(base({ lucro: -800 }))).toBe(800);
    expect(impactoDaDecisao(base({ lucro: 800 }))).toBe(800);
  });

  it("sem lucro calculável, o gasto é o piso do que está em jogo", () => {
    expect(impactoDaDecisao(base({ lucro: null, investido: 450 }))).toBe(450);
  });

  it("gasto negativo não vira impacto negativo", () => {
    expect(impactoDaDecisao(base({ lucro: null, investido: -10 }))).toBe(0);
  });

  it("lucro zero é impacto zero — não há o que ganhar nem que parar de perder", () => {
    expect(impactoDaDecisao(base({ lucro: 0 }))).toBe(0);
  });
});

describe("prioridadeDaDecisao — o caso que motivou tudo", () => {
  it("3 cliques com R$ 400 perde pra 3000 cliques com R$ 380", () => {
    const raso = prioridadeDaDecisao(base({ cliques: 3, lucro: -400, dias: 30 }));
    const solido = prioridadeDaDecisao(base({ cliques: 3000, lucro: -380, dias: 30 }));

    expect(raso.impacto).toBeGreaterThan(solido.impacto); // impacto cru maior
    expect(raso.score).toBeLessThan(solido.score);        // e mesmo assim perde
  });

  it("confiança nula zera o score, por maior que seja o impacto", () => {
    expect(prioridadeDaDecisao(base({ cliques: 0, lucro: -99999 })).score).toBe(0);
  });

  it("carrega o rótulo e a ressalva junto", () => {
    const p = prioridadeDaDecisao(base({ cliques: 10 }));
    expect(p.rotulo).toBe("baixa");
    expect(p.ressalva).toContain("10 clique");
  });
});

describe("ordenarPorPrioridade", () => {
  type Ad = { id: string; b: BaseDaDecisao };
  const ordenar = (l: Ad[]) => ordenarPorPrioridade(l, (x) => x.b, (x) => x.id).map((x) => x.id);

  it("o que se sabe mais vem primeiro, mesmo com impacto menor", () => {
    expect(ordenar([
      { id: "raso", b: base({ cliques: 3, lucro: -400 }) },
      { id: "solido", b: base({ cliques: 3000, lucro: -380 }) },
    ])).toEqual(["solido", "raso"]);
  });

  it("com a mesma confiança, manda o impacto", () => {
    expect(ordenar([
      { id: "pequeno", b: base({ lucro: 100 }) },
      { id: "grande", b: base({ lucro: 900 }) },
    ])).toEqual(["grande", "pequeno"]);
  });

  it("empate total desempata pela chave — a lista não pode dançar", () => {
    expect(ordenar([
      { id: "zebra", b: base() },
      { id: "alfa", b: base() },
    ])).toEqual(["alfa", "zebra"]);
  });

  it("não modifica a lista original", () => {
    const l: Ad[] = [{ id: "a", b: base({ lucro: 1 }) }, { id: "b", b: base({ lucro: 900 }) }];
    const copia = [...l];
    ordenarPorPrioridade(l, (x) => x.b, (x) => x.id);
    expect(l).toEqual(copia);
  });

  it("lista vazia não quebra", () => {
    expect(ordenar([])).toEqual([]);
  });

  it("período curto empurra pra baixo quem ainda não deu tempo de medir", () => {
    expect(ordenar([
      { id: "novo", b: base({ lucro: -1000, dias: 2 }) },
      { id: "maduro", b: base({ lucro: -400, dias: DIAS_PARA_CONFIANCA }) },
    ])).toEqual(["maduro", "novo"]);
  });
});
