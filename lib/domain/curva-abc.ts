/**
 * Curva ABC (Pareto) — a classificação, num lugar só, pra as duas curvas do
 * Dashboard (vendas brutas e lucro) não terem regras diferentes.
 *
 *   A = os itens que, somados, chegam a 80% do total
 *   B = os que levam de 80% a 95%
 *   C = o resto (a "cauda")
 *
 * ─── A CONVENÇÃO DO CORTE ───────────────────────────────────────────────
 *
 * O item que FAZ o acumulado cruzar o corte entra na classe de CIMA: ele é
 * necessário pra chegar nos 80%, então é um item A. Medir pelo acumulado
 * DEPOIS dele (como a curva de lucro fazia: `acumulado <= 80 → A`) joga pra B o
 * item que sozinho vale 90% do total — o maior vendedor virava "B". Aqui
 * decide o acumulado ANTES do item: `antes < 80 → A`, `antes < 95 → B`.
 *
 * Itens sem valor (zero) e, se pedido, negativos (prejuízo) ficam em C: não
 * puxam nada, e prejuízo não pode ser "A" só por estar no topo de uma lista.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type ClasseABC = "A" | "B" | "C";

export const CORTE_A = 80;
export const CORTE_B = 95;

export type LinhaABC<T> = {
  item: T;
  valor: number;
  /** % do total que este item representa. */
  share: number;
  /** % acumulado até este item, inclusive. */
  acumulado: number;
  classe: ClasseABC;
};

export type ResumoDaClasse = { itens: number; valor: number; share: number };
export type ResumoABC = Record<ClasseABC, ResumoDaClasse>;

const FOLGA = 1e-9; // soma de decimais: 79,99999999 não pode contar como "antes de 80"

export function classificarABC<T>(
  itens: readonly T[],
  valorDe: (t: T) => number,
): { linhas: LinhaABC<T>[]; total: number; resumo: ResumoABC } {
  const base = itens
    .map((item, i) => ({ item, i, valor: Number(valorDe(item)) || 0 }))
    // Maior primeiro; empate mantém a ordem de entrada (a curva não pode dançar entre leituras).
    .sort((a, b) => b.valor - a.valor || a.i - b.i);

  const total = base.reduce((s, x) => s + Math.max(x.valor, 0), 0);
  const resumo: ResumoABC = {
    A: { itens: 0, valor: 0, share: 0 },
    B: { itens: 0, valor: 0, share: 0 },
    C: { itens: 0, valor: 0, share: 0 },
  };

  let correndo = 0;
  const linhas: LinhaABC<T>[] = base.map(({ item, valor }) => {
    const positivo = Math.max(valor, 0);
    const antes = total > 0 ? (correndo / total) * 100 : 100;
    correndo += positivo;
    const acumulado = total > 0 ? Math.min((correndo / total) * 100, 100) : 0;
    const share = total > 0 ? (positivo / total) * 100 : 0;

    const classe: ClasseABC =
      valor <= 0 ? "C"
      : antes < CORTE_A - FOLGA ? "A"
      : antes < CORTE_B - FOLGA ? "B"
      : "C";

    resumo[classe].itens += 1;
    resumo[classe].valor += positivo;
    return { item, valor, share, acumulado, classe };
  });

  for (const c of ["A", "B", "C"] as const) {
    resumo[c].share = total > 0 ? (resumo[c].valor / total) * 100 : 0;
  }
  return { linhas, total, resumo };
}
