import { describe, expect, it } from "vitest";
import {
  custoPorPedido, custosSemAds, lucroAntesAds, margemReal, margemSemAds,
  produtoDoDia, roasBreakEven, roasDireto, roasGeral, ticketMedio,
  unidadesPorPedido, variacao, type EntradaDia,
} from "./resumo-dia";

/**
 * O dia real do painel de 27/08, com as TRÊS receitas separadas — é o caso
 * que expôs o erro de base: bruto R$ 2.108,10 incluía R$ 166,64 de cancelado
 * e R$ 18,10 sem vínculo, e a margem dividia o lucro por ele.
 */
function dia(over: Partial<EntradaDia> = {}): EntradaDia {
  return {
    faturamentoBruto: 2108.10,
    faturamentoLiquido: 1941.46,
    retorno: 1923.36,
    totalCMV: 1286.61,
    totalEnvio: 198.60,
    totalTaxasML: 246.40,
    totalImposto: 76.93,
    totalAds: 38.75,
    lucroLiquido: 76.07,
    pedidos: 22,
    unidades: 89,
    vendaDiretaAds: 886.90,
    ...over,
  };
}
const vazio = dia({
  faturamentoBruto: 0, faturamentoLiquido: 0, retorno: 0, totalCMV: 0,
  totalEnvio: 0, totalTaxasML: 0, totalImposto: 0, totalAds: 0,
  lucroLiquido: 0, pedidos: 0, unidades: 0, vendaDiretaAds: 0,
});

describe("custos e lucro antes do ads", () => {
  it("soma os custos que não são publicidade", () => {
    expect(custosSemAds(dia())).toBeCloseTo(1808.54, 2);
  });

  it("lucro antes do ads é o que sobra pra pagar a campanha", () => {
    expect(lucroAntesAds(dia())).toBeCloseTo(114.82, 2);
  });
});

describe("ticket médio e custo por pedido", () => {
  it("ticket do dia real", () => {
    expect(ticketMedio(dia())).toBeCloseTo(88.25, 2);
  });

  it("custo por pedido do dia real", () => {
    expect(custoPorPedido(dia())).toBeCloseTo(82.21, 2);
  });

  it("dia sem pedido não divide por zero — devolve null, não 0", () => {
    expect(ticketMedio(vazio)).toBeNull();
    expect(custoPorPedido(vazio)).toBeNull();
  });
});

describe("os três ROAS", () => {
  it("direto = venda atribuída ÷ investido", () => {
    expect(roasDireto(dia())).toBeCloseTo(22.89, 2);
  });

  it("geral = faturamento do dia ÷ investido, sempre >= o direto", () => {
    expect(roasGeral(dia())).toBeCloseTo(50.10, 2);
    expect(roasGeral(dia())!).toBeGreaterThan(roasDireto(dia())!);
  });

  it("break-even com os custos REAIS do dia", () => {
    expect(roasBreakEven(dia())).toBeCloseTo(16.75, 2);
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
    expect(roasBreakEven(dia({ totalCMV: 2500 }))).toBeNull();
  });

  it("break-even não depende do quanto foi gasto em ads", () => {
    // É a régua do dia; gastar mais não muda o mínimo pra empatar.
    expect(roasBreakEven(dia({ totalAds: 5 }))).toBeCloseTo(roasBreakEven(dia({ totalAds: 500 }))!, 6);
  });
});

describe("margem com e sem ads", () => {
  it("margem real do dia", () => {
    expect(margemReal(dia())).toBeCloseTo(3.96, 1);
  });

  it("sem ads a margem é maior — a diferença é o custo da publicidade", () => {
    const sem = margemSemAds(dia())!;
    const real = margemReal(dia())!;
    expect(sem).toBeGreaterThan(real);
    expect(sem - real).toBeCloseTo((38.75 / 1923.36) * 100, 1);
  });

  it("dia sem faturamento não calcula margem", () => {
    expect(margemReal(vazio)).toBeNull();
    expect(margemSemAds(vazio)).toBeNull();
  });
});

describe("unidades por pedido", () => {
  it("calcula a média", () => {
    expect(unidadesPorPedido(dia())).toBeCloseTo(4.05, 2);
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

/**
 * A comparação "vs ontem" dos cards de Vendas do Dia.
 *
 * Todos os dezesseis cards mostravam exatamente "↑ 0% vs ontem", em verde. A
 * causa estava fora daqui — o Dashboard pedia as métricas de ontem mas lia o
 * campo `hoje` da resposta, que sempre foi o dia CORRENTE — então a
 * comparação recebia hoje contra hoje. Estes testes fixam o que `variacao`
 * garante, que é a outra metade do problema: 0 não pode passar por alta.
 */
describe("variacao — a base da seta de comparação", () => {
  it("alta e queda saem com o sinal certo", () => {
    expect(variacao(150, 100).pct).toBeCloseTo(50, 6);
    expect(variacao(150, 100).subiu).toBe(true);
    expect(variacao(50, 100).pct).toBeCloseTo(-50, 6);
    expect(variacao(50, 100).subiu).toBe(false);
  });

  it("valores IGUAIS dão 0% — e é por isso que a tela precisa tratar o zero", () => {
    // `subiu` é `pct >= 0`, então 0 vem como "subiu". Quem renderiza tem que
    // separar "não mudou" de "subiu", senão o card anuncia alta que não houve.
    const v = variacao(100, 100);
    expect(v.pct).toBe(0);
    expect(v.subiu).toBe(true);
  });

  it("sem base anterior não inventa comparação", () => {
    expect(variacao(100, null).pct).toBeNull();
    expect(variacao(100, undefined).pct).toBeNull();
    expect(variacao(100, NaN).pct).toBeNull();
  });

  it("saindo do zero é 'novo', não uma porcentagem infinita", () => {
    const v = variacao(80, 0);
    expect(v.pct).toBeNull();
    expect(v.vindoDoZero).toBe(true);
    expect(v.subiu).toBe(true);
  });

  it("zero contra zero não é novidade nenhuma", () => {
    expect(variacao(0, 0).vindoDoZero).toBe(false);
  });

  it("base negativa usa o módulo — prejuízo que encolhe é alta", () => {
    // De −100 pra −50: melhorou 50%. Sem o Math.abs o sinal sairia invertido.
    expect(variacao(-50, -100).pct).toBeCloseTo(50, 6);
    expect(variacao(-50, -100).subiu).toBe(true);
  });
});
