import { diasDoMes, mesesCompletosNoPeriodo } from "@/lib/domain/competencia";

/**
 * Desde quando, e até quando, uma despesa conta.
 *
 * ─── O QUE ACONTECIA ────────────────────────────────────────────────────
 *
 * Os dois comentários do próprio código diziam coisas opostas:
 *
 *   lib/domain/types.ts
 *     "false = arquivado (some das listas ativas, mas CONTINUA CONTANDO no
 *      histórico — nunca apagado por engano)"
 *
 *   app/api/ml/metrics/route.ts
 *     "Arquivado (ativo:false) PARA DE CONTAR"
 *     if (d.ativo === false) continue;
 *
 * Quem estava certo era o segundo — o código. Arquivar o contador hoje
 * removia a despesa de TODOS os meses passados: a DRE de meses fechados
 * mudava sozinha, e o lucro histórico subia.
 *
 * O mesmo vale pra edição. O custo guarda um `valor` único e nada mais:
 * corrigir o aluguel de R$ 2.000 pra R$ 2.500 hoje reescreve todo mês
 * anterior com R$ 2.500. O passado nunca teve esse valor.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────
 *
 * Uma despesa vale num intervalo: de `vigenteDe` até `vigenteAte`. Arquivar
 * é FECHAR a vigência na data de hoje — a despesa para de contar daqui pra
 * frente e continua contando no que já passou, que é exatamente o que o
 * comentário prometia.
 *
 * Mudar o valor "daqui pra frente" é fechar a vigência da versão atual e
 * abrir outra a partir do dia seguinte. Assim os dois valores coexistem, cada
 * um no seu período, e nenhum reescreve o outro.
 *
 * Corrigir um lançamento anterior — porque o valor estava errado desde
 * sempre — é editar a versão existente, e aí a mudança é retroativa de
 * propósito. A diferença entre as duas intenções é de quem edita, e a tela
 * precisa perguntar; o que não pode é ter uma só e agir como se fosse a outra.
 */

export type CustoComVigencia = {
  valor?: unknown;
  freq?: unknown;
  /** Data do lançamento — também é o início padrão da vigência. */
  data?: unknown;
  /** Primeiro dia em que a despesa conta. Ausente = cai em `data`. */
  vigenteDe?: unknown;
  /** Último dia em que a despesa conta. Ausente/null = ainda vigente. */
  vigenteAte?: unknown;
  /** Compatibilidade: arquivado sem data de fim. Ver `janelaDeVigencia`. */
  ativo?: unknown;
};

/** Um intervalo fechado de datas, ou `null` quando não há interseção. */
export type Janela = { de: string; ate: string } | null;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Bem no passado/futuro — evita casos especiais de "sem início"/"sem fim". */
const SEMPRE_DE = "1970-01-01";
const SEMPRE_ATE = "9999-12-31";

function dia(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return DATA.test(s) ? s : null;
}

/**
 * De quando a quando esta despesa vale.
 *
 * @param hojeISO usado só pro legado: um custo marcado `ativo: false` que
 *   nunca ganhou `vigenteAte` precisa de uma data de corte, e a única
 *   defensável é hoje — assumir uma data passada apagaria meses que a despesa
 *   de fato existiu, que é o bug que isto corrige.
 */
export function janelaDeVigencia(c: CustoComVigencia, hojeISO: string): { de: string; ate: string } {
  const de = dia(c?.vigenteDe) ?? dia(c?.data) ?? SEMPRE_DE;

  const ate = dia(c?.vigenteAte)
    ?? (c?.ativo === false ? (dia(hojeISO) ?? SEMPRE_ATE) : SEMPRE_ATE);

  // Vigência invertida (erro de digitação) vira um único dia, não um buraco.
  return ate < de ? { de, ate: de } : { de, ate };
}

/** A parte do período em que a despesa estava vigente. `null` se não houver. */
export function interseccao(
  periodo: { de: string; ate: string },
  vigencia: { de: string; ate: string },
): Janela {
  const de = periodo.de > vigencia.de ? periodo.de : vigencia.de;
  const ate = periodo.ate < vigencia.ate ? periodo.ate : vigencia.ate;
  return de > ate ? null : { de, ate };
}

/** Datas inclusivas entre dois dias. Zero quando invertido. */
export function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T00:00:00Z`);
  const b = Date.parse(`${ate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Quanto esta despesa contribui num período, respeitando a vigência.
 *
 * @param periodo   o intervalo consultado (o filtro da tela).
 * @param hojeISO   pro legado de `ativo: false` sem data de fim.
 *
 * As três frequências, e por quê:
 *
 *   diario   vezes os dias VIGENTES dentro do período. Antes era o período
 *            inteiro: uma despesa diária encerrada no dia 10 continuava
 *            cobrando até o fim do mês.
 *
 *   mensal   uma vez por mês de calendário inteiramente contido na
 *            interseção. Mantém a regra de competência que já existia
 *            (ver competencia.ts) — só que sobre a janela vigente, não sobre
 *            o período cru.
 *
 *   avulso   só na própria data, e só se ela cair no período. Vigência não se
 *            aplica: um gasto de uma vez não "deixa de valer".
 */
export function contribuicaoNoPeriodo(
  c: CustoComVigencia,
  periodo: { de: string; ate: string },
  hojeISO: string,
): number {
  const valor = Number(c?.valor ?? 0);
  if (!Number.isFinite(valor) || valor <= 0) return 0;

  const freq = String(c?.freq ?? "avulso").toLowerCase();

  if (freq === "avulso" || freq === "once") {
    const d = dia(c?.data);
    return d != null && d >= periodo.de && d <= periodo.ate ? valor : 0;
  }

  const janela = interseccao(periodo, janelaDeVigencia(c, hojeISO));
  if (!janela) return 0;

  if (freq === "diario" || freq === "daily") {
    return valor * diasEntre(janela.de, janela.ate);
  }

  if (freq === "mensal" || freq === "monthly") {
    return valor * mesesCompletosNoPeriodo(janela.de, janela.ate);
  }

  return 0;
}

/**
 * A despesa está vigente HOJE? É isto que decide se ela aparece na lista de
 * ativas — e é uma pergunta sobre o presente, não sobre o histórico.
 */
export function vigenteHoje(c: CustoComVigencia, hojeISO: string): boolean {
  const { de, ate } = janelaDeVigencia(c, hojeISO);
  const hoje = dia(hojeISO) ?? SEMPRE_ATE;
  return hoje >= de && hoje <= ate;
}

/**
 * Fecha a vigência — o que "arquivar" deveria ter feito desde sempre.
 *
 * O último dia vigente é HOJE: a despesa existiu hoje, e cortar ontem
 * apagaria um dia que de fato aconteceu.
 */
export function patchArquivar(hojeISO: string): Record<string, unknown> {
  return { ativo: false, vigenteAte: dia(hojeISO) ?? null };
}

/** Reabre uma despesa encerrada: volta a valer a partir de hoje. */
export function patchReativar(hojeISO: string): Record<string, unknown> {
  return { ativo: true, vigenteAte: null, vigenteDe: dia(hojeISO) ?? null };
}

/**
 * Os campos da NOVA versão, quando o valor muda "daqui pra frente".
 *
 * A versão anterior é fechada em `vigenteAte = ontem` e esta abre hoje. Os
 * dois valores coexistem, cada um no seu período — em vez de o novo reescrever
 * todo o passado.
 */
export function patchNovaVersao(hojeISO: string): {
  fecharAnterior: Record<string, unknown>;
  novaVigencia: Record<string, unknown>;
} {
  const hoje = dia(hojeISO);
  if (!hoje) return { fecharAnterior: {}, novaVigencia: {} };

  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const ontem = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  return {
    fecharAnterior: { vigenteAte: ontem },
    novaVigencia: { vigenteDe: hoje, vigenteAte: null, ativo: true },
  };
}

/** Reexportado por conveniência de quem já importa deste módulo. */
export { diasDoMes };
