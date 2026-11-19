import { describe, expect, it } from "vitest";
import { METRICAS_CAMPANHA, metricasDaCampanha } from "./ads-metricas-campanha";

/**
 * Campanha "MS, LC, TT - Agências" em 13–19/11, como o painel do Mercado Ads
 * devolve (campos em snake_case, como a API pública usa). O painel mostrava:
 * 100 cliques · R$ 34,91 · receita R$ 251,37 (224,40 direta + 26,97 assistida)
 * · 9 vendas atribuídas (8 diretas + 1 assistida) · ROAS 7,2x.
 */
const msLcTt = {
  id: 7469663,
  name: " MS, LC, TT - Agências",
  metrics: {
    clicks: 100, prints: 29112, cost: 34.91,
    direct_amount: 224.4, indirect_amount: 26.97, total_amount: 251.37,
    direct_units_quantity: 8, indirect_units_quantity: 1, units_quantity: 9,
    direct_items_quantity: 7, indirect_items_quantity: 1,
  },
};

describe("metricasDaCampanha", () => {
  it("lê o que o painel mostra, campo por campo", () => {
    const m = metricasDaCampanha(msLcTt);
    expect(m.clicks).toBe(100);
    expect(m.prints).toBe(29112);
    expect(m.cost).toBeCloseTo(34.91, 2);
    expect(m.receitaAtribuida).toBeCloseTo(251.37, 2);
    expect(m.receitaDireta).toBeCloseTo(224.4, 2);
    expect(m.receitaAtribuida / m.cost).toBeCloseTo(7.2, 1);
  });

  it("vendas atribuídas são UNIDADES (9), não itens distintos (7 + 1 = 8)", () => {
    const m = metricasDaCampanha(msLcTt);
    expect(m.vendasAtribuidas).toBe(9);
    expect(m.vendasDiretas).toBe(8);
  });

  it("sem units_quantity, soma direta + assistida", () => {
    const { units_quantity: _, ...semTotal } = msLcTt.metrics;
    expect(metricasDaCampanha({ metrics: semTotal }).vendasAtribuidas).toBe(9);
  });

  it("sem NENHUM campo de unidade, null — não zero inventado", () => {
    const m = metricasDaCampanha({ metrics: { clicks: 10, cost: 5, direct_amount: 50, indirect_amount: 0 } });
    expect(m.vendasAtribuidas).toBeNull();
    expect(m.vendasDiretas).toBeNull();
  });

  it("sem total_amount, a receita atribuída é direta + assistida (formato antigo)", () => {
    const m = metricasDaCampanha({ metrics: { cost: 10, direct_amount: 30, indirect_amount: 12 } });
    expect(m.receitaAtribuida).toBe(42);
    expect(m.receitaDireta).toBe(30);
  });

  it("campanha que não gastou devolve zeros, não erro", () => {
    const m = metricasDaCampanha({ id: 7261169, metrics: { clicks: 0, prints: 754, cost: 0 } });
    expect(m).toMatchObject({ clicks: 0, prints: 754, cost: 0, receitaAtribuida: 0 });
  });

  it("o último degrau de métricas é o que já funcionava antes desta mudança", () => {
    expect(METRICAS_CAMPANHA.at(-1)).toBe("clicks,prints,cost,direct_amount,indirect_amount");
    expect(METRICAS_CAMPANHA[0]).toContain("units_quantity");
  });
});
