/**
 * A decisão de uma campanha em UMA palavra, pro selo da tabela de Ads.
 *
 * A tabela mostrava a frase inteira ("Dentro do esperado — nada a ajustar agora")
 * em cada linha: dez linhas de texto cinza do mesmo tamanho, e o caso que pede
 * ação (prejuízo confirmado) se perdia no meio. O selo é a leitura de relance; a
 * frase completa continua embaixo, menor, e no "Ver detalhes".
 *
 * O tom é o que pinta o selo:
 *   bom      → escalar
 *   ruim     → prejuízo confirmado (pausar)
 *   atencao  → revisar/reduzir
 *   neutro   → dentro do esperado
 *   vazio    → sem dado pra concluir
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type AcaoAds = "escalar" | "pausar" | "reduzir" | "sem-dados";
export type TomDecisao = "bom" | "ruim" | "atencao" | "neutro" | "vazio";

export function seloDaDecisao(reco: { acao: AcaoAds; label: string }): { rotulo: string; tom: TomDecisao } {
  switch (reco.acao) {
    case "escalar": return { rotulo: "Escalar", tom: "bom" };
    case "pausar": return { rotulo: "Prejuízo", tom: "ruim" };
    case "reduzir": return { rotulo: "Revisar", tom: "atencao" };
    default:
      return /dentro do esperado/i.test(reco.label)
        ? { rotulo: "Manter", tom: "neutro" }
        : { rotulo: "Sem dados", tom: "vazio" };
  }
}

/** Peso pra ordenar por urgência: o que pede ação primeiro. */
export const PESO_DO_TOM: Record<TomDecisao, number> = { ruim: 0, atencao: 1, bom: 2, neutro: 3, vazio: 4 };

/** "Via Ads" vira uma barrinha: o tamanho fica entre 0 e 100% mesmo se a atribuição do ML passar disso. */
export function larguraDaBarra(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(pct, 100);
}
