/**
 * Dinheiro do módulo Financeiro: sempre CENTAVOS INTEIROS.
 *
 * Somar 0,1 + 0,2 em ponto flutuante dá 0,30000000000000004; num extrato com
 * centenas de linhas isso vira um centavo sobrando que ninguém acha. Aqui todo
 * valor é inteiro, e a conversão de/para texto acontece só na borda (o que se
 * digita, o que se mostra, o que se importa).
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type Centavos = number;

/**
 * Texto digitado ou importado → centavos. Aceita "1.234,56", "1234,56",
 * "1234.56", "-12,5", "R$ 10". Devolve null pro que não é valor — nunca 0 por
 * engano (0 é valor de verdade; texto inválido não é).
 */
export function paraCentavos(texto: unknown): Centavos | null {
  if (typeof texto === "number") return Number.isFinite(texto) ? Math.round(texto * 100) : null;
  let s = String(texto ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s) return null;
  const negativo = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/^[-(]|\)$/g, "");
  if (!/^[\d.,]+$/.test(s)) return null;
  const ultimaVirgula = s.lastIndexOf(",");
  const ultimoPonto = s.lastIndexOf(".");
  // O separador decimal é o ÚLTIMO dos dois, se tiver 1 ou 2 dígitos depois.
  const sep = ultimaVirgula > ultimoPonto ? "," : ".";
  const pos = Math.max(ultimaVirgula, ultimoPonto);
  let inteiro = s, frac = "";
  if (pos >= 0 && s.length - pos - 1 <= 2 && s.length - pos - 1 >= 1) {
    inteiro = s.slice(0, pos);
    frac = s.slice(pos + 1);
  } else if (pos >= 0 && sep === "," && s.length - pos - 1 > 2) {
    return null; // "1,234" é ambíguo em pt-BR — não chuta
  }
  inteiro = inteiro.replace(/[.,]/g, "");
  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(frac)) return null;
  const c = Number(inteiro || "0") * 100 + Number((frac + "00").slice(0, 2));
  return negativo ? -c : c;
}

/** Centavos → "R$ 1.234,56" (negativo com sinal: "-R$ 12,50"). */
export function formatarBRL(c: Centavos): string {
  const v = Math.abs(Math.trunc(c));
  const reais = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cent = String(v % 100).padStart(2, "0");
  return `${c < 0 ? "-" : ""}R$ ${reais},${cent}`;
}

/** Soma exata. */
export const somar = (valores: readonly Centavos[]): Centavos => valores.reduce((s, v) => s + Math.trunc(v), 0);

/** Divide em N parcelas que somam exatamente o total (o resto vai nas primeiras). */
export function parcelar(total: Centavos, n: number): Centavos[] {
  const partes = Math.max(Math.trunc(n), 1);
  const base = Math.trunc(total / partes);
  let resto = total - base * partes;
  return Array.from({ length: partes }, () => {
    const extra = resto > 0 ? 1 : resto < 0 ? -1 : 0;
    resto -= extra;
    return base + extra;
  });
}
