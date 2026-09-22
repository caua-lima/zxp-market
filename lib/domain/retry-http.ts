/**
 * Quando repetir uma chamada, quanto esperar, e quando desistir.
 *
 * ─── O QUE NÃO EXISTIA ──────────────────────────────────────────────────
 *
 * Vinte e oito chamadas ao Mercado Livre espalhadas pelo app, e nenhuma com
 * timeout. Uma conexão que não responde fica pendurada até a plataforma matar
 * a função inteira — e como o sync usa um pool de oito chamadas paralelas,
 * bastam algumas travadas pra consumir todo o orçamento de execução e derrubar
 * a rodada, perdendo junto tudo que já tinha sido lido.
 *
 * Também não havia repetição. Um 503 momentâneo do ML — que dura segundos —
 * fazia a etapa falhar como se fosse erro definitivo.
 *
 * ─── O QUE SE REPETE, E O QUE NÃO ───────────────────────────────────────
 *
 * Repetir erro de cliente é inútil e caro: 400, 401, 403, 404 não mudam de
 * resposta por insistência. O único 4xx que se repete é o 429, que É um pedido
 * explícito pra tentar de novo mais tarde.
 *
 * Os 5xx e as falhas de rede, sim: são transitórios por definição.
 *
 * ─── RESPEITAR O RETRY-AFTER ────────────────────────────────────────────
 *
 * Quando o servidor diz quanto esperar, esperar menos é insistir contra um
 * limite que ele acabou de comunicar — o caminho mais rápido pra um bloqueio
 * mais longo. O cabeçalho manda; a espera calculada é só o padrão de quando
 * ele não vem.
 *
 * Isso tem um limite: a função também tem um orçamento de execução. Cortar o
 * Retry-After pra caber nesse orçamento e repetir mesmo assim — o
 * comportamento antigo — é exatamente o "esperar menos e insistir" que a
 * regra acima proíbe. A saída correta quando o pedido do servidor não cabe é
 * NÃO repetir agora: devolve `espera_excede_orcamento` com o valor pedido, e
 * quem chama larga essa tentativa pro próximo gatilho externo (webhook
 * seguinte, cron, worker do outbox) — não pra silêncio.
 */

/** Status que vale repetir. 429 entra porque é um "tente depois" explícito. */
const REPETIVEIS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type DecisaoRetry =
  | { repetir: true; esperarMs: number; tentativa: number }
  | { repetir: false; motivo: "sucesso" | "erro_definitivo" | "sem_tentativas" }
  | { repetir: false; motivo: "espera_excede_orcamento"; esperaPedidaMs: number };

/** Timeout por chamada. Curto o bastante pra sobrar orçamento pro resto da rodada. */
export const TIMEOUT_MS = 12_000;

/** Tentativas TOTAIS, incluindo a primeira. Três cobre indisponibilidade curta. */
export const MAX_TENTATIVAS = 3;

/** Teto da espera CALCULADA (sem Retry-After do servidor). */
export const ESPERA_MAXIMA_MS = 8_000;

/**
 * Acima disto, esperar DENTRO da chamada consumiria orçamento demais da
 * função (webhook e cron têm `maxDuration` curto). Um Retry-After maior que
 * isto não é encurtado — é motivo pra desistir desta tentativa e deixar o
 * próximo gatilho externo repetir depois, com a espera de verdade já correndo
 * do lado do ML, não do nosso processo.
 */
export const ORCAMENTO_MAXIMO_ESPERA_MS = 15_000;

export function statusEhRepetivel(status: number): boolean {
  return REPETIVEIS.has(Number(status));
}

/**
 * Lê o `Retry-After`. Aceita as duas formas do cabeçalho: segundos, ou uma
 * data HTTP.
 *
 * @returns ms de espera, ou `null` quando o cabeçalho não veio ou não faz
 *   sentido — e aí quem chama usa a espera calculada.
 */
export function lerRetryAfter(valor: string | null | undefined, agora: number): number | null {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return null;

  // Forma 1: segundos.
  if (/^\d+$/.test(bruto)) {
    const ms = Number(bruto) * 1000;
    return ms >= 0 ? ms : null;
  }

  // Forma 2: data HTTP.
  const quando = Date.parse(bruto);
  if (!Number.isFinite(quando)) return null;
  const espera = quando - agora;
  // Data no passado significa "pode agora".
  return espera > 0 ? espera : 0;
}

/**
 * Espera com recuo exponencial e ruído.
 *
 * O ruído (jitter) existe porque o sync dispara oito chamadas em paralelo: sem
 * ele, as oito falhariam juntas e voltariam juntas, batendo no mesmo limite de
 * novo — um comboio que se auto-perpetua.
 *
 * @param aleatorio injetável pra o teste não depender de Math.random.
 */
export function esperaDoRecuo(tentativa: number, aleatorio = Math.random): number {
  const base = Math.min(500 * 2 ** Math.max(0, tentativa - 1), ESPERA_MAXIMA_MS);
  const ruido = base * 0.25 * aleatorio();
  return Math.round(Math.min(base + ruido, ESPERA_MAXIMA_MS));
}

/**
 * O que fazer depois de uma resposta (ou de uma falha de rede).
 *
 * @param status HTTP recebido, ou `null` quando a chamada nem chegou a
 *   responder (rede caiu, timeout estourou).
 */
export function decidirRetry(args: {
  status: number | null;
  tentativa: number;
  maxTentativas?: number;
  retryAfter?: string | null;
  agora?: number;
  aleatorio?: () => number;
}): DecisaoRetry {
  const max = args.maxTentativas ?? MAX_TENTATIVAS;
  const agora = args.agora ?? Date.now();

  if (args.status != null && args.status >= 200 && args.status < 300) {
    return { repetir: false, motivo: "sucesso" };
  }

  // Sem status = rede caiu ou o timeout estourou. Transitório por definição.
  const transitorio = args.status == null || statusEhRepetivel(args.status);
  if (!transitorio) return { repetir: false, motivo: "erro_definitivo" };

  if (args.tentativa >= max) return { repetir: false, motivo: "sem_tentativas" };

  // O cabeçalho manda sobre a conta: esperar menos do que o servidor pediu é
  // insistir contra um limite que ele acabou de comunicar. Se o pedido não
  // cabe no orçamento da função, a resposta é desistir agora — não cortar a
  // espera e insistir do mesmo jeito.
  const doServidor = lerRetryAfter(args.retryAfter, agora);
  if (doServidor != null && doServidor > ORCAMENTO_MAXIMO_ESPERA_MS) {
    return { repetir: false, motivo: "espera_excede_orcamento", esperaPedidaMs: doServidor };
  }
  const esperarMs = doServidor ?? esperaDoRecuo(args.tentativa, args.aleatorio);

  return { repetir: true, esperarMs, tentativa: args.tentativa + 1 };
}
