/**
 * A margem dos PEDIDOS contra a margem do DIA — e por que elas não batem.
 *
 * ─── O QUE CAUSOU ISTO ───────────────────────────────────────────────────
 *
 * Em 23/09/2026 a aba Pedidos mostrava quase todos os pedidos com margem
 * acima de 10%, e o Dashboard mostrava a margem do dia em 3,8%. Medido na
 * produção (scripts/diagnostico-margem-dia.mjs), as duas contas estavam
 * CERTAS — só respondiam perguntas diferentes:
 *
 *   · o pedido não desconta Ads (é gasto do dia, não da venda): o dia
 *     inteiro dava 9,5% ANTES do Ads e 3,8% DEPOIS (R$ 81,81 de Ads, 5,7%
 *     da receita);
 *   · "a maioria dos pedidos" conta cada pedido como 1, e o dia pondera
 *     por VALOR: 3 pedidos de Açaí em Pó eram 47% da receita a 8%.
 *
 * E a própria aba piorava a leitura: o KPI "Margem média" era a média
 * SIMPLES das margens (um pedido de R$ 20 pesava igual a um de R$ 300) e
 * contava cancelado e pedido sem cadastro — este com custo zero, margem
 * inflada.
 *
 * Este módulo é a conta honesta: só vendas válidas (sem cancelado/
 * devolvido), só custo conhecido (sem "sem cadastro"), ponderada por valor,
 * e a ponte explícita até a margem com Ads — a mesma conta do Dashboard.
 */

export type PedidoParaMargem = {
  bruto: number;
  lucro: number;
  margem: number;
  vinculado: boolean;
  cancelado?: boolean;
  devolvido?: boolean;
};

/** Filtro rápido da aba: "" = sem filtro. */
export type FaixaDeMargem = "" | "acima" | "abaixo";

/** Venda de verdade: não foi cancelada nem devolvida. */
export function ehVendaValida(p: PedidoParaMargem): boolean {
  return !p.cancelado && !p.devolvido;
}

/**
 * A margem desse pedido é REAL? Precisa ser venda válida e ter o custo de
 * todos os itens — pedido sem cadastro entra com custo zero, e a margem
 * dele (geralmente altíssima) não diz nada sobre o negócio.
 */
export function temMargemConhecida(p: PedidoParaMargem): boolean {
  return ehVendaValida(p) && p.vinculado;
}

/**
 * O pedido está na faixa pedida? `acima` = margem ≥ limiar (a mesma regra
 * de "saudável" em getMarginStatus, lib/domain/calc.ts), `abaixo` = menor.
 *
 * Pedido sem margem conhecida nunca entra numa faixa: se entrasse, o filtro
 * "≥ 10%" mostraria justamente os pedidos sem custo cadastrado, e a contagem
 * na tela voltaria a enganar do mesmo jeito que antes.
 */
export function naFaixaDeMargem(p: PedidoParaMargem, faixa: FaixaDeMargem, limiar: number): boolean {
  if (!faixa) return true;
  if (!temMargemConhecida(p)) return false;
  return faixa === "acima" ? p.margem >= limiar : p.margem < limiar;
}

/**
 * Lucro ÷ receita dos pedidos com margem conhecida — ponderada por VALOR.
 * `margem` é null sem receita: zero seria uma resposta ("margem nula"), e
 * não há resposta.
 */
export function margemPonderada(pedidos: readonly PedidoParaMargem[]): { receita: number; lucro: number; margem: number | null } {
  let receita = 0;
  let lucro = 0;
  for (const p of pedidos) {
    if (!temMargemConhecida(p)) continue;
    receita += p.bruto;
    lucro += p.lucro;
  }
  return { receita, lucro, margem: receita > 0 ? (lucro / receita) * 100 : null };
}

export type ResumoDeMargem = {
  /** Vendas válidas com custo conhecido — a base de "X de Y". */
  comCusto: number;
  acima: number;
  abaixo: number;
  /** Válidas, mas sem custo cadastrado: margem desconhecida, fora da conta. */
  semCadastro: number;
  /** Cancelados e devolvidos: não são venda, fora da conta. */
  naoVendas: number;
  receita: number;
  lucroSemAds: number;
  margemSemAds: number | null;
  ads: number;
  lucroComAds: number;
  /** A conta do Dashboard: (lucro − Ads) ÷ receita. */
  margemComAds: number | null;
};

/**
 * O resumo do período: quantos pedidos acima/abaixo do limiar e a ponte
 * sem Ads → com Ads.
 *
 * Recebe TODOS os pedidos do período — não a lista já filtrada pela tela.
 * O Ads é custo do período inteiro: descontá-lo só dos pedidos que sobraram
 * num filtro de produto ou de margem daria uma margem que não existe.
 *
 * @param ads gasto de Ads do período (a mesma soma que o Dashboard usa:
 *   todos os anúncios, inclusive os que não venderam).
 */
export function resumoDeMargem(
  pedidos: readonly PedidoParaMargem[],
  { limiar, ads }: { limiar: number; ads: number },
): ResumoDeMargem {
  let acima = 0, abaixo = 0, semCadastro = 0, naoVendas = 0;
  for (const p of pedidos) {
    if (!ehVendaValida(p)) { naoVendas++; continue; }
    if (!p.vinculado) { semCadastro++; continue; }
    if (p.margem >= limiar) acima++;
    else abaixo++;
  }
  const { receita, lucro, margem } = margemPonderada(pedidos);
  const adsPositivo = Math.max(0, Number(ads) || 0);
  const lucroComAds = lucro - adsPositivo;
  return {
    comCusto: acima + abaixo,
    acima,
    abaixo,
    semCadastro,
    naoVendas,
    receita,
    lucroSemAds: lucro,
    margemSemAds: margem,
    ads: adsPositivo,
    lucroComAds,
    margemComAds: receita > 0 ? (lucroComAds / receita) * 100 : null,
  };
}
