import { describe, expect, it } from "vitest";
import {
  rotuloCampanha, agregarPorCampanha, CAMPANHA_SEM_ID, type ItemParaCampanha } from "./ads-campaigns";

function item(over: Partial<ItemParaCampanha> = {}): ItemParaCampanha {
  return {
    campaignId: "c1", campaignName: "Campanha 1",
    clicks: 10, prints: 100, cost: 50,
    directSales: 200, directUnits: 2,
    totalSales: 400, totalUnits: 4,
    lucroLiquido: 80, lucroDiretoLiquido: 40,
    diretoDisponivel: true,
    ...over,
  };
}

describe("agregarPorCampanha", () => {
  it("sem itens, lista vazia", () => {
    expect(agregarPorCampanha([], "geral")).toEqual([]);
  });

  it("soma anúncios da mesma campanha", () => {
    const r = agregarPorCampanha([item(), item()], "geral");
    expect(r).toHaveLength(1);
    expect(r[0].anuncios).toBe(2);
    expect(r[0].cost).toBe(100);
    expect(r[0].clicks).toBe(20);
    expect(r[0].receita).toBe(800);
  });

  it("separa campanhas diferentes e ordena pelo maior investimento", () => {
    const r = agregarPorCampanha([
      item({ campaignId: "pequena", cost: 10 }),
      item({ campaignId: "grande", cost: 900 }),
    ], "geral");
    expect(r.map((c) => c.campaignId)).toEqual(["grande", "pequena"]);
  });

  it("modo pub usa venda direta; modo geral usa venda total", () => {
    const pub = agregarPorCampanha([item()], "pub")[0];
    const geral = agregarPorCampanha([item()], "geral")[0];
    expect(pub.receita).toBe(200);
    expect(geral.receita).toBe(400);
    expect(pub.lucroAposAds).toBe(40);
    expect(geral.lucroAposAds).toBe(80);
  });

  it("modo pub sem NENHUMA venda vinculada deixa lucro null, nao zero", () => {
    const r = agregarPorCampanha([item({ diretoDisponivel: false })], "pub")[0];
    expect(r.lucroAposAds).toBeNull();
  });

  it("modo pub soma so quem tem venda vinculada, sem puxar o lucro pra baixo com zeros", () => {
    const r = agregarPorCampanha([
      item({ diretoDisponivel: true, lucroDiretoLiquido: 100 }),
      item({ diretoDisponivel: false, lucroDiretoLiquido: 0 }),
    ], "pub")[0];
    expect(r.lucroAposAds).toBe(100);
  });

  it("ROAS = receita / investido; ACOS = investido / receita", () => {
    const r = agregarPorCampanha([item({ cost: 100, totalSales: 500 })], "geral")[0];
    expect(r.roas).toBe(5);
    expect(r.acos).toBeCloseTo(20, 5);
  });

  it("sem investimento, ROAS indefinido (null) em vez de divisao por zero", () => {
    const r = agregarPorCampanha([item({ cost: 0 })], "geral")[0];
    expect(r.roas).toBeNull();
  });

  it("sem receita, ACOS indefinido (null) em vez de infinito", () => {
    const r = agregarPorCampanha([item({ totalSales: 0 })], "geral")[0];
    expect(r.acos).toBeNull();
  });

  it("anuncio sem campanha vai pro grupo proprio, sem sumir da soma", () => {
    const r = agregarPorCampanha([item({ campaignId: "", campaignName: "" })], "geral");
    expect(r[0].campaignId).toBe(CAMPANHA_SEM_ID);
    expect(r[0].campaignName).toBe("Sem campanha identificada");
  });
});

describe("anuncio em DUAS campanhas — o bug do gasto dobrado", () => {
  /**
   * Caso real: um anuncio rodou na campanha antiga e na nova no mesmo periodo
   * (a antiga foi excluida no meio). O gasto das duas era somado numa linha so
   * e carimbado com UMA campanha, que aparecia com o dobro do que o Mercado
   * Ads mostrava — 206 cliques e R$ 47,59 contra 104 e R$ 16,91 reais.
   */
  const emDuas = item({
    campaignId: "nova", campaignName: "Campanha Nova",
    clicks: 206, cost: 47.59, prints: 2000,
    directSales: 396.17, directUnits: 10,
    totalSales: 800, totalUnits: 20,
    lucroLiquido: 120, lucroDiretoLiquido: -1.57,
    campanhas: [
      { campaignId: "nova", campaignName: "Campanha Nova", clicks: 104, prints: 1000, cost: 16.91, directSales: 214.97, directUnits: 6 },
      { campaignId: "velha", campaignName: "Campanha Velha", clicks: 102, prints: 1000, cost: 30.68, directSales: 181.20, directUnits: 4 },
    ],
  });

  it("cada campanha fica com o SEU gasto, nao com a soma", () => {
    const r = agregarPorCampanha([emDuas], "pub");
    const nova = r.find((c) => c.campaignId === "nova")!;
    const velha = r.find((c) => c.campaignId === "velha")!;
    expect(nova.cost).toBeCloseTo(16.91, 2);
    expect(velha.cost).toBeCloseTo(30.68, 2);
  });

  it("cliques tambem se separam — 104 e 102, nao 206 numa so", () => {
    const r = agregarPorCampanha([emDuas], "pub");
    expect(r.find((c) => c.campaignId === "nova")!.clicks).toBe(104);
    expect(r.find((c) => c.campaignId === "velha")!.clicks).toBe(102);
  });

  it("ROAS de cada campanha usa a receita atribuida a ELA", () => {
    const r = agregarPorCampanha([emDuas], "pub");
    // 214,97 / 16,91 = 12,71x — exatamente o que o painel do ML mostra.
    expect(r.find((c) => c.campaignId === "nova")!.roas).toBeCloseTo(12.71, 1);
  });

  it("o total continua fechando: soma das campanhas = gasto do anuncio", () => {
    const r = agregarPorCampanha([emDuas], "pub");
    expect(r.reduce((s, c) => s + c.cost, 0)).toBeCloseTo(47.59, 2);
  });

  it("modo geral rateia a receita organica pela proporcao do gasto", () => {
    const r = agregarPorCampanha([emDuas], "geral");
    const nova = r.find((c) => c.campaignId === "nova")!;
    // 16,91 / 47,59 = 35,5% do gasto → 35,5% dos 800 de receita total
    expect(nova.receita).toBeCloseTo(800 * (16.91 / 47.59), 2);
    // e o rateio nao cria nem destroi receita
    expect(r.reduce((s, c) => s + c.receita, 0)).toBeCloseTo(800, 2);
  });

  it("anuncio de campanha unica nao muda nada (compatibilidade)", () => {
    const semFatia = agregarPorCampanha([item()], "geral");
    const comFatiaUnica = agregarPorCampanha([item({
      campanhas: [{ campaignId: "c1", campaignName: "Campanha 1", clicks: 10, prints: 100, cost: 50, directSales: 200, directUnits: 2 }],
    })], "geral");
    expect(comFatiaUnica[0].cost).toBe(semFatia[0].cost);
    expect(comFatiaUnica[0].receita).toBeCloseTo(semFatia[0].receita, 6);
    expect(comFatiaUnica[0].lucroAposAds).toBeCloseTo(semFatia[0].lucroAposAds!, 6);
  });
});

describe("roasMlAds — o ROAS que o painel do Mercado Ads mostra", () => {
  it("usa a receita atribuida TOTAL, nao a direta", () => {
    // Caso real "Pura Folha": R$ 14,79 investido. Direta 69,70 (4,71x aqui),
    // atribuida total 159,29 (10,77x no painel do ML).
    const r = agregarPorCampanha([item({
      campaignId: "pf", campaignName: "Campanha Pura Folha",
      cost: 14.79, clicks: 35, directSales: 69.70, directUnits: 3,
      campanhas: [{
        campaignId: "pf", campaignName: "Campanha Pura Folha",
        clicks: 35, prints: 500, cost: 14.79,
        directSales: 69.70, directUnits: 3, sales: 159.29, units: 7,
      }],
    })], "pub");
    expect(r[0].roas).toBeCloseTo(4.71, 2);      // o do modo da tela
    expect(r[0].roasMlAds).toBeCloseTo(10.77, 2); // o do painel do ML
  });

  it("sem a receita total, cai na direta em vez de sumir", () => {
    const r = agregarPorCampanha([item()], "pub");
    expect(r[0].roasMlAds).toBeCloseTo(r[0].roas!, 6);
  });

  it("sem investimento nao ha ROAS — null, nao Infinity", () => {
    const r = agregarPorCampanha([item({ cost: 0, campanhas: undefined })], "pub");
    expect(r[0].roasMlAds).toBeNull();
  });
});

describe("orcamento e ROAS objetivo da campanha", () => {
  it("vem do anuncio e nao duplica entre anuncios da mesma campanha", () => {
    const r = agregarPorCampanha([
      item({ dailyBudget: 20, roasTarget: 6.4 }),
      item({ dailyBudget: 20, roasTarget: 6.4 }),
    ], "geral");
    expect(r[0].dailyBudget).toBe(20);
    expect(r[0].roasTarget).toBe(6.4);
  });

  it("sem configuracao devolvida pelo ML fica 0, nao um chute", () => {
    const r = agregarPorCampanha([item()], "geral");
    expect(r[0].dailyBudget).toBe(0);
    expect(r[0].roasTarget).toBe(0);
  });
});

/**
 * Anúncio que roda em DUAS campanhas — medido na conta em 30/08/2026.
 *
 * `/ads/search` devolve UMA linha para o MLB4662183905, com as métricas
 * somadas das duas campanhas (360 cliques, R$ 95,22) e carimbada só com o
 * campaign_id da "Menta Stronger - 1k". As campanhas de verdade, pelo próprio
 * recurso de campanha do ML:
 *
 *   Menta Stronger - 1k .... 260 cliques · R$ 65,46   (painel ML: 259 · 65,26)
 *   Menta Stronger ......... 102 cliques · R$ 30,68
 *
 * 260 + 102 = 362 e 65,46 + 30,68 = 96,14 — a soma exata da linha do anúncio.
 * O app exibia 361 cliques e R$ 95,94 na "- 1k", e era isso que não batia com
 * o painel do Mercado Livre.
 */
describe("anúncio em duas campanhas: o ML manda, não a soma dos anúncios", () => {
  const item: ItemParaCampanha = {
    campaignId: "358764369", campaignName: "Campanha Menta Stronger - 1k",
    clicks: 360, prints: 71296, cost: 95.22,
    directSales: 1105.26, directUnits: 30, totalSales: 1128.26, totalUnits: 31,
    lucroLiquido: 200, lucroDiretoLiquido: 180, diretoDisponivel: true,
    dailyBudget: 1000, roasTarget: 35,
  };
  const reais = new Map([
    ["358764369", { clicks: 260, prints: 62027, cost: 65.46, receitaAtribuida: 1606.40 }],
  ]);

  it("sem as métricas reais, a campanha herda o total do anúncio — o bug", () => {
    const [c] = agregarPorCampanha([item], "geral");
    expect(c.clicks).toBe(360);
    expect(c.cost).toBeCloseTo(95.22, 2);
    expect(c.metricasDoMlAds).toBe(false);
  });

  it("com as métricas reais, bate com o painel do ML", () => {
    const [c] = agregarPorCampanha([item], "geral", reais);
    expect(c.clicks).toBe(260);
    expect(c.prints).toBe(62027);
    expect(c.cost).toBeCloseTo(65.46, 2);
    expect(c.metricasDoMlAds).toBe(true);
  });

  it("marca a atribuição como incerta — o custo somado dos anúncios não fecha", () => {
    expect(agregarPorCampanha([item], "geral", reais)[0].atribuicaoIncerta).toBe(true);
  });

  it("mostra o lucro assim mesmo, marcado como rateado", () => {
    const [c] = agregarPorCampanha([item], "geral", reais);
    expect(c.lucroAposAds).not.toBeNull();
    expect(c.margem).not.toBeNull();
    expect(c.lucroAproximado).toBe(true);
    expect(c.avisoLucro).toMatch(/proporcao do que cada uma gastou/);
    // O motivo e o oposto do numero: tendo numero, nao ha motivo a dar.
    expect(c.motivoSemLucro).toBeNull();
  });

  it("o lucro desconta o custo QUE ESTA NA TELA, nao o derivado", () => {
    /**
     * A linha mostra o investimento da campanha (R$ 65,46, o do painel do ML).
     * Se o lucro descontasse o custo derivado da soma dos anuncios, a mesma
     * linha exibiria lucro de um investimento e investimento de outro.
     */
    const [c] = agregarPorCampanha([item], "geral", reais);
    const bruto = item.lucroLiquido + item.cost;
    expect(c.lucroAposAds).toBeCloseTo(bruto - c.cost, 2);
  });

  it("o ROAS do ML é recalculado sobre o custo certo", () => {
    const [c] = agregarPorCampanha([item], "geral", reais);
    // 1606,40 ÷ 65,46 = 24,54x — o painel do ML mostrava 24,62x no mesmo dia.
    expect(c.roasMlAds).toBeCloseTo(24.54, 1);
  });

  it("anúncio numa campanha só continua com lucro — o custo fecha", () => {
    const soUma = new Map([
      ["358764369", { clicks: 360, prints: 71296, cost: 95.22, receitaAtribuida: 1853.60 }],
    ]);
    const [c] = agregarPorCampanha([item], "geral", soUma);
    expect(c.atribuicaoIncerta).toBe(false);
    expect(c.lucroAposAds).not.toBeNull();
  });
});

/**
 * "Lucro apos ads e margem tem que estar em TODOS."
 *
 * Nem sempre da pra calcular — mas um traco mudo nao diz se falta cadastrar
 * custo, esperar venda ou revisar a campanha, e sem saber qual nao da pra
 * corrigir. Entao a coluna carrega sempre uma das duas coisas: o numero, ou
 * o que falta pra te-lo.
 */
describe("motivo quando nao ha lucro a mostrar", () => {
  const base: ItemParaCampanha = {
    campaignId: "c1", campaignName: "Campanha X",
    clicks: 10, prints: 100, cost: 5,
    directSales: 100, directUnits: 2, totalSales: 100, totalUnits: 2,
    lucroLiquido: 20, lucroDiretoLiquido: 18, diretoDisponivel: true,
  };

  it("com lucro, nao ha motivo — o motivo e o oposto do numero", () => {
    const [c] = agregarPorCampanha([base], "geral");
    expect(c.lucroAposAds).not.toBeNull();
    expect(c.motivoSemLucro).toBeNull();
  });

  it("sem venda atribuida, o motivo diz isso", () => {
    const [c] = agregarPorCampanha(
      [{ ...base, diretoDisponivel: false, directSales: 0, totalSales: 0 }], "pub",
    );
    expect(c.lucroAposAds).toBeNull();
    expect(c.motivoSemLucro).toMatch(/Nenhuma venda atribuida/);
  });

  it("com venda mas sem custo, o motivo aponta o Estoque — e o que da pra corrigir", () => {
    const [c] = agregarPorCampanha([{ ...base, diretoDisponivel: false }], "pub");
    expect(c.lucroAposAds).toBeNull();
    expect(c.motivoSemLucro).toMatch(/custo cadastrado/);
  });

  it("anuncio em duas campanhas: numero na tela, com aviso do que foi estimado", () => {
    const reais = new Map([["c1", { clicks: 10, prints: 100, cost: 99, receitaAtribuida: 100 }]]);
    const [c] = agregarPorCampanha([base], "geral", reais);
    expect(c.atribuicaoIncerta).toBe(true);
    expect(c.lucroAposAds).not.toBeNull();
    expect(c.lucroAproximado).toBe(true);
    // O aviso separa o que e do ML do que e estimativa nossa — sem isso o
    // "≈" da tela nao diria O QUE foi rateado.
    expect(c.avisoLucro).toMatch(/batem com o painel/);
    expect(c.avisoLucro).toMatch(/repartida entre as campanhas/);
  });

  it("campanha sem anuncio compartilhado nao ganha marca nenhuma", () => {
    // O aviso so vale quando ha o que avisar; carimbar tudo de "aproximado"
    // faria a marca virar ruido e parar de ser lida.
    const reais = new Map([["c1", { clicks: 10, prints: 100, cost: base.cost, receitaAtribuida: 100 }]]);
    const [c] = agregarPorCampanha([base], "geral", reais);
    expect(c.atribuicaoIncerta).toBe(false);
    expect(c.lucroAproximado).toBe(false);
    expect(c.avisoLucro).toBeNull();
  });

  it("TODA campanha sem lucro tem motivo — nunca um traco mudo", () => {
    const casos: ItemParaCampanha[][] = [
      [{ ...base, diretoDisponivel: false, directSales: 0, totalSales: 0 }],
      [{ ...base, diretoDisponivel: false }],
    ];
    for (const itens of casos) {
      for (const c of agregarPorCampanha(itens, "pub")) {
        if (c.lucroAposAds == null) expect(c.motivoSemLucro).toBeTruthy();
      }
    }
  });
  /**
   * Margem some num caso a MAIS que o lucro: gastou, nao vendeu. Ai o lucro
   * existe (e o proprio investido, negativo) mas a margem seria divisao por
   * zero. Era o unico traco que sobrava sem nem tooltip.
   */
  it("gastou e nao vendeu: lucro existe, margem nao — e o motivo diz por que", () => {
    const [c] = agregarPorCampanha(
      [{ ...base, directSales: 0, totalSales: 0, totalUnits: 0, directUnits: 0, lucroLiquido: -base.cost }],
      "geral",
    );
    expect(c.lucroAposAds).not.toBeNull();
    expect(c.margem).toBeNull();
    expect(c.motivoSemLucro).toBeNull();
    expect(c.motivoSemMargem).toMatch(/receita zero/);
  });

  it("sem lucro, a margem herda o mesmo motivo — as duas colunas contam a mesma historia", () => {
    const [c] = agregarPorCampanha([{ ...base, diretoDisponivel: false }], "pub");
    expect(c.margem).toBeNull();
    expect(c.motivoSemMargem).toBe(c.motivoSemLucro);
  });

  it("TODA campanha sem margem tem motivo — a coluna nunca fica muda", () => {
    const casos: ItemParaCampanha[][] = [
      [{ ...base, diretoDisponivel: false, directSales: 0, totalSales: 0 }],
      [{ ...base, diretoDisponivel: false }],
      [{ ...base, directSales: 0, totalSales: 0, lucroLiquido: -base.cost }],
    ];
    for (const itens of casos) {
      for (const modo of ["pub", "geral"] as const) {
        for (const c of agregarPorCampanha(itens, modo)) {
          if (c.margem == null) expect(c.motivoSemMargem).toBeTruthy();
        }
      }
    }
  });
});

describe("rotuloCampanha", () => {
  it("prefixa o nome que o vendedor deu no ML", () => {
    expect(rotuloCampanha("Menta Stronger")).toBe("Campanha Menta Stronger");
  });

  it("nao duplica o prefixo em quem ja se chama assim", () => {
    // O vendedor batiza a campanha no proprio ML, e varias ja nascem com a
    // palavra. "Campanha Campanha X" seria pior que nao prefixar nada.
    expect(rotuloCampanha("Campanha Menta")).toBe("Campanha Menta");
    expect(rotuloCampanha("CAMPANHA VERAO")).toBe("CAMPANHA VERAO");
  });

  it("nao confunde palavra que so comeca igual", () => {
    expect(rotuloCampanha("Campanhas de inverno")).toBe("Campanha Campanhas de inverno");
  });

  it("sem nome vira \"Sem campanha\" — nunca a palavra sozinha", () => {
    // Anuncio que nunca entrou em campanha nenhuma existe e aparece na
    // tabela; "Campanha " com o nome vazio seria uma linha muda.
    expect(rotuloCampanha("")).toBe("Sem campanha");
    expect(rotuloCampanha("   ")).toBe("Sem campanha");
    expect(rotuloCampanha(null)).toBe("Sem campanha");
    expect(rotuloCampanha(undefined)).toBe("Sem campanha");
  });
});

/**
 * Conferência de 19/11 (06:45), período 13–19/11, contra o painel do Mercado
 * Ads. O recurso de campanha da API pública ainda não tinha o dia 18 (ontem);
 * o de anúncio já tinha o custo de ontem. Ver lib/domain/ads-consolidacao.ts.
 *
 *   Pura Folha - Agências   painel: 105 cliques · R$ 68,54 · receita R$ 240,10
 *                            anúncio: 105 cliques · R$ 68,54 · receita R$ 26,90
 *                            campanha (sem ontem): 67 cliques · R$ 29,93 · R$ 26,90
 */
describe("ML sem ONTEM consolidado — não é rateio", () => {
  const puraFolhaAg: ItemParaCampanha = {
    campaignId: "7948602", campaignName: "Pura Folha - Agências",
    clicks: 105, prints: 14619, cost: 68.54,
    directSales: 26.9, directUnits: 1, totalSales: 727.3, totalUnits: 27,
    lucroLiquido: 3.09, lucroDiretoLiquido: -65.89, diretoDisponivel: true,
    margemAntesAds: 0.0985,
    campanhas: [{
      campaignId: "7948602", campaignName: "Pura Folha - Agências",
      clicks: 105, prints: 14619, cost: 68.54, directSales: 26.9, directUnits: 1, sales: 26.9,
    }],
  };
  const semOntem = new Map([["7948602", {
    clicks: 67, prints: 9927, cost: 29.93, receitaAtribuida: 26.9, receitaDireta: 26.9,
    vendasAtribuidas: 1, vendasDiretas: 1,
  }]]);

  it("o bug: sem saber da defasagem, acusa 'rateado' numa campanha de 1 anúncio", () => {
    // Modo "geral": o único em que ainda existe rateio de receita entre campanhas.
    const [c] = agregarPorCampanha([puraFolhaAg], "geral", semOntem);
    expect(c.cost).toBeCloseTo(29.93, 2); // menos da metade do painel
    expect(c.atribuicaoIncerta).toBe(true);
  });

  it("com a defasagem informada: investido e cliques batem com o painel", () => {
    const [c] = agregarPorCampanha([puraFolhaAg], "pub", semOntem, { campanhasDefasadas: true });
    expect(c.cost).toBeCloseTo(68.54, 2);
    expect(c.clicks).toBe(105);
    expect(c.fonteMetricas).toBe("anuncios");
  });

  it("não marca 'rateado' — marca receita parcial, com o motivo certo", () => {
    const [c] = agregarPorCampanha([puraFolhaAg], "pub", semOntem, { campanhasDefasadas: true });
    expect(c.atribuicaoIncerta).toBe(false);
    expect(c.receitaParcial).toBe(true);
    expect(c.lucroAproximado).toBe(true);
    expect(c.avisoLucro).toMatch(/ONTEM/);
    expect(c.avisoLucro).not.toMatch(/proporcao do que cada uma gastou/);
  });

  it("dá o ROAS dos dias consolidados, que é o comparável", () => {
    const [c] = agregarPorCampanha([puraFolhaAg], "pub", semOntem, { campanhasDefasadas: true });
    expect(c.roasConsolidado).toBeCloseTo(26.9 / 29.93, 3);
  });

  it("campanha que quase não gastou ontem TAMBÉM fica parcial — a venda de ontem pode ser de clique antigo", () => {
    // Pura Folha - Full: R$ 0,97 de gasto em 18/11, R$ 194,61 de venda atribuída no mesmo dia.
    const quaseNada = new Map([["7948602", { ...semOntem.get("7948602")!, cost: 67.57, clicks: 103, prints: 14400 }]]);
    const [c] = agregarPorCampanha([puraFolhaAg], "pub", quaseNada, { campanhasDefasadas: true });
    expect(c.receitaParcial).toBe(true);
    expect(c.atribuicaoIncerta).toBe(false);
  });

  it("sem defasagem nada fica parcial", () => {
    const [c] = agregarPorCampanha([puraFolhaAg], "pub", semOntem);
    expect(c.receitaParcial).toBe(false);
  });
});

/**
 * "MS, LC, TT - Agências" em 13–19/11 no painel: 3 anúncios patrocinados,
 * 100 cliques, R$ 34,91, receita R$ 251,37 (224,40 direta), 9 vendas
 * atribuídas (8 diretas), ROAS 7,2x. Dois anúncios gastaram; o terceiro não.
 */
describe("campanha conferida contra o painel (dia consolidado)", () => {
  const anuncio = (over: Partial<ItemParaCampanha>): ItemParaCampanha => ({
    campaignId: "7469663", campaignName: "MS, LC, TT - Agências",
    clicks: 0, prints: 0, cost: 0, directSales: 0, directUnits: 0,
    totalSales: 0, totalUnits: 0, lucroLiquido: 0, lucroDiretoLiquido: 0,
    diretoDisponivel: true, dailyBudget: 40, roasTarget: 15,
    ...over,
  });
  const itens = [
    anuncio({ clicks: 64, prints: 23056, cost: 22.1, directSales: 134.58, directUnits: 5, margemAntesAds: 0.2 }),
    anuncio({ clicks: 36, prints: 6056, cost: 12.81, directSales: 89.82, directUnits: 2, margemAntesAds: 0.2 }),
  ];
  const reais = new Map([["7469663", {
    clicks: 100, prints: 29112, cost: 34.91, receitaAtribuida: 251.37, receitaDireta: 224.4,
    vendasAtribuidas: 9, vendasDiretas: 8, anunciosCadastrados: 3, nome: "MS, LC, TT - Agências",
  }]]);

  it("bate campo a campo: cliques, impressões, investido, receita, vendas, ROAS", () => {
    const [c] = agregarPorCampanha(itens, "pub", reais);
    expect(c.clicks).toBe(100);
    expect(c.prints).toBe(29112);
    expect(c.cost).toBeCloseTo(34.91, 2);
    expect(c.receitaAtribuida).toBeCloseTo(251.37, 2);
    expect(c.vendasAtribuidas).toBe(9);
    expect(c.roasMlAds).toBeCloseTo(7.2, 1);
    expect(c.dailyBudget).toBe(40);
    expect(c.roasTarget).toBe(15);
  });

  it("anúncios: 3 cadastrados (o painel), 2 com gasto (o app contava só esses)", () => {
    const [c] = agregarPorCampanha(itens, "pub", reais);
    expect(c.anunciosCadastrados).toBe(3);
    expect(c.anuncios).toBe(2);
  });

  it("modo pub: receita = venda direta da CAMPANHA, unidades diretas da campanha", () => {
    const [c] = agregarPorCampanha(itens, "pub", reais);
    expect(c.receita).toBeCloseTo(224.4, 2);
    expect(c.unidades).toBe(8);
  });

  it("lucro = receita direta × margem dos produtos − investido", () => {
    const [c] = agregarPorCampanha(itens, "pub", reais);
    expect(c.lucroAposAds).toBeCloseTo(224.4 * 0.2 - 34.91, 2);
    expect(c.margem).toBeCloseTo(((224.4 * 0.2 - 34.91) / 224.4) * 100, 2);
    expect(c.lucroAproximado).toBe(false);
  });

  it("ROAS de equilíbrio = 1 ÷ margem antes de ads (20% → 5x)", () => {
    const [c] = agregarPorCampanha(itens, "pub", reais);
    expect(c.margemAntesAds).toBeCloseTo(0.2, 5);
    expect(c.roasEquilibrio).toBeCloseTo(5, 5);
  });

  it("margem ≤ 0: nenhum ROAS salva — equilíbrio null, não infinito", () => {
    const ruins = itens.map((i) => ({ ...i, margemAntesAds: -0.05 }));
    const [c] = agregarPorCampanha(ruins, "pub", reais);
    expect(c.roasEquilibrio).toBeNull();
    expect(c.lucroAposAds).toBeLessThan(0);
  });
});

describe("anúncio que trocou de campanha no período", () => {
  /**
   * As campanhas "- Agências" foram criadas em 12/11 e receberam anúncios
   * que rodavam em campanhas antigas. O `/ads/search` carimba a linha inteira
   * com a campanha ATUAL — a venda direta feita na antiga vinha junto.
   */
  const item: ItemParaCampanha = {
    campaignId: "nova", campaignName: "Açaí - Agências",
    clicks: 18, prints: 2116, cost: 6.36,
    directSales: 120, directUnits: 3, totalSales: 300, totalUnits: 7,
    lucroLiquido: 50, lucroDiretoLiquido: 20, diretoDisponivel: true,
    margemAntesAds: 0.25,
  };
  const reais = new Map([["nova", {
    clicks: 1, prints: 283, cost: 0.09, receitaAtribuida: 0, receitaDireta: 0, vendasAtribuidas: 0, vendasDiretas: 0,
  }]]);

  it("modo pub: a receita é a que o ML atribui a ESTA campanha (0), não a do anúncio (120)", () => {
    const [c] = agregarPorCampanha([item], "pub", reais);
    expect(c.receita).toBe(0);
    expect(c.cost).toBeCloseTo(0.09, 2);
    expect(c.lucroAposAds).toBeCloseTo(-0.09, 2);
  });

  it("e não chama isso de rateio — a receita já é da campanha", () => {
    const [c] = agregarPorCampanha([item], "pub", reais);
    expect(c.lucroAproximado).toBe(false);
  });
});

describe("campanha sem nenhum anúncio com gasto", () => {
  it("aparece na lista (o painel lista; 15 × 14 no app)", () => {
    const reais = new Map([
      ["7261169", { clicks: 0, prints: 754, cost: 0, receitaAtribuida: 0, nome: "Menta & Cereja - Full", anunciosCadastrados: 1 }],
    ]);
    const r = agregarPorCampanha([item({ campaignId: "outra" })], "pub", reais);
    const c = r.find((x) => x.campaignId === "7261169")!;
    expect(c).toBeDefined();
    expect(c.campaignName).toBe("Menta & Cereja - Full");
    expect(c.prints).toBe(754);
    expect(c.anunciosCadastrados).toBe(1);
    expect(c.lucroAposAds).toBeNull();
    expect(c.motivoSemLucro).toMatch(/nao investiu/);
  });

  it("campanha parada (zero em tudo) continua fora — é ruído", () => {
    const reais = new Map([["morta", { clicks: 0, prints: 0, cost: 0, receitaAtribuida: 0 }]]);
    expect(agregarPorCampanha([item()], "pub", reais).some((c) => c.campaignId === "morta")).toBe(false);
  });
});

describe("campanha fora da lista do ML", () => {
  it("ganha um nome que explica, não o id cru", () => {
    // 16–22/11: anúncio do Açaí em Pó gastou R$ 24,28 na 352947089, ausente do painel.
    const [c] = agregarPorCampanha([item({ campaignId: "352947089", campaignName: "", cost: 24.28 })], "pub");
    expect(c.campaignName).toBe("excluída ou fora da lista do ML (352947089)");
    expect(rotuloCampanha(c.campaignName)).toBe("Campanha excluída ou fora da lista do ML (352947089)");
  });

  it("sem campanha nenhuma continua 'Sem campanha identificada'", () => {
    const [c] = agregarPorCampanha([item({ campaignId: "", campaignName: "" })], "pub");
    expect(c.campaignName).toBe("Sem campanha identificada");
  });
});

describe("config da campanha sem anúncio com gasto", () => {
  it("orçamento e ROAS objetivo vêm da lista do ML, não '— sem meta'", () => {
    // Hoje (22/11): Sertanejo com 125 impressões, R$ 0 — painel: R$ 15/dia, meta 35x.
    const reais = new Map([["7260494", {
      clicks: 0, prints: 125, cost: 0, receitaAtribuida: 0, nome: "Sertanejo", dailyBudget: 15, roasTarget: 35,
    }]]);
    const c = agregarPorCampanha([item({ campaignId: "outra" })], "pub", reais).find((x) => x.campaignId === "7260494")!;
    expect(c.dailyBudget).toBe(15);
    expect(c.roasTarget).toBe(35);
  });

  it("o que veio do anúncio continua mandando", () => {
    const reais = new Map([["c1", { clicks: 10, prints: 100, cost: 50, receitaAtribuida: 0, dailyBudget: 99, roasTarget: 99 }]]);
    const [c] = agregarPorCampanha([item({ dailyBudget: 30, roasTarget: 12 })], "pub", reais);
    expect(c.dailyBudget).toBe(30);
    expect(c.roasTarget).toBe(12);
  });
});
