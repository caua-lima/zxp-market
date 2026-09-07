/**
 * Qual dia o bloco "Vendas do Dia" mostra, dado o período selecionado.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * O Dashboard tem dois recortes na mesma tela: os cards do PERÍODO (o que o
 * seletor de datas escolhe) e o bloco do DIA. O bloco do dia sempre mostrou o
 * dia corrente, calculado do relógio, ignorando o período.
 *
 * Enquanto o período era "mês atual" ninguém percebia — hoje está dentro do
 * mês. Filtrando "Ontem", a tela passava a dizer duas coisas ao mesmo tempo:
 * os cards de cima com ontem, e o bloco do dia com hoje, os dois sem etiqueta
 * de data. Quem filtrou ontem lia os números de hoje achando que eram de
 * ontem.
 *
 * A rota já aceitava `dia=` pra isso (ver app/api/ml/metrics/route.ts) — foi
 * criada exatamente pra corrigir a MESMA confusão na comparação "vs ontem".
 * O Dashboard só nunca passou o parâmetro na busca principal.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────
 *
 * O dia em foco é HOJE, limitado ao período. Isto é, `hoje` grudado dentro do
 * intervalo:
 *
 *   · período contém hoje  → hoje         (mês atual: nada muda)
 *   · período já terminou  → o último dia (Ontem → ontem; mês fechado → dia 31)
 *   · período ainda não começou → o primeiro dia
 *
 * A comparação anda junto: é sempre a véspera do dia em foco. Fixá-la em
 * "ontem do relógio" faria o filtro "Ontem" comparar ontem consigo mesmo e
 * mostrar 0% em tudo — que foi literalmente o bug corrigido antes, voltando
 * pela outra ponta.
 */

export type DiaEmFoco = {
  /** O dia que o bloco mostra, yyyy-mm-dd. */
  dia: string;
  /** A véspera dele — a base do "vs ontem". */
  comparacao: string;
  /**
   * `dia` é o dia corrente. Decide se o rótulo pode dizer "Hoje": chamar de
   * "hoje" um dia que não é hoje foi a origem do problema.
   */
  ehHoje: boolean;
};

/** Um dia antes, em yyyy-mm-dd. UTC de propósito: sem hora, não há fuso a errar. */
export function diaAnterior(iso: string): string {
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function diaEmFoco(from: string, to: string, hojeISO: string): DiaEmFoco {
  const f = String(from).slice(0, 10);
  const t = String(to).slice(0, 10);
  const hoje = String(hojeISO).slice(0, 10);

  /**
   * Período incompleto (a tela monta antes de ter as datas) cai em hoje — o
   * mesmo que a tela fazia antes, e o único palpite defensável sem intervalo.
   */
  let dia = hoje;
  if (f && t) {
    // Intervalo invertido não é motivo pra número errado: ordena e segue.
    const ini = f <= t ? f : t;
    const fim = f <= t ? t : f;
    dia = hoje < ini ? ini : hoje > fim ? fim : hoje;
  }

  return { dia, comparacao: diaAnterior(dia), ehHoje: dia === hoje };
}

/**
 * Como chamar o dia em foco na tela.
 *
 * "Hoje" só quando é hoje; "Ontem" quando é a véspera — as duas palavras que
 * o vendedor usa. Qualquer outro dia vira a data, porque nenhuma palavra o
 * descreve e um rótulo genérico devolveria a ambiguidade que a correção veio
 * tirar.
 */
export function rotuloDoDia(dia: string, hojeISO: string): string {
  if (dia === hojeISO) return "Hoje";
  if (dia === diaAnterior(hojeISO)) return "Ontem";
  const m = String(dia).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : dia;
}
