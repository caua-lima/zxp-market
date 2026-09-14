/**
 * Quantas vezes um custo MENSAL entra num período.
 *
 * ─── O BUG QUE ISTO CORRIGE ─────────────────────────────────────────────
 *
 * A rota de métricas decidia assim:
 *
 *   const isFullMonth = fy === ty && fm === tm && fd === 1 && td === ultimoDia;
 *   const monthsInPeriod = (ty - fy) * 12 + (tm - fm) + 1;
 *   if (isFullMonth) noPeriodo = valor * monthsInPeriod;
 *
 * `isFullMonth` exige `fy === ty && fm === tm` — o mesmo mês. Então num
 * intervalo de 01/07 a 31/08, dois meses INTEIROS, ele é falso e o custo
 * mensal entrava como ZERO. E `monthsInPeriod`, que existia justamente pra
 * contar vários meses, só era lido no ramo onde ele sempre vale 1.
 *
 * O efeito: qualquer DRE de mais de um mês perdia pró-labore, contador,
 * aluguel e sistema — e o resultado saía otimista, que é o oposto do que a
 * DRE existe pra mostrar.
 *
 * ─── A REGRA, E POR QUE ESTA ────────────────────────────────────────────
 *
 * Um custo mensal pertence a um MÊS. Ele entra uma vez por mês inteiramente
 * contido no período, e não entra em mês coberto pela metade.
 *
 * A alternativa seria ratear por dias (meio mês = meio custo). Foi recusada
 * de propósito: o bloco "Vendas do Dia" pede as métricas de UM dia, e o rateio
 * faria 1/30 do aluguel aparecer no lucro de hoje. A decisão de manter custo
 * mensal fora do dia a dia já existia e está correta — o que faltava era
 * contar mais de um mês, não fatiar o mês.
 */

/** yyyy-mm-dd → [ano, mês] (mês 1-12). `null` se não for uma data válida. */
function partes(iso: string): [number, number, number] | null {
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return [ano, mes, dia];
}

/** Quantos dias tem o mês (1-12) do ano dado. */
export function diasDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Quantos meses de calendário estão INTEIRAMENTE dentro do período.
 *
 * "Inteiramente" = o período cobre do dia 1º ao último dia daquele mês.
 *
 *   01/09 a 30/09  → 1   (setembro inteiro)
 *   01/07 a 31/08  → 2   (julho e agosto)
 *   01/09 a 15/09  → 0   (setembro pela metade)
 *   15/07 a 31/08  → 1   (só agosto; julho começou no dia 15)
 *   01/12 a 31/01  → 2   (vira o ano)
 *
 * @param from yyyy-mm-dd inclusive
 * @param to   yyyy-mm-dd inclusive
 */
export function mesesCompletosNoPeriodo(from: string, to: string): number {
  const a = partes(from);
  const b = partes(to);
  if (!a || !b) return 0;

  const [anoDe, mesDe, diaDe] = a;
  const [anoAte, mesAte, diaAte] = b;

  // Período invertido não conta nada — e não vira número negativo.
  if (anoDe > anoAte || (anoDe === anoAte && mesDe > mesAte)) return 0;
  if (anoDe === anoAte && mesDe === mesAte && diaDe > diaAte) return 0;

  let total = 0;
  let ano = anoDe;
  let mes = mesDe;

  // Caminha mês a mês; no máximo alguns anos de período, então o laço é curto.
  while (ano < anoAte || (ano === anoAte && mes <= mesAte)) {
    const comecaNoPrimeiro = ano > anoDe || mes > mesDe || diaDe === 1;
    const terminaNoUltimo = ano < anoAte || mes < mesAte || diaAte >= diasDoMes(ano, mes);
    if (comecaNoPrimeiro && terminaNoUltimo) total += 1;

    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }

  return total;
}

/**
 * Quanto um custo MENSAL contribui num período.
 *
 * Separado de `mesesCompletosNoPeriodo` pra o chamador não precisar repetir a
 * multiplicação — e pra o nome dizer o que a conta significa.
 */
export function custoMensalNoPeriodo(valor: number, from: string, to: string): number {
  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v * mesesCompletosNoPeriodo(from, to);
}
