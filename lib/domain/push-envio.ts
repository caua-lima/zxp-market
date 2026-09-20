/**
 * O que o servidor precisa saber pra falar com o FCM sem desperdiçar aviso:
 * quebrar em lotes, dar validade à mensagem e ler o que cada resposta quer dizer.
 */

/** O `sendEachForMulticast` aceita no máximo 500 tokens por chamada. */
export const MAX_TOKENS_POR_LOTE = 500;

/**
 * Quebra a lista em lotes de até `tamanho`. O envio antigo mandava tudo de uma
 * vez: com 501 aparelhos a chamada inteira era recusada e NINGUÉM recebia — o
 * time crescer virava, de um dia pro outro, o fim das notificações.
 */
export function dividirEmLotes<T>(itens: readonly T[], tamanho = MAX_TOKENS_POR_LOTE): T[][] {
  if (tamanho < 1) throw new Error("tamanho do lote precisa ser >= 1");
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * A validade da mensagem NO PROVEDOR, em segundos, a partir do que resta da
 * validade do aviso.
 *
 * Sem TTL, o Web Push guarda a mensagem por até quatro semanas: o celular que
 * ficou desligado o fim de semana inteiro mostrava, na segunda de manhã, as
 * vendas de sexta como se fossem novas. O TTL faz o provedor DESCARTAR o que
 * já não vale — e o que resta da validade, não a validade cheia, porque um
 * retry feito na quinta hora não pode ganhar seis horas novas.
 */
export function ttlSegundos(agora: number, expiraEm: number): number {
  return Math.max(0, Math.floor((expiraEm - agora) / 1000));
}

export type ClasseDoErro = "token_invalido" | "permanente" | "transitorio";

/**
 * Erros que dizem "esta mensagem, do jeito que está, não passa": repetir dá o
 * mesmo resultado. Tudo o que não está aqui é tratado como transitório — o
 * teto de tentativas, e não a suposição, é o que encerra o retry.
 */
const PERMANENTES = new Set([
  "messaging/invalid-argument",
  "messaging/invalid-recipient",
  "messaging/invalid-payload",
  "messaging/invalid-data-payload-key",
  "messaging/payload-size-limit-exceeded",
  "messaging/invalid-options",
]);

const TOKEN_MORTO = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/** Traduz o código de erro do FCM pra o que o worker faz a seguir. */
export function classificarErroFcm(codigo: string | undefined | null): ClasseDoErro {
  if (!codigo) return "transitorio";
  if (TOKEN_MORTO.has(codigo)) return "token_invalido";
  if (PERMANENTES.has(codigo)) return "permanente";
  // server-unavailable, internal-error, quota-exceeded, message-rate-exceeded,
  // device-message-rate-exceeded, unknown-error, authentication-error…
  return "transitorio";
}

export type RespostaDeEnvio = { success: boolean; messageId?: string; error?: { code?: string } };

/**
 * Casa a resposta do lote com cada token — POR POSIÇÃO, e conferindo que o
 * tamanho bate. A API devolve `responses[i]` para `tokens[i]`; se o número de
 * respostas não for o de tokens, o mapeamento não é confiável e NENHUM
 * destino pode ser dado como aceito.
 */
export function mapearRespostas<T>(
  destinos: readonly T[],
  respostas: readonly RespostaDeEnvio[],
): { destino: T; classe: "aceito" | ClasseDoErro; codigo?: string; messageId?: string }[] {
  if (respostas.length !== destinos.length) {
    return destinos.map((destino) => ({ destino, classe: "transitorio" as const, codigo: "resposta_incompleta" }));
  }
  return destinos.map((destino, i) => {
    const r = respostas[i];
    if (r.success) return { destino, classe: "aceito" as const, messageId: r.messageId };
    return { destino, classe: classificarErroFcm(r.error?.code), codigo: r.error?.code ?? "desconhecido" };
  });
}
