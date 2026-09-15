// Helper puro pro bloco "Produtos em risco" do Dashboard — cruza estoque
// (data.products) com o desempenho por anúncio do período (mlMetrics.anuncios)
// já calculados em outro lugar, e — quando disponível — a cobertura real em
// dias (Fase 5, via /api/ml/estoque-forecast). Sem esse dado (endpoint
// falhou, ou ainda carregando), cai num limiar simples de unidades como
// modo degradado, pra não deixar a lista vazia à toa.

import { calculateStockCoverage, getCoverageStatus } from "./estoque";

export type RiskAnuncio = {
  item_id: string;
  title: string;
  margem: number;
  vendas: number;
};

export type RiskProduto = {
  id: string;
  name: string;
  ativo: boolean;
  qtdLocal?: number;
  mlb?: string;
  mlbs?: string[];
};

export type RiskMotivo = "estoque-baixo" | "margem-baixa";

export type ProdutoEmRisco = {
  produtoId: string;
  nome: string;
  qtdLocal: number;
  margem: number | null;
  coberturaDias: number | null;
  motivos: RiskMotivo[];
};

const ESTOQUE_BAIXO_LIMIAR = 5;

function normalizeMlb(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

/**
 * Produtos ativos em risco por estoque e/ou margem. Estoque: se
 * `forecast` vier informado, usa cobertura real (<7 dias = crítico, mesma
 * régua do getCoverageStatus da aba Estoque); sem forecast, cai no limiar
 * provisório de unidades (modo degradado). Margem: abaixo da meta no
 * período, só quando o anúncio teve venda de verdade pra medir.
 */
export function findProdutosEmRisco(
  produtos: RiskProduto[],
  anuncios: RiskAnuncio[],
  metaMargem: number,
  /**
   * `diasAtivos` faz parte do contrato: sem ele a cobertura sai otimista, e
   * este painel existe justamente pra apontar risco. Ver calculateStockCoverage.
   */
  forecast?: { vendas: Record<string, number>; dias: number; diasAtivos?: Record<string, number> } | null,
): ProdutoEmRisco[] {
  const margemPorMlb = new Map<string, { margem: number; vendas: number }>();
  for (const a of anuncios) {
    margemPorMlb.set(normalizeMlb(a.item_id), { margem: a.margem, vendas: a.vendas });
  }

  const riscos: ProdutoEmRisco[] = [];
  for (const p of produtos) {
    if (!p.ativo) continue;
    const qtd = p.qtdLocal ?? 0;
    const mlbs = (p.mlbs?.length ? p.mlbs : p.mlb ? [p.mlb] : []).map(normalizeMlb);
    const desempenho = mlbs.map((m) => margemPorMlb.get(m)).find((d) => d != null) ?? null;

    const motivos: RiskMotivo[] = [];
    let coberturaDias: number | null = null;
    if (forecast) {
      const vendasPeriodo = forecast.vendas[p.id] ?? 0;
      coberturaDias = calculateStockCoverage(qtd, vendasPeriodo, forecast.dias, forecast.diasAtivos?.[p.id]);
      const status = getCoverageStatus(coberturaDias, qtd, vendasPeriodo);
      if (status === "critico") motivos.push("estoque-baixo");
    } else if (qtd > 0 && qtd <= ESTOQUE_BAIXO_LIMIAR) {
      motivos.push("estoque-baixo");
    }
    if (desempenho && desempenho.vendas > 0 && metaMargem > 0 && desempenho.margem < metaMargem) motivos.push("margem-baixa");

    if (motivos.length === 0) continue;
    riscos.push({
      produtoId: p.id,
      nome: p.name,
      qtdLocal: qtd,
      margem: desempenho?.margem ?? null,
      coberturaDias,
      motivos,
    });
  }

  // Pior primeiro: os dois riscos juntos, depois quem tem menos cobertura/estoque.
  return riscos.sort((a, b) => {
    const porMotivos = b.motivos.length - a.motivos.length;
    if (porMotivos !== 0) return porMotivos;
    if (a.coberturaDias != null && b.coberturaDias != null) return a.coberturaDias - b.coberturaDias;
    return a.qtdLocal - b.qtdLocal;
  });
}
