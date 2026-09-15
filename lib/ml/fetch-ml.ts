import { decidirRetry, TIMEOUT_MS } from "@/lib/domain/retry-http";

/**
 * `fetch` para o Mercado Livre, com timeout e repetição limitada.
 *
 * ─── POR QUE ISTO PRECISOU EXISTIR ──────────────────────────────────────
 *
 * Havia 28 chamadas ao ML espalhadas pelo app, e nenhuma com timeout. Uma
 * conexão que não responde fica pendurada até a plataforma matar a função — e
 * o sync dispara oito chamadas em paralelo, então bastam algumas travadas pra
 * consumir todo o orçamento de execução e derrubar a rodada, levando junto
 * tudo que já tinha sido lido.
 *
 * Também não havia repetição: um 503 momentâneo do ML, que dura segundos,
 * fazia a etapa falhar como se fosse erro definitivo.
 *
 * ─── O QUE ESTA FUNÇÃO NÃO FAZ ──────────────────────────────────────────
 *
 * Não decide nada. Quem decide é `decidirRetry` (lib/domain/retry-http), que é
 * puro e testado. Aqui só há o laço, a espera e o `AbortSignal` — a mecânica.
 *
 * E não engole erro: esgotadas as tentativas, a última resposta (ou a última
 * exceção) volta pra quem chamou. Transformar falha em resposta vazia é
 * exatamente o problema que o SYNC-06 corrigiu.
 */
export async function fetchML(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; maxTentativas?: number } = {},
): Promise<Response> {
  const timeout = opts.timeoutMs ?? TIMEOUT_MS;
  let tentativa = 1;
  let ultimoErro: unknown = null;

  for (;;) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        ...init,
        // Um sinal NOVO por tentativa: reaproveitar um já abortado faria a
        // repetição falhar na hora, sem nem sair.
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      // Timeout estourado ou rede caída — os dois chegam aqui.
      ultimoErro = err;
    }

    const decisao = decidirRetry({
      status: res ? res.status : null,
      tentativa,
      maxTentativas: opts.maxTentativas,
      retryAfter: res?.headers.get("retry-after") ?? null,
    });

    if (!decisao.repetir) {
      if (res) return res;
      // Sem resposta e sem tentativas: o erro sobe. Quem chama trata — e
      // agora sabe que foi falha, não "nada encontrado".
      throw ultimoErro ?? new Error("falha ao chamar o Mercado Livre");
    }

    await new Promise((r) => setTimeout(r, decisao.esperarMs));
    tentativa = decisao.tentativa;
  }
}
