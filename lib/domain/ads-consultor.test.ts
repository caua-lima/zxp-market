import { describe, expect, it } from "vitest";
import {
  DEPENDENCIA_BAIXA_PCT,
  analisarAnuncio,
  ordenarPorUrgencia,
  type DadosAnuncio,
} from "./ads-consultor";

function anuncio(over: Partial<DadosAnuncio> = {}): DadosAnuncio {
  return {
    titulo: "Produto X",
    vendas: 1000,
    custo: 100,
    lucro: 150,
    margem: 15,
    roas: 10,
    pctAds: 20,
    lucroAntesAds: 250,
    cliques: 200,
    metaMargem: 10,
    ...over,
  };
}

describe("analisarAnuncio — a dependência do Ads muda a decisão", () => {
  it("pouca dependência + prejuízo = DESLIGAR (o caso que motivou o módulo)", () => {
    // "se menos de 30% das vendas vem do ads e ainda tá dando prejuízo não faz sentido"
    const v = analisarAnuncio(anuncio({ pctAds: 8, lucro: -50, margem: -5 }));
    expect(v.acao).toBe("desligar");
    expect(v.motivo).toMatch(/8,0%/);
  });

  it("pouca dependência + margem acima da meta = MANTER", () => {
    // "é menos que 30% mas a margem está superior a 10% faz sentido"
    const v = analisarAnuncio(anuncio({ pctAds: 12, lucro: 180, margem: 18, metaMargem: 10 }));
    expect(v.acao).toBe("manter");
  });

  it("MESMA margem negativa, dependência alta = NÃO manda desligar", () => {
    // O ponto do módulo: margem igual, decisão oposta.
    const baixa = analisarAnuncio(anuncio({ pctAds: 8, lucro: -50, margem: -5 }));
    const alta = analisarAnuncio(anuncio({ pctAds: 75, lucro: -50, margem: -5 }));
    expect(baixa.acao).toBe("desligar");
    expect(alta.acao).toBe("ajustar-roas");
    expect(alta.motivo).toMatch(/derrubaria|tiraria/i);
  });

  it("dependência alta + prejuízo avisa QUANTO de faturamento está em risco", () => {
    const v = analisarAnuncio(anuncio({ vendas: 1000, pctAds: 80, lucro: -30, margem: -3 }));
    expect(v.riscoAoDesligar).toBeCloseTo(800, 2);
  });

  it("lucrando com dependência relevante e margem boa = ESCALAR", () => {
    const v = analisarAnuncio(anuncio({ pctAds: 55, lucro: 200, margem: 20, metaMargem: 10 }));
    expect(v.acao).toBe("escalar");
  });

  it("lucrando mas abaixo da meta = AJUSTAR, não escalar", () => {
    const v = analisarAnuncio(anuncio({ pctAds: 50, lucro: 60, margem: 6, metaMargem: 10 }));
    expect(v.acao).toBe("ajustar-roas");
  });
});

describe("analisarAnuncio — o produto vem antes da campanha", () => {
  it("produto no vermelho ANTES do Ads não é problema de campanha", () => {
    const v = analisarAnuncio(anuncio({ lucroAntesAds: -3, lucro: -20, margem: -2, roas: 33 }));
    expect(v.acao).toBe("corrigir-produto");
    expect(v.motivo).toMatch(/ANTES/);
  });

  it("ROAS excelente NÃO salva produto negativo antes do Ads", () => {
    // Medido na conta real: Boldo com ROAS ótimo e −R$2,95 antes do ads.
    const v = analisarAnuncio(anuncio({ roas: 40, lucroAntesAds: -2.95, lucro: -10, margem: -1 }));
    expect(v.acao).toBe("corrigir-produto");
  });
});

describe("analisarAnuncio — não conclui sem base", () => {
  it("poucos cliques e nenhuma venda não vira recomendação", () => {
    const v = analisarAnuncio(anuncio({ cliques: 3, vendas: 0, lucro: null, margem: null }));
    expect(v.acao).toBe("sem-dados");
  });

  it("sem investimento e sem venda não analisa", () => {
    const v = analisarAnuncio(anuncio({ custo: 0, vendas: 0, cliques: 0 }));
    expect(v.acao).toBe("sem-dados");
  });

  it("sem margem apurada admite que falta vínculo, em vez de chutar", () => {
    const v = analisarAnuncio(anuncio({ lucro: null, margem: null, cliques: 100, vendas: 500 }));
    expect(v.acao).toBe("sem-dados");
    expect(v.motivo).toMatch(/vinculad|Estoque/i);
  });

  it("nunca inventa número quando não há dado", () => {
    const v = analisarAnuncio(anuncio({ lucro: null, margem: null, cliques: 100, vendas: 500 }));
    expect(v.motivo).not.toMatch(/NaN|undefined|null/);
  });
});

describe("analisarAnuncio — o corte de 30%", () => {
  it("logo abaixo de 30% com prejuízo manda desligar", () => {
    const v = analisarAnuncio(anuncio({ pctAds: DEPENDENCIA_BAIXA_PCT - 0.1, lucro: -10, margem: -1 }));
    expect(v.acao).toBe("desligar");
  });

  it("exatamente 30% com prejuízo NÃO manda desligar — já não é dependência baixa", () => {
    const v = analisarAnuncio(anuncio({ pctAds: DEPENDENCIA_BAIXA_PCT, lucro: -10, margem: -1 }));
    expect(v.acao).toBe("ajustar-roas");
  });
});

describe("ordenarPorUrgencia", () => {
  it("põe o que queima dinheiro na frente do que está saudável", () => {
    const itens = [
      { veredicto: analisarAnuncio(anuncio({ pctAds: 55, lucro: 200, margem: 20 })), lucro: 200 },
      { veredicto: analisarAnuncio(anuncio({ pctAds: 8, lucro: -50, margem: -5 })), lucro: -50 },
    ];
    expect(ordenarPorUrgencia(itens)[0].veredicto.acao).toBe("desligar");
  });

  it("dentro da mesma ação, o maior prejuízo primeiro", () => {
    const itens = [
      { veredicto: analisarAnuncio(anuncio({ pctAds: 8, lucro: -10, margem: -1 })), lucro: -10 },
      { veredicto: analisarAnuncio(anuncio({ pctAds: 8, lucro: -90, margem: -9 })), lucro: -90 },
    ];
    expect(ordenarPorUrgencia(itens)[0].lucro).toBe(-90);
  });

  it("não muda o array original", () => {
    const itens = [
      { veredicto: analisarAnuncio(anuncio({ pctAds: 55, lucro: 200, margem: 20 })), lucro: 200 },
      { veredicto: analisarAnuncio(anuncio({ pctAds: 8, lucro: -50, margem: -5 })), lucro: -50 },
    ];
    const antes = itens.map((i) => i.lucro);
    ordenarPorUrgencia(itens);
    expect(itens.map((i) => i.lucro)).toEqual(antes);
  });
});
