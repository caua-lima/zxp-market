/**
 * Meta do dia — quanto precisa vender HOJE pra chegar na meta do mês.
 *
 * ─── POR QUE ISTO EXISTE COMO MÓDULO ────────────────────────────────────
 *
 * O cálculo estava copiado em dois lugares (Dashboard e MetasTab), e as duas
 * cópias tinham o MESMO bug: usavam `meta1` fixo em vez da meta vigente. Com
 * a Meta 1 já batida, "o que falta" dava zero e o painel anunciava "meta do
 * mês batida" com 100% — enquanto a Meta 3, que era a ativa, estava em 87%.
 *
 * Duas cópias de uma regra divergem na primeira correção; uma delas ficaria
 * certa e a outra continuaria mentindo. Por isso vira função única e testada.
 *
 * ─── POR QUE A META VIGENTE, E NÃO A PRIMEIRA ───────────────────────────
 *
 * Meta 1/2/3 são degraus: quando o faturamento passa da 1, o alvo real vira a
 * 2, e assim por diante (ver selectActiveGoal em gauge.ts). A meta do dia tem
 * que perseguir o degrau em que se está — senão ela zera assim que o primeiro
 * é batido e para de orientar o resto do mês inteiro.
 *
 * ─── POR QUE O ACUMULADO ATÉ ONTEM ──────────────────────────────────────
 *
 * O alvo do dia usa o faturamento até ONTEM. Se usasse o de hoje, cada venda
 * que entrasse reduziria o próprio alvo — a meta fugiria da medição e o
 * ponteiro nunca sairia do lugar.
 */

export type EntradaMetaDiaria = {
  /** Meta vigente do mês (1, 2 ou 3) — ver selectActiveGoal. */
  metaAtiva: number;
  /** Faturamento acumulado do mês, incluindo hoje. */
  faturamentoMes: number;
  /** Faturamento só de hoje — descontado pra usar o acumulado até ontem. */
  faturamentoHoje: number;
  /** Dias que faltam no mês, hoje incluso. null = período não é o mês atual. */
  diasRestantes: number | null;
  /** Total de dias do mês — base da meta plana. */
  diasNoMes: number;
};

export type MetaDiaria = {
  /**
   * O alvo de hoje. 0 = a meta do mês já foi batida (nada mais a fazer).
   * null = não há meta configurada.
   */
  diaria: number | null;
  /** Meta do mês ÷ dias do mês — a referência de "ritmo plano". */
  plana: number | null;
};

export function calcularMetaDiaria(e: EntradaMetaDiaria): MetaDiaria {
  if (!(e.metaAtiva > 0) || !(e.diasNoMes > 0)) return { diaria: null, plana: null };

  const plana = e.metaAtiva / e.diasNoMes;

  // Período que não é o mês corrente não tem "hoje" pra perseguir: a única
  // leitura honesta é o ritmo plano.
  if (e.diasRestantes == null || e.diasRestantes <= 0) return { diaria: plana, plana };

  const ateOntem = Math.max(e.faturamentoMes - e.faturamentoHoje, 0);
  const falta = Math.max(e.metaAtiva - ateOntem, 0);
  return { diaria: falta / e.diasRestantes, plana };
}

/**
 * Quanto deveria ter vendido até hoje pra estar no ritmo da meta vigente.
 * É a linha "Ideal até hoje" — e usa a mesma meta ativa, pelo mesmo motivo.
 */
export function idealAteHoje(metaAtiva: number, diaAtual: number, diasNoMes: number): number {
  if (!(metaAtiva > 0) || !(diasNoMes > 0)) return 0;
  const dia = Math.min(Math.max(diaAtual, 0), diasNoMes);
  return (metaAtiva / diasNoMes) * dia;
}
