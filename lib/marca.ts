/**
 * Marca oficial da ZXP Solutions, como SVG inline.
 *
 * Fonte: public/marca/zxp-*.svg (arquivos entregues pelo dono da marca). O
 * desenho é uma POLILINHA com traço grosso e canto reto — não um polígono
 * preenchido. A versão anterior do app aproximava isso à mão e o peso das
 * hastes ficava diferente do original.
 *
 * Existe aqui como string porque os ícones (favicon, PWA, Apple) são gerados
 * em runtime com ImageResponse, e a forma confiável de desenhar SVG ali é
 * embutir como `data:` URI numa <img> — o renderizador do gerador tem suporte
 * limitado a stroke em elementos SVG soltos, e um traço que não renderiza
 * produziria um ícone em branco sem erro nenhum.
 */

export const MARCA_ONYX = "#10100E";
export const MARCA_DOURADO = "#F4B942";
/**
 * O dourado suave usado como area preenchida nos graficos.
 *
 * Chart.js desenha em canvas e nao enxerga custom property de CSS, entao aqui
 * a cor precisa ser literal. Ficar como literal DENTRO deste modulo mantem
 * uma fonte so — espalhada pelos componentes de grafico, ja eram tres copias.
 */
export const MARCA_DOURADO_SUAVE = "rgba(244,185,66,.12)";

/** Traço do "Z" — idêntico ao arquivo de marca, sem reescalar. */
const TRACO = 'points="30,47 170,47 30,153 170,153" fill="none" stroke-width="34" stroke-linejoin="miter" stroke-linecap="butt"';

/** Ícone do app: fundo onyx, Z dourado, cantos arredondados. */
export function svgAppIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="44" fill="${MARCA_ONYX}"/><g transform="translate(24,24) scale(0.76)"><polyline ${TRACO} stroke="${MARCA_DOURADO}"/></g></svg>`;
}

/**
 * Favicon: INVERTIDO de propósito (fundo dourado, Z onyx). Em 16-32px o Z
 * vazado sobre fundo escuro perde peso na aba do navegador; o bloco dourado
 * cheio garante a leitura. É a variante `favicon-dourado.svg` do kit.
 */
export function svgFavicon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="26" fill="${MARCA_DOURADO}"/><polyline ${TRACO} stroke="${MARCA_ONYX}"/></svg>`;
}

/** Data URI pronto pra usar em <img src=...> dentro do ImageResponse. */
export function comoDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
