import { describe, expect, it } from "vitest";
import {
  custoPorPedido, custosSemAds, lucroAntesAds, margemReal, margemSemAds,
  produtoDoDia, roasBreakEven, roasDireto, roasGeral, ticketMedio,
  unidadesPorPedido, variacao, type EntradaDia,
} from "./resumo-dia";

/** O dia real do painel, pra os testes falarem de números que existiram. */
function dia(over: Partial<EntradaDia> = {}): EntradaDia {
  return {
    faturamentoBruto: 644.86,
    totalCMV: 383.97,
    totalEnvio: 47.80,
    totalTaxasML: 66.87,
    totalImposto: 25.79,
    totalAds: 34.50,
    lucroLiquido: 85.93,
    pedidos: 20,
    unidades: 31,
    vendaDiretaAds: 533.39,
    ...over,
  };
}
const vazio = dia({
  faturamentoBruto: 0, totalCMV: 0, totalEnvio: 0, totalTaxasML: 0,
  totalImposto: 0, totalAds: 0, lucroLiquido: 0, pedidos: 0, unidades: 0, vendaDiretaAds: 0,
});

describe("custos e lucro antes do ads", () => {
  it("soma os custos que não são publicidade", () => {
    expect(custosSemAds(dia())).toBeCloseTo(524.43, 2);
  });

  it("lucro antes do ads é o que sobra pra pagar a campanha", () => {
    expect(lucroAntesAds(dia())).toBeCloseTo(120.43, 2);
  });
});

describe("ticket médio e custo por pedido", () => {
  it("ticket do dia real", () => {
    expect(ticketMedio(dia())).toBeCloseTo(32.24, 2);
  });

  it("custo por pedido do dia real", () => {
    expect(custoPorPedido(dia())).toBeCloseTo(26.22, 2);
  });

  it("dia sem pedido não divide por zero — devolve null, não 0", () => {
    expect(ticketMedio(vazio)).toBeNull();
    expect(custoPorPedido(vazio)).toBeNull();
  });
});

describe("os três ROAS", () => {
  it("direto = venda atribuída ÷ investido", () => {
    expect(roasDireto(dia())).toBeCloseTo(15.46, 2);
  });

  it("geral = faturamento do dia ÷ investido, sempre >= o direto", () => {
    expect(roasGeral(dia())).toBeCloseTo(18.69, 2);
    expect(roasGeral(dia())!).toBeGreaterThan(roasDireto(dia())!);
  });

  it("break-even com os custos REAIS do dia", () => {
    expect(roasBreakEven(dia())).toBeCloseTo(5.35, 2);
  });

  it("o dia real está acima do break-even — por isso deu lucro", () => {
    expect(roasDireto(dia())!).toBeGreaterThan(roasBreakEven(dia())!);
    expect(dia().lucroLiquido).toBeGreaterThan(0);
  });

  it("sem investimento os ROAS somem — 0,00x pareceria desempenho péssimo", () => {
    expect(roasDireto(dia({ totalAds: 0 }))).toBeNull();
    expect(roasGeral(dia({ totalAds: 0 }))).toBeNull();
  });

  it("dia sem lucro nem sem ads não tem break-even possível", () => {
    // Nenhum ROAS resolve; mostrar número sugeriria meta impossível.
    expect(roasBreakEven(dia({ totalCMV: 700 }))).toBeNull();
  });

  it("break-even não depende do quanto foi gasto em ads", () => {
    // É a régua do dia; gastar mais não muda o mínimo pra empatar.
    expect(roasBreakEven(dia({ totalAds: 5 }))).toBeCloseTo(roasBreakEven(dia({ totalAds: 500 }))!, 6);
  });
});

describe("margem com e sem ads", () => {
  it("margem real do dia", () => {
    expect(margemReal(dia())).toBeCloseTo(13.32, 1);
  });

  it("sem ads a margem é maior — a diferença é o custo da publicidade", () => {
    const sem = margemSemAds(dia())!;
    const real = margemReal(dia())!;
    expect(sem).toBeGreaterThan(real);
    expect(sem - real).toBeCloseTo((34.50 / 644.86) * 100, 1);
  });

  it("dia sem faturamento não calcula margem", () => {
    expect(margemReal(vazio)).toBeNull();
    expect(margemSemAds(vazio)).toBeNull();
  });
});

describe("unidades por pedido", () => {
  it("calcula a média", () => {
    expect(unidadesPorPedido(dia())).toBeCloseTo(1.55, 2);
  });

  it("sem pedido, null", () => {
    expect(unidadesPorPedido(vazio)).toBeNull();
  });
});

describe("variacao — comparação com ontem", () => {
  it("subiu", () => {
    const v = variacao(120, 100);
    expect(v.pct).toBeCloseTo(20, 6);
    expect(v.subiu).toBe(true);
  });

  it("caiu", () => {
    const v = variacao(80, 100);
    expect(v.pct).toBeCloseTo(-20, 6);
    expect(v.subiu).toBe(false);
  });

  it("de ZERO pra algo não vira +100% nem infinito", () => {
    // Não existe percentual de crescimento sobre zero.
    const v = variacao(500, 0);
    expect(v.pct).toBeNull();
    expect(v.vindoDoZero).toBe(true);
  });

  it("zero pra zero não é 'novo'", () => {
    expect(variacao(0, 0).vindoDoZero).toBe(false);
  });

  it("sem dado de ontem não compara", () => {
    expect(variacao(100, null).pct).toBeNull();
    expect(variacao(100, undefined).pct).toBeNull();
  });

  it("anterior negativo usa módulo — não inverte o sinal da variação", () => {
    // Prejuízo de 100 virando prejuízo de 50 é MELHORA.
    const v = variacao(-50, -100);
    expect(v.subiu).toBe(true);
  });
});

describe("produtoDoDia", () => {
  const lista = [
    { titulo: "Açaí em Pó", receita: 300, unidades: 5 },
    { titulo: "Erva Hortelã", receita: 120, unidades: 30 },
  ];

  it("escolhe por RECEITA, não por unidades", () => {
    // O campeão de unidades costuma ser o item barato; o card é sobre dinheiro.
    expect(produtoDoDia(lista)!.titulo).toBe("Açaí em Pó");
  });

  it("ignora quem não faturou", () => {
    expect(produtoDoDia([{ titulo: "X", receita: 0, unidades: 9 }])).toBeNull();
  });

  it("lista vazia devolve null", () => {
    expect(produtoDoDia([])).toBeNull();
  });
});
