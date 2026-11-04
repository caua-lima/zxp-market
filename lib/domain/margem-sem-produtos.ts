/**
 * MARGEM SEM OS PRODUTOS EM QUEIMA DE PREÇO.
 *
 * Pedido do dono em 03/11/2026: "excepcionalmente esse começo de mês estamos
 * queimando preço nos açaís" (margem de −28%, girando caixa). A margem do
 * período passa a ser mostrada SEM esses produtos, com o número "contando os
 * açaís" ao lado — a decisão de queimar preço não esconde a saúde do resto.
 *
 * Sem mexer no cálculo base: a rota de métricas já traz, por anúncio, o
 * retorno e o lucro (com ADS, taxa, frete, imposto e CMV). Então
 *   margem sem = (lucro do período − lucro dos tirados) ÷ (retorno − retorno dos tirados).
 * Os custos operacionais (aba Custos) continuam inteiros no "sem": são da
 * empresa, não dos açaís.
 */

/** Quais produtos saem, por mês. Novembro/2026: os açaís (o pedido). Outros meses: nenhum, até alguém ligar. */
const PADRAO_POR_MES: Record<string, string[]> = {
  "2026-11": ["açaí"],
};

export function termosPadraoDoMes(mes: string): string[] {
  return PADRAO_POR_MES[mes.slice(0, 7)] ?? [];
}

/** Sem acento e em minúsculas: "Açaí", "ACAI" e "açai" são o mesmo termo. */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function ehProdutoTirado(titulo: string, termos: readonly string[]): boolean {
  const t = normalizar(titulo);
  return termos.some((termo) => {
    const x = normalizar(termo).trim();
    return x.length > 0 && t.includes(x);
  });
}

type Anuncio = { title: string; retorno: number; lucro: number };

export type MargemSemProdutos = {
  /** A margem sem os produtos tirados (null se não sobra retorno). */
  margemSem: number | null;
  lucroSem: number;
  retornoSem: number;
  /** O que saiu: quantos anúncios, quanto de retorno e de lucro, e a margem deles. */
  tirados: { anuncios: number; retorno: number; lucro: number; margem: number | null };
};

/**
 * @returns null quando nenhum anúncio do período bate com os termos — aí não
 *   há o que tirar e a tela mostra a margem normal.
 */
export function margemSemProdutos(
  m: { lucroComCustos: number; totalRetorno: number; anuncios: readonly Anuncio[] },
  termos: readonly string[],
): MargemSemProdutos | null {
  if (termos.length === 0) return null;
  const fora = m.anuncios.filter((a) => ehProdutoTirado(a.title ?? "", termos));
  if (fora.length === 0) return null;
  const retornoFora = fora.reduce((s, a) => s + (a.retorno || 0), 0);
  const lucroFora = fora.reduce((s, a) => s + (a.lucro || 0), 0);
  const retornoSem = m.totalRetorno - retornoFora;
  const lucroSem = m.lucroComCustos - lucroFora;
  return {
    margemSem: retornoSem > 0 ? (lucroSem / retornoSem) * 100 : null,
    lucroSem,
    retornoSem,
    tirados: {
      anuncios: fora.length,
      retorno: retornoFora,
      lucro: lucroFora,
      margem: retornoFora > 0 ? (lucroFora / retornoFora) * 100 : null,
    },
  };
}
