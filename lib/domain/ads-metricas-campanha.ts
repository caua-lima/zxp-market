/**
 * Leitura das métricas de UMA campanha, como o recurso de campanha do Mercado
 * Ads devolve. Puro de propósito: é aqui que se decide qual campo vira qual
 * número da tela, e isso precisa ser testável com o JSON real do ML.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────
 *
 * Antes a campanha trazia só cliques, impressões, investido e a receita
 * atribuída somada. Faltava:
 *
 *  - a receita DIRETA da campanha. No modo "Publicidade direta" ela saía da
 *    soma dos anúncios — e o `/ads/search` carimba cada anúncio com a campanha
 *    ATUAL dele. Anúncio que trocou de campanha no meio do período levava a
 *    venda direta inteira pra campanha nova;
 *  - as VENDAS ATRIBUÍDAS como o painel conta: unidades (direta + assistida),
 *    não itens distintos. Medido em 06–12/11: "MS, LC, TT" com 45 no painel e
 *    39 no app (o comprador que leva 2 pacotes conta 2 lá e 1 aqui).
 */

export type MetricasCampanha = {
  clicks: number;
  prints: number;
  cost: number;
  /** Receita atribuída TOTAL (direta + assistida) — a base do ROAS do painel. */
  receitaAtribuida: number;
  /** Receita só das vendas diretas (clicou no anúncio e comprou o mesmo produto). */
  receitaDireta: number;
  /**
   * "Vendas atribuídas" do painel: UNIDADES, direta + assistida. `null` quando
   * o ML não mandou nenhum campo de unidade — aí a tela cai na soma dos
   * anúncios em vez de mostrar 0 como se fosse fato.
   */
  vendasAtribuidas: number | null;
  /** Unidades de venda direta. `null` pelo mesmo motivo acima. */
  vendasDiretas: number | null;
};

/** Valor de uma métrica onde quer que o ML a tenha posto; `null` = campo ausente. */
function ler(row: Record<string, unknown>, chave: string): number | null {
  const fontes = [row.metrics, row.metrics_summary, row].filter(
    (f): f is Record<string, unknown> => !!f && typeof f === "object",
  );
  for (const f of fontes) {
    const v = f[chave];
    if (v != null && v !== "") return Number(v) || 0;
  }
  return null;
}

const somaOuNull = (a: number | null, b: number | null): number | null =>
  a == null && b == null ? null : (a ?? 0) + (b ?? 0);

export function metricasDaCampanha(row: Record<string, unknown>): MetricasCampanha {
  const direta = ler(row, "direct_amount") ?? 0;
  const indireta = ler(row, "indirect_amount") ?? 0;
  /**
   * `total_amount` é o campo que o painel mostra como "Receita". Na conta ele
   * sempre foi igual a direta + assistida; quando não vem, a soma é a mesma
   * definição.
   */
  const total = ler(row, "total_amount") ?? direta + indireta;

  const uDiretas = ler(row, "direct_units_quantity");
  const uIndiretas = ler(row, "indirect_units_quantity");
  const unidades = ler(row, "units_quantity") ?? somaOuNull(uDiretas, uIndiretas);

  return {
    clicks: ler(row, "clicks") ?? 0,
    prints: ler(row, "prints") ?? 0,
    cost: ler(row, "cost") ?? 0,
    receitaAtribuida: total,
    receitaDireta: direta,
    vendasAtribuidas: unidades,
    vendasDiretas: uDiretas,
  };
}

/**
 * Conjuntos de métricas pedidos ao recurso de campanha, do mais completo ao
 * mínimo. Uma métrica que o ML não reconhece derruba a chamada INTEIRA com
 * 4xx — e sem fallback a campanha perderia até o investimento. Cada degrau
 * abaixo é um conjunto que já funcionou nesta conta.
 */
export const METRICAS_CAMPANHA: readonly string[] = [
  "clicks,prints,cost,direct_amount,indirect_amount,total_amount,direct_units_quantity,indirect_units_quantity,units_quantity",
  "clicks,prints,cost,direct_amount,indirect_amount",
];
