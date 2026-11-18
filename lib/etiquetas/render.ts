/**
 * O que o motor de render (Zebrash/WASM) precisa receber.
 *
 * ─── POR QUE NORMALIZAR ─────────────────────────────────────────────────
 *
 * O ML manda o ícone de avião (envio aéreo) num `^GFA` com espaços entre as
 * linhas repetidas (`,,: : : :M01E,…`). A impressora Zebra ignora o espaço;
 * o Zebrash recusa a etiqueta inteira ("encoding/hex: invalid byte ' '").
 * Na amostra de 13/11 isso derrubava 4 das 19 etiquetas.
 *
 * Só a CÓPIA que vai pro render é normalizada: o arquivo que a pessoa baixa
 * e imprime continua byte a byte o que o ML mandou (mais a marcação, quando
 * pedida). Puro, sem `@/` — roda no Worker e no teste.
 */

/** Etiqueta do ML: 4 × 6 polegadas a 8 pontos/mm (203 dpi). */
export const LARGURA_MM = 101.6;
export const ALTURA_MM = 152.4;
export const DPMM = 8;

/** Tira espaço/quebra de linha de dentro dos dados de `^GF` (do 4º parâmetro até o próximo comando). */
export function normalizarParaRender(zpl: string): string {
  return String(zpl ?? "").replace(
    /(\^GF[ABC]?,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,)([^\^~]*)/g,
    (_m, cabecalho: string, dados: string) => cabecalho.replace(/\s+/g, "") + dados.replace(/\s+/g, ""),
  );
}

/**
 * Onde o navegador busca o motor (7 MB). Copiado de node_modules pra
 * `public/` no `predev`/`prebuild` (scripts/copiar-motor-zpl.mjs) — servido
 * pelo próprio site, sem CDN de terceiro. A versão no nome evita cache velho.
 */
export const VERSAO_MOTOR = "5.0.0";
export const URL_DO_MOTOR = `/motor/zebrash-${VERSAO_MOTOR}.wasm`;
