/**
 * Uma cor com transparência, a partir de QUALQUER cor: `#E9A92D`, `rgb(...)` ou
 * `var(--green)`.
 *
 * ─── O BUG QUE ISTO EVITA ───────────────────────────────────────────────
 *
 * Havia `border: \`1px solid ${cor}44\``. Com `cor = "#E9A92D"` isso vira um
 * hexadecimal de 8 dígitos e funciona. Com `cor = "var(--green)"` vira
 * `var(--green)44` — que NÃO é uma cor: o navegador descarta a declaração
 * inteira e o cartão fica sem borda, sem erro em lugar nenhum. Concatenar sufixo
 * hexadecimal só vale sobre hexadecimal.
 *
 * `color-mix` funciona sobre qualquer cor. Quem usa deve declarar antes uma
 * cor de reserva (`borderColor` sobre um `border` já completo), pra um navegador
 * sem `color-mix` cair nela em vez de perder a borda.
 */
export function tom(cor: string, percentual: number): string {
  const p = Math.min(100, Math.max(0, Math.round(percentual)));
  return `color-mix(in srgb, ${cor} ${p}%, transparent)`;
}
