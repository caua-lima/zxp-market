/**
 * "Onde eu deveria estar hoje" — o ritmo do mês contra a meta.
 *
 * Duas leituras do mesmo número, lado a lado no Dashboard:
 *
 *   · META DO MÊS: quanto do total já foi (R$ 294.804 de R$ 400.000 = 74%).
 *   · META DIÁRIA ACUMULADA: o que a meta pedia até HOJE, dia por dia
 *     (meta ÷ dias do mês × dia de hoje), e quanto se está acima ou abaixo disso
 *     (R$ 294.804 de R$ 238.609 = 124%).
 *
 * A segunda é a que responde "estou no ritmo?". 74% da meta no dia 18 de um mês
 * de 31 é ÓTIMO (o esperado era 58%); 74% no dia 30 é ruim. Sem a régua do dia,
 * o mesmo número diz coisas opostas.
 *
 * O dia vem travado dentro do mês, como em idealAteHoje (lib/domain/meta-diaria.ts).
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type RitmoDaMeta = {
  /** Faturamento do mês até agora ÷ meta do mês, em %. Pode passar de 100. */
  pctMeta: number;
  /** Quanto a meta pedia até hoje (meta ÷ dias × dia de hoje). */
  idealHoje: number;
  /** Faturamento ÷ ideal de hoje, em %. 100 = exatamente no ritmo. */
  pctIdeal: number;
  /** Faturamento − ideal de hoje. Positivo = à frente do ritmo. */
  diferenca: number;
  noRitmo: boolean;
  /** Onde o "ideal de hoje" cai na barra da meta do mês (0–100) — a marquinha. */
  marcoIdealPct: number;
  /** Quanto falta pra meta do mês (0 se já bateu). */
  faltaMeta: number;
  /** Quanto precisa vender por dia, do dia de hoje (incluído) ao fim do mês, pra bater a meta. */
  porDiaParaBater: number;
};

export function calcularRitmoDaMeta(e: {
  faturamento: number;
  meta: number;
  diaAtual: number;
  diasNoMes: number;
}): RitmoDaMeta | null {
  if (!(e.meta > 0) || !(e.diasNoMes > 0)) return null;
  const fat = Math.max(Number(e.faturamento) || 0, 0);
  const dia = Math.min(Math.max(Math.floor(e.diaAtual), 0), e.diasNoMes);
  const idealHoje = (e.meta / e.diasNoMes) * dia;
  const faltaMeta = Math.max(e.meta - fat, 0);
  const diasRestantes = Math.max(e.diasNoMes - dia + 1, 1);
  return {
    pctMeta: (fat / e.meta) * 100,
    idealHoje,
    // Dia zero (antes do mês começar): o ideal é zero, e qualquer venda já está "no ritmo".
    pctIdeal: idealHoje > 0 ? (fat / idealHoje) * 100 : fat > 0 ? 100 : 0,
    diferenca: fat - idealHoje,
    noRitmo: fat >= idealHoje,
    marcoIdealPct: Math.min((idealHoje / e.meta) * 100, 100),
    faltaMeta,
    porDiaParaBater: faltaMeta / diasRestantes,
  };
}

/** Largura da barra: entre 0 e 100, mesmo quando o número passa da meta. */
export function preenchimento(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(pct, 100);
}
