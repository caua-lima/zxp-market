import { calculateBreakEvenRoas } from "./ads";

/**
 * Números derivados do card "Vendas do Dia".
 *
 * ─── POR QUE MÓDULO, E NÃO CONTA SOLTA NO COMPONENTE ────────────────────
 *
 * Toda métrica aqui tem uma borda que dá errado calado: divisão por zero num
 * dia sem venda, ROAS "0,00x" que parece desempenho péssimo quando na verdade
 * não houve campanha, margem que muda de sinal. Escrever isso no meio do JSX
 * é como esses erros entram — e num painel que a pessoa olha todo dia pra
 * decidir preço, entram sem ninguém ver.
 *
 * Puro e testado: as bordas viram teste em vez de bug.
 *
 * ─── A REGRA GERAL: null É "NÃO DÁ PRA SABER" ───────────────────────────
 *
 * Nenhuma função aqui devolve 0 pra dizer "sem base". Zero é um valor de
 * verdade (ticket zero, margem zero), e confundir os dois é o que faz a tela
 * mentir. Quem não tem base devolve null, e a tela mostra "—".
 */

export type EntradaDia = {
  faturamentoBruto: number;
  totalCMV: number;
  totalEnvio: number;
  totalTaxasML: number;
  totalImposto: number;
  totalAds: number;
  lucroLiquido: number;
  pedidos: number;
  unidades: number;
  /** Receita das vendas por clique no anúncio pago. */
  vendaDiretaAds: number;
};

/** Custos que NÃO são publicidade — a base do break-even do Ads. */
export function custosSemAds(d: EntradaDia): number {
  return d.totalCMV + d.totalEnvio + d.totalTaxasML + d.totalImposto;
}

/** Lucro antes de descontar o Ads. É o que sobra pra "pagar" a campanha. */
export function lucroAntesAds(d: EntradaDia): number {
  return d.faturamentoBruto - custosSemAds(d);
}

/**
 * Quanto cada pedido trouxe, em média. Denuncia mudança de mix antes de o
 * faturamento denunciar: se cai o ticket com o mesmo número de pedidos, o que
 * mudou foi o que está vendendo, não quanto.
 */
export function ticketMedio(d: EntradaDia): number | null {
  if (d.pedidos <= 0) return null;
  return d.faturamentoBruto / d.pedidos;
}

/** Custo médio por pedido, sem contar Ads — o piso pra pensar preço. */
export function custoPorPedido(d: EntradaDia): number | null {
  if (d.pedidos <= 0) return null;
  return custosSemAds(d) / d.pedidos;
}

/** ROAS da campanha: venda atribuída ao clique ÷ investido. */
export function roasDireto(d: EntradaDia): number | null {
  if (!(d.totalAds > 0)) return null;
  return d.vendaDiretaAds / d.totalAds;
}

/**
 * Faturamento do dia ÷ investido. Inclui venda orgânica, que o Ads não
 * trouxe — dimensiona o peso do Ads, não o mérito da campanha.
 */
export function roasGeral(d: EntradaDia): number | null {
  if (!(d.totalAds > 0)) return null;
  return d.faturamentoBruto / d.totalAds;
}

/**
 * O ROAS mínimo pra o Ads não dar prejuízo HOJE, com os custos reais do dia.
 *
 * É `receita ÷ lucro antes do ads` — a mesma fórmula que a aba Ads usa por
 * anúncio (calculateBreakEvenRoas), aqui aplicada ao dia inteiro. Reusa a
 * função de lá de propósito: duas cópias da mesma fórmula divergiriam, e a
 * tela passaria a dar dois veredictos pro mesmo dado.
 *
 * null quando o dia não gera lucro nem gastando zero em Ads — aí nenhum ROAS
 * resolve, e mostrar um número faria a tela sugerir uma meta impossível.
 */
export function roasBreakEven(d: EntradaDia): number | null {
  return calculateBreakEvenRoas(d.faturamentoBruto, lucroAntesAds(d));
}

/**
 * Margem que o dia teria SEM nenhum investimento em Ads.
 *
 * Comparada com a margem real, mostra o custo da publicidade em pontos de
 * margem — que é como se decide verba, não em reais soltos.
 */
export function margemSemAds(d: EntradaDia): number | null {
  if (!(d.faturamentoBruto > 0)) return null;
  return (lucroAntesAds(d) / d.faturamentoBruto) * 100;
}

export function margemReal(d: EntradaDia): number | null {
  if (!(d.faturamentoBruto > 0)) return null;
  return (d.lucroLiquido / d.faturamentoBruto) * 100;
}

/** Unidades por pedido — quantos itens o comprador leva junto. */
export function unidadesPorPedido(d: EntradaDia): number | null {
  if (d.pedidos <= 0) return null;
  return d.unidades / d.pedidos;
}

export type Variacao = {
  /** Diferença percentual. null = não dá pra comparar. */
  pct: number | null;
  /** true quando subiu. Irrelevante se pct for null. */
  subiu: boolean;
  /** true quando o anterior era zero — "de 0 pra algo" não tem percentual. */
  vindoDoZero: boolean;
};

/**
 * Variação contra o dia anterior.
 *
 * `anterior === 0` NÃO vira "+∞%" nem "+100%": não existe percentual de
 * crescimento sobre zero. A tela mostra "novo" em vez de um número inventado.
 */
export function variacao(atual: number, anterior: number | null | undefined): Variacao {
  if (anterior == null || !Number.isFinite(anterior)) {
    return { pct: null, subiu: false, vindoDoZero: false };
  }
  if (anterior === 0) {
    return { pct: null, subiu: atual > 0, vindoDoZero: atual > 0 };
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  return { pct, subiu: pct >= 0, vindoDoZero: false };
}

export type ProdutoDoDia = { titulo: string; receita: number; unidades: number };

/**
 * O que mais faturou hoje. Ordena por RECEITA, não por unidades: o card é
 * sobre dinheiro, e o campeão de unidades costuma ser o item barato.
 */
export function produtoDoDia(anuncios: ProdutoDoDia[]): ProdutoDoDia | null {
  const comReceita = anuncios.filter((a) => a.receita > 0);
  if (comReceita.length === 0) return null;
  return comReceita.reduce((melhor, a) => (a.receita > melhor.receita ? a : melhor));
}
