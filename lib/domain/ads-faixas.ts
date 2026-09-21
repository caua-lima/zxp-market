/**
 * Filtros de faixa da tabela de Ads (ROAS, ACOS/TACOS, investimento).
 *
 * Cada faixa é um par mínimo/máximo digitado como texto. Este módulo decide o
 * que o par significa — vazio, inválido, invertido — e como dizê-lo, pra que a
 * tela nunca fique calada quando um filtro esconde tudo.
 *
 * ─── O QUE FALTAVA ──────────────────────────────────────────────────────
 *
 * Os campos eram "mín." e "máx." soltos, separados do nome da faixa por um
 * texto sem associação: o leitor de tela dizia "campo numérico, mín." vinte
 * vezes seguidas. E mínimo maior que máximo zerava a tabela sem nenhum aviso —
 * parecia que a conta não tinha anúncio, e era o filtro.
 */

export type Faixa = { min: string; max: string };

function numero(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A faixa está preenchida em algum lado? */
export function faixaAtiva(f: Faixa): boolean {
  return numero(f.min) != null || numero(f.max) != null;
}

/** Mínimo maior que o máximo: nenhum valor passa por essa faixa. */
export function faixaInvertida(f: Faixa): boolean {
  const a = numero(f.min);
  const b = numero(f.max);
  return a != null && b != null && a > b;
}

/**
 * A faixa em português, com a unidade: "ROAS de 2 a 5x", "Investido a partir de
 * R$ 100". Vazio quando a faixa não está ativa.
 */
export function resumoDaFaixa(nome: string, f: Faixa, unidade: { antes?: string; depois?: string }): string {
  const a = numero(f.min);
  const b = numero(f.max);
  const u = (n: number) => `${unidade.antes ?? ""}${String(n).replace(".", ",")}${unidade.depois ?? ""}`;
  if (a != null && b != null) return `${nome} de ${u(a)} a ${u(b)}`;
  if (a != null) return `${nome} a partir de ${u(a)}`;
  if (b != null) return `${nome} até ${u(b)}`;
  return "";
}
