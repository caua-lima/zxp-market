/**
 * Onde a dica (tooltip ⓘ) aparece sem sair da tela (S28).
 *
 * A dica abre centralizada no ícone. Um ícone perto da borda jogava metade
 * dela pra fora — no Dashboard, a página ficava 32 px mais larga que a janela
 * (1395 em 1363). Aqui: quanto deslocar pro lado pra caber, com margem.
 */
export function deslocamentoDaDica(p: { centro: number; largura: number; larguraTela: number; margem?: number }): number {
  const margem = p.margem ?? 12;
  const largura = Math.min(p.largura, p.larguraTela - 2 * margem);
  const esquerda = p.centro - largura / 2;
  if (esquerda < margem) return Math.round(margem - esquerda);
  const direita = esquerda + largura;
  if (direita > p.larguraTela - margem) return Math.round(p.larguraTela - margem - direita);
  return 0;
}
