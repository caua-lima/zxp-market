/**
 * O teclado virtual está cobrindo a página? E quanto?
 *
 * ─── O PROBLEMA ────────────────────────────────────────────────────────────
 *
 * No iOS Safari o teclado SOBREPÕE a página sem encolher o layout viewport: `dvh`, `vh` e
 * `position: fixed` continuam medindo a tela cheia. Um modal centrado ("fixed; inset: 0")
 * fica com o botão Salvar (no rodapé) ATRÁS do teclado. No Chrome do Android o app já pede
 * `interactive-widget=resizes-content` (app/layout.tsx), que resolve lá; o iOS ignora essa
 * chave. O que resta é ler a `visualViewport` — a área realmente visível — e ajustar.
 *
 * ─── QUANDO NÃO AGIR ──────────────────────────────────────────────────────
 *
 *  · Com zoom por pinça (`scale` ≠ 1) a área visível também encolhe, e reagir a isso
 *    encolheria os diálogos de quem só deu zoom.
 *  · Diferenças pequenas (barra de endereço que recolhe, ~50–70px) não são teclado: o
 *    limiar de 120px separa as duas coisas com folga (teclado de celular ≥ ~200px).
 */

export type MedidasDoViewport = {
  /** window.innerHeight — a altura do layout viewport. */
  alturaDaJanela: number;
  /** visualViewport.height. */
  alturaVisivel: number;
  /** visualViewport.offsetTop — o quanto a área visível foi empurrada pra baixo. */
  topoVisivel: number;
  /** visualViewport.scale. */
  escala: number;
};

export type AjusteDoViewport =
  | { ativo: false }
  | { ativo: true; altura: number; topo: number; teclado: number };

/** Abaixo disto a diferença é barra de endereço, não teclado. */
export const LIMIAR_DO_TECLADO_PX = 120;

export function ajusteDoViewport(m: MedidasDoViewport): AjusteDoViewport {
  const valores = [m.alturaDaJanela, m.alturaVisivel, m.topoVisivel, m.escala];
  if (valores.some((v) => !Number.isFinite(v)) || m.alturaDaJanela <= 0 || m.alturaVisivel <= 0) return { ativo: false };
  if (Math.abs(m.escala - 1) > 0.01) return { ativo: false };

  const teclado = m.alturaDaJanela - m.alturaVisivel - m.topoVisivel;
  if (teclado < LIMIAR_DO_TECLADO_PX) return { ativo: false };

  return { ativo: true, altura: Math.round(m.alturaVisivel), topo: Math.round(m.topoVisivel), teclado: Math.round(teclado) };
}
