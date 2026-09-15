/**
 * A cor do ROAS — contra o equilíbrio do próprio anúncio, não contra um número
 * fixo.
 *
 * ─── O QUE HAVIA ────────────────────────────────────────────────────────
 *
 *   corRoas = (r) => r >= 3 ? verde : r >= 1.5 ? amarelo : vermelho
 *
 * Três e um e meio, pra todo anúncio. Mas o ROAS que faz um anúncio empatar
 * depende inteiramente da margem do produto: um item com 40% de margem empata
 * perto de 2,5x, e um com 8% precisa de mais de 12x pra não perder dinheiro.
 *
 * Com o corte fixo, o anúncio de margem fina aparecia VERDE aos 3,2x enquanto
 * queimava dinheiro, e o de margem gorda aparecia amarelo aos 2,8x estando
 * lucrativo. A cor apontava para o lado errado justamente onde a decisão é
 * difícil.
 *
 * Cada linha da tabela já carrega `breakEven` (o ROAS que empata) e
 * `roasIdeal` (o que fecha a margem alvo). Eles é que definem as faixas.
 */

export type FaixaRoas = "sem_dado" | "perde" | "empata" | "fecha";

export type CorRoas = {
  faixa: FaixaRoas;
  cor: string;
  /** Por que essa cor — vai pro tooltip, pra a cor não ser um enigma. */
  motivo: string;
};

/** Cortes genéricos, usados SÓ quando o equilíbrio do anúncio é desconhecido. */
const VERDE_GENERICO = 3;
const AMARELO_GENERICO = 1.5;

/**
 * @param roas       o ROAS EXIBIDO na célula. Não outro: a cor tem que
 *                   explicar o número que está ali.
 * @param breakEven  ROAS que empata este anúncio. `null` = desconhecido.
 * @param roasIdeal  ROAS que fecha a margem alvo. `null` = não existe alvo
 *                   possível (o produto não alcança essa margem nem gastando
 *                   zero em ads).
 */
export function corDoRoas(
  roas: number | null | undefined,
  breakEven: number | null | undefined,
  roasIdeal: number | null | undefined,
): CorRoas {
  /**
   * Sem ROAS não há cor. A célula mostra "—" nesse caso, e pintá-la de verde
   * ou vermelho seria dar veredicto sobre um número que não existe — era o que
   * acontecia, porque a cor caía num valor alternativo enquanto o texto
   * mostrava o traço.
   */
  if (roas == null || !Number.isFinite(roas)) {
    return { faixa: "sem_dado", cor: "var(--muted)", motivo: "Sem investimento no período — não há ROAS a avaliar." };
  }

  const be = breakEven != null && Number.isFinite(breakEven) && breakEven > 0 ? breakEven : null;

  if (be == null) {
    // Sem equilíbrio conhecido, resta o corte genérico — e o motivo diz isso,
    // pra ninguém ler a cor como se fosse específica do anúncio.
    const cor = roas >= VERDE_GENERICO ? "var(--green)" : roas >= AMARELO_GENERICO ? "var(--yellow)" : "var(--red)";
    return { faixa: roas >= VERDE_GENERICO ? "fecha" : roas >= AMARELO_GENERICO ? "empata" : "perde", cor,
      motivo: "Sem custo do produto no período, a cor usa uma referência genérica, não o equilíbrio deste anúncio." };
  }

  if (roas < be) {
    return { faixa: "perde", cor: "var(--red)",
      motivo: `Abaixo do equilíbrio deste anúncio (${be.toFixed(2)}x) — cada venda por aqui perde dinheiro.` };
  }

  const ideal = roasIdeal != null && Number.isFinite(roasIdeal) && roasIdeal > 0 ? roasIdeal : null;
  if (ideal != null && roas < ideal) {
    return { faixa: "empata", cor: "var(--yellow)",
      motivo: `Acima do equilíbrio (${be.toFixed(2)}x), abaixo do ideal (${ideal.toFixed(2)}x) — dá lucro, mas não fecha a margem alvo.` };
  }

  return { faixa: "fecha", cor: "var(--green)",
    motivo: ideal != null
      ? `Acima do ROAS ideal (${ideal.toFixed(2)}x) — fecha a margem alvo.`
      : `Acima do equilíbrio (${be.toFixed(2)}x). Não há margem alvo alcançável pra este produto.` };
}

/**
 * A chave de ordenação de uma coluna numérica que pode não ter valor.
 *
 * Ausente vai SEMPRE pro fim, nos dois sentidos da ordenação: "não sei" não é
 * um valor baixo, e misturá-lo com os piores esconde os piores de verdade.
 */
export function chaveOrdenacao(valor: number | null | undefined, dir: number): number {
  if (valor == null || !Number.isFinite(valor)) return dir >= 0 ? Infinity : -Infinity;
  return valor;
}
