/**
 * Custo de uma compra a partir do preço de tabela e do desconto.
 *
 * O fornecedor passa o preço de lista e diz "12% de desconto"; o custo que
 * importa pro estoque é o que sobra depois do desconto. Digitar o preço, as
 * unidades e o desconto e deixar a conta com o app tira a calculadora do meio —
 * e o erro de digitação junto (14,50 × 0,88 feito de cabeça vira 12,67).
 *
 *   custo unitário = preço original × (1 − desconto ÷ 100)
 *   total da compra = custo unitário × unidades
 *
 * Arredonda a 4 casas (a mesma precisão do custo médio), só pra tirar o ruído do
 * ponto flutuante: 14,5 × 0,88 dá 12,760000000000002 sem isso.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type CompraComDesconto = {
  /** Preço de tabela por unidade, antes do desconto. */
  precoOriginal: number;
  /** Desconto em % (0 a menos de 100). Ausente = sem desconto. */
  descontoPct?: number | null;
  unidades: number;
};

export type ResultadoDaCompra =
  | {
      ok: true;
      custoUnitario: number;
      /** Quanto cada unidade ficou mais barata (R$). */
      economiaPorUnidade: number;
      total: number;
      /** O que a compra custaria sem o desconto. */
      totalSemDesconto: number;
    }
  | { ok: false; motivo: string };

const arred4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** O desconto aceito: de 0 até menos de 100. Vazio conta como zero. */
export function descontoValido(d: number | null | undefined): boolean {
  if (d == null) return true;
  return Number.isFinite(d) && d >= 0 && d < 100;
}

/** Custo unitário depois do desconto. `NaN` quando o preço ou o desconto não servem. */
export function custoComDesconto(precoOriginal: number, descontoPct?: number | null): number {
  if (!Number.isFinite(precoOriginal) || precoOriginal < 0 || !descontoValido(descontoPct)) return NaN;
  return arred4(precoOriginal * (1 - (descontoPct ?? 0) / 100));
}

export function calcularCompra(c: CompraComDesconto): ResultadoDaCompra {
  if (!Number.isFinite(c.precoOriginal) || c.precoOriginal <= 0) return { ok: false, motivo: "Informe o preço original." };
  if (!descontoValido(c.descontoPct)) return { ok: false, motivo: "O desconto precisa estar entre 0% e 99,99%." };
  if (!Number.isFinite(c.unidades) || c.unidades <= 0) return { ok: false, motivo: "Informe a quantidade de unidades." };
  const custoUnitario = custoComDesconto(c.precoOriginal, c.descontoPct);
  return {
    ok: true,
    custoUnitario,
    economiaPorUnidade: arred4(c.precoOriginal - custoUnitario),
    total: arred4(custoUnitario * c.unidades),
    totalSemDesconto: arred4(c.precoOriginal * c.unidades),
  };
}
