import { describe, expect, it } from "vitest";
import { agregarPorCampanha, CAMPANHA_SEM_ID, type ItemParaCampanha } from "./ads-campaigns";

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

  it("e por isso NÃO afirma lucro: seria o custo do anúncio inteiro ao lado de um custo menor", () => {
    expect(agregarPorCampanha([item], "geral", reais)[0].lucroAposAds).toBeNull();
    expect(agregarPorCampanha([item], "geral", reais)[0].margem).toBeNull();
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

  it("anuncio em duas campanhas: o motivo explica que o ML soma as metricas", () => {
    const reais = new Map([["c1", { clicks: 10, prints: 100, cost: 99, receitaAtribuida: 100 }]]);
    const [c] = agregarPorCampanha([base], "geral", reais);
    expect(c.atribuicaoIncerta).toBe(true);
    expect(c.motivoSemLucro).toMatch(/roda em outra/);
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
