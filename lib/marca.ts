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

/**
 * Ícone do app: fundo onyx com cantos de raio 44, Z dourado.
 *
 * ─── SEM TRANSFORM ──────────────────────────────────────────────────────
 *
 * Havia um `translate(24,24) scale(0.76)` envolvendo o traço: o Z saía a 76%
 * do tamanho e deslocado. O guia de identidade especifica o desenho SEM
 * transform nenhuma, e a razão é o que ele chama de elo entre os 4 apps da
 * família — se cada um encolhe o traço num fator próprio, o "mesmo símbolo em
 * cores diferentes" deixa de ser o mesmo símbolo.
 *
 * O traço em tamanho cheio cabe: com `stroke-width` 34 o desenho ocupa de
 * x=13 a x=187 e de y=30 a y=170, e o ponto mais externo (13,30) fica dentro
 * do arco de raio 44 — nada é cortado pelos cantos.
 */
export function svgAppIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="44" fill="${MARCA_ONYX}"/><polyline ${TRACO} stroke="${MARCA_DOURADO}"/></svg>`;
}

/**
 * Favicon — o MESMO desenho do ícone do app.
 *
 * ─── ERA INVERTIDO, E DEIXOU DE SER ─────────────────────────────────────
 *
 * Antes: fundo dourado, Z onyx, cantos de raio 26. A justificativa era real —
 * em 16-32px o Z vazado sobre fundo escuro perde peso na aba do navegador, e
 * o bloco dourado cheio lê melhor.
 *
 * O guia de identidade decide contra: o símbolo é o traço DOURADO sobre
 * contêiner ONYX, e é isso que conecta os 4 apps da família. Um favicon
 * invertido faz o Market ser o único app cujo ícone na aba não parece com o
 * ícone do próprio app.
 *
 * Fica registrado o custo da escolha: em 16px o Z tem menos presença que
 * tinha. Se isso incomodar na prática, o lugar de reverter é aqui — e a volta
 * é o bloco dourado com o Z onyx, não uma terceira variante.
 */
export function svgFavicon(): string {
  return svgAppIcon();
}

/** Data URI pronto pra usar em <img src=...> dentro do ImageResponse. */
export function comoDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
