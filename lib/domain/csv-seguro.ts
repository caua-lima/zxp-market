/**
 * Neutraliza injeção de fórmula em CSV (OWASP CSV Injection).
 *
 * Um texto que comece com `=`, `+`, `-`, `@`, tab ou retorno de carro vira
 * FÓRMULA quando o Excel/Sheets abre o arquivo — mesmo com o campo entre
 * aspas, porque a aspa é delimitador de CSV, não uma marca de "isto é texto"
 * que a planilha reconheça. Um nome de produto, título de anúncio ou motivo
 * de alteração vindos de fora (ML, digitado por alguém) que comece assim
 * executa ao abrir: é o vetor clássico de phishing/RCE via export.
 *
 * Números de verdade — incluindo negativos (`-42,50`, `-42.50`) — NÃO são
 * tocados: só levam o prefixo de escape os textos que apenas COMEÇAM com um
 * desses caracteres sem serem, de fato, um número.
 */
const NUMERO_PURO = /^-?\d+([.,]\d+)?%?$/;
const GATILHO_NO_INICIO = /^[=+\-@\t\r]/;

export function celulaCsvSegura(valor: string | number): string {
  if (typeof valor === "number") return String(valor);
  const texto = String(valor ?? "");
  const semEspacos = texto.trim();
  if (semEspacos === "" || NUMERO_PURO.test(semEspacos)) return texto;
  return GATILHO_NO_INICIO.test(texto) ? `'${texto}` : texto;
}

/** Uma linha (array de células) virada CSV, já com aspas e escape de fórmula. */
export function linhaCsvSegura(cols: (string | number)[]): string {
  return cols.map((c) => `"${celulaCsvSegura(c).replace(/"/g, '""')}"`).join(";");
}
