import { describe, expect, it } from "vitest";
import {
  calcularReferencia, diagnosticarFunil, mediana, priorizarPorImpacto,
  type DadosFunil, type Referencia,
} from "./ads-diagnostico";

function anuncio(over: Partial<DadosFunil> = {}): DadosFunil {
  return {
    titulo: "Produto X",
    impressoes: 10_000, cliques: 100, vendas: 10, custo: 100, receita: 1000,
    ...over,
  };
}
/** Conta com CTR 1%, conversão 10%, CPC R$ 1,00. */
const REF: Referencia = { ctrMediano: 1, conversaoMediana: 10, cpcMediano: 1 };

describe("mediana", () => {
  it("ímpar pega o do meio", () => {
    expect(mediana([1, 5, 3])).toBe(3);
  });

  it("par tira a média dos dois centrais", () => {
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
  });

  it("lista vazia devolve null, não zero", () => {
    expect(mediana([])).toBeNull();
  });

  it("resiste a valor extremo — é o motivo de não usar média", () => {
    // Um anúncio com CTR absurdo puxaria a média e faria o resto parecer ruim.
    expect(mediana([1, 1, 1, 1, 500])).toBe(1);
  });
});

describe("calcularReferencia — a régua é a própria conta", () => {
  it("calcula as três medianas", () => {
    const r = calcularReferencia([
      anuncio({ impressoes: 1000, cliques: 10, vendas: 1, custo: 10 }),
      anuncio({ impressoes: 1000, cliques: 20, vendas: 4, custo: 40 }),
      anuncio({ impressoes: 1000, cliques: 30, vendas: 3, custo: 30 }),
    ]);
    expect(r.ctrMediano).toBeCloseTo(2, 4);
    expect(r.conversaoMediana).toBeCloseTo(10, 4);
    expect(r.cpcMediano).toBeCloseTo(1, 4);
  });

  it("ignora quem não teve impressão ou clique — evita dividir por zero", () => {
    const r = calcularReferencia([anuncio({ impressoes: 0, cliques: 0 })]);
    expect(r.ctrMediano).toBeNull();
    expect(r.conversaoMediana).toBeNull();
  });
});

describe("diagnosticarFunil — acha o gargalo", () => {
  it("volume baixo não vira diagnóstico", () => {
    const d = diagnosticarFunil(anuncio({ impressoes: 50, cliques: 2 }), REF);
    expect(d.etapa).toBe("sem-dados");
  });

  it("pouca impressão aponta o topo do funil, não foto nem preço", () => {
    // Com o topo fechado, CTR e conversão de 200 impressões não dizem nada.
    const d = diagnosticarFunil(anuncio({ impressoes: 200, cliques: 20, vendas: 0 }), REF);
    expect(d.etapa).toBe("impressao");
    expect(d.detalhe).toMatch(/orçamento|ROAS alvo/i);
  });

  it("conversão baixa é apontada ANTES do CTR — o clique já foi pago", () => {
    // CTR também ruim, mas a conversão é o furo mais caro.
    const d = diagnosticarFunil(anuncio({ impressoes: 20_000, cliques: 100, vendas: 1 }), REF);
    expect(d.etapa).toBe("conversao");
  });

  it("conversão zero com investimento é crítico e cita o valor perdido", () => {
    const d = diagnosticarFunil(anuncio({ cliques: 100, vendas: 0, custo: 250 }), REF);
    expect(d.etapa).toBe("conversao");
    expect(d.tone).toBe("critical");
    expect(d.detalhe).toMatch(/250/);
  });

  it("CTR baixo com conversão boa aponta foto/título/preço", () => {
    const d = diagnosticarFunil(anuncio({ impressoes: 50_000, cliques: 100, vendas: 12 }), REF);
    expect(d.etapa).toBe("clique");
    expect(d.detalhe).toMatch(/foto|título|preço/i);
  });

  it("funil bom mas clique caro aponta CPC", () => {
    const d = diagnosticarFunil(anuncio({ cliques: 100, vendas: 12, custo: 300 }), REF);
    expect(d.etapa).toBe("cpc");
  });

  it("tudo dentro do padrão manda olhar margem, não funil", () => {
    const d = diagnosticarFunil(anuncio(), REF);
    expect(d.etapa).toBe("ok");
    expect(d.detalhe).toMatch(/margem/i);
  });

  it("sem referência não acusa ninguém de ruim", () => {
    // Conta com um anúncio só: não há mediana pra comparar.
    const vazia: Referencia = { ctrMediano: null, conversaoMediana: null, cpcMediano: null };
    expect(diagnosticarFunil(anuncio({ vendas: 0 }), vazia).etapa).toBe("ok");
  });

  it("nunca cita número inventado de mercado", () => {
    // A régua é sempre "dos seus anúncios" — nunca um benchmark externo.
    const d = diagnosticarFunil(anuncio({ impressoes: 50_000, cliques: 100, vendas: 12 }), REF);
    expect(d.detalhe).toMatch(/seus anúncios/);
  });
});

describe("priorizarPorImpacto — ordena por DINHEIRO, não por percentual", () => {
  it("o de maior perda absoluta vem antes do de pior percentual", () => {
    // R$ 12 perdendo 40% vs R$ 800 perdendo 3%: o segundo custa mais caro.
    const r = priorizarPorImpacto([
      { titulo: "Barato", lucroAtual: -5, lucroNoIdeal: null, investido: 12 },
      { titulo: "Caro", lucroAtual: -24, lucroNoIdeal: null, investido: 800 },
    ]);
    expect(r[0].titulo).toBe("Caro");
  });

  it("anúncio no vermelho tem ganho mínimo de parar de perder", () => {
    const r = priorizarPorImpacto([{ titulo: "X", lucroAtual: -50, lucroNoIdeal: null, investido: 100 }]);
    expect(r[0].ganhoPotencial).toBe(50);
    expect(r[0].acao).toMatch(/desligar|preço/i);
  });

  it("anúncio lucrativo abaixo do ideal entra pelo ganho do ajuste", () => {
    const r = priorizarPorImpacto([{ titulo: "X", lucroAtual: 100, lucroNoIdeal: 180, investido: 50 }]);
    expect(r[0].ganhoPotencial).toBe(80);
    expect(r[0].acao).toMatch(/ROAS/i);
  });

  it("quem não tem ganho a capturar fica de fora", () => {
    expect(priorizarPorImpacto([{ titulo: "Ok", lucroAtual: 100, lucroNoIdeal: 100, investido: 50 }])).toEqual([]);
  });

  it("sem dado de lucro não inventa prioridade", () => {
    expect(priorizarPorImpacto([{ titulo: "?", lucroAtual: null, lucroNoIdeal: null, investido: 90 }])).toEqual([]);
  });
});
