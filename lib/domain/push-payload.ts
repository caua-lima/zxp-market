import type { SalePushPayload } from "@/lib/domain/notifications";

/**
 * Serializa o payload normalizado pro formato `data` do FCM — TODOS os
 * valores viram string porque mensagens data-only exigem isso (a API rejeita
 * número/undefined dentro de `data`). Campos ausentes viram string vazia em
 * vez de sumirem, pra quem lê do outro lado (SW, foreground, toast) não
 * precisar tratar "chave ausente" como um caso a mais.
 *
 * É a FRONTEIRA do que sai do servidor: o que não estiver aqui não chega ao
 * aparelho, e por isso o teste de privacidade olha para este resultado — o
 * payload que de fato viaja — e não para o objeto anterior a ele.
 */
export function serializarPayload(payload: SalePushPayload): Record<string, string> {
  return {
    eventId: payload.eventId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    icon: payload.icon ?? "/manifest-icon-192",
    badge: payload.badge ?? "/manifest-icon-192",
    tag: payload.tag,
    orderId: payload.orderId ?? "",
    deepLink: payload.deepLink,
    productName: payload.productName ?? "",
    grossAmount: payload.grossAmount ?? "",
    estimatedProfit: payload.estimatedProfit ?? "",
    estimatedMargin: payload.estimatedMargin ?? "",
    financialState: payload.financialState ?? "",
    itensJson: payload.itensJson ?? "",
    timestamp: payload.timestamp,
  };
}

// ── O orçamento de bytes do payload ─────────────────────────────────────

/**
 * O FCM recusa `data` acima de 4096 bytes. O limite é em BYTES de UTF-8, não em
 * caracteres — e o app escreve em português: "ç", "ã", "é" e todo emoji custam
 * 2 a 4 bytes cada. O código só cortava nomes de item em N *caracteres* e
 * confiava que "cabia", então um pedido com muitos itens de nome acentuado
 * passava no teste em ASCII e era recusado em produção, com o aviso perdido.
 *
 * O orçamento é MENOR que o limite: o corte é feito sobre a nossa estimativa
 * (chaves, valores e a pontuação do JSON), e o link, o TTL e os envelopes do
 * provedor ficam de fora dela. A folga é o preço de não descobrir a diferença
 * em produção.
 */
export const LIMITE_FCM_BYTES = 4096;
export const ORCAMENTO_DATA_BYTES = 3500;

const codificador = new TextEncoder();

/** Bytes de UTF-8 de uma string. */
export function bytesUtf8(texto: string): number {
  return codificador.encode(texto).length;
}

/**
 * Custo de um par chave/valor já como vai no JSON: aspas, escapes (\", \n,
 * \uXXXX) e os dois separadores.
 */
function custoDoPar(chave: string, valor: string): number {
  return bytesUtf8(JSON.stringify(chave)) + 1 + bytesUtf8(JSON.stringify(valor)) + 1;
}

/** Tamanho estimado do `data` no fio. */
export function tamanhoDoData(data: Record<string, string>): number {
  let total = 2; // { }
  for (const [k, v] of Object.entries(data)) total += custoDoPar(k, v);
  return total;
}

type SegmentadorDeTexto = new (locale?: string, opcoes?: { granularity: string }) => {
  segment(texto: string): Iterable<{ segment: string }>;
};

function graficos(texto: string): string[] {
  // Segmenta por GRAFEMA: cortar no meio de um emoji composto ou de "e" + acento
  // combinado deixa um caractere quebrado na tela de bloqueio.
  const Segmenter = (Intl as unknown as { Segmenter?: SegmentadorDeTexto }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter("pt-BR", { granularity: "grapheme" }).segment(texto), (s) => s.segment);
  return Array.from(texto); // sem Segmenter: pelo menos por code point, nunca no meio de um par substituto
}

/**
 * Corta `texto` pra caber em `maxBytes` (contando o JSON), sem partir emoji nem
 * acento, e termina com reticências quando cortou.
 */
export function truncarUnicode(texto: string, maxBytes: number): string {
  const custo = (s: string) => bytesUtf8(JSON.stringify(s)) - 2; // sem as aspas externas
  if (custo(texto) <= maxBytes) return texto;
  const reticencias = "…";
  const limite = maxBytes - custo(reticencias);
  if (limite <= 0) return "";
  let saida = "";
  let usado = 0;
  for (const g of graficos(texto)) {
    const c = custo(g);
    if (usado + c > limite) break;
    saida += g;
    usado += c;
  }
  return saida.trimEnd() + reticencias;
}

/** Tira itens do FIM da lista até o JSON caber; devolve "" se nem um item cabe. */
function reduzirItensJson(json: string, maxBytes: number): string {
  let itens: unknown;
  try { itens = JSON.parse(json); } catch { return ""; }
  if (!Array.isArray(itens)) return "";
  for (let n = itens.length; n > 0; n--) {
    const candidato = JSON.stringify(itens.slice(0, n));
    if (bytesUtf8(JSON.stringify(candidato)) <= maxBytes) return candidato;
  }
  return "";
}

const TITULO_MAX_BYTES = 200;
const PRODUTO_MAX_BYTES = 200;

/**
 * Faz o `data` caber no orçamento, degradando pelo que menos importa:
 *
 *  1. título e nome do produto ganham um teto folgado;
 *  2. a lista de itens perde itens do fim — a Central e o toast têm o detalhe
 *     completo do evento, o push é só o aviso;
 *  3. só então o corpo é cortado, porque é o que a pessoa lê.
 *
 * `eventId`, `type`, `tag`, `deepLink` e `timestamp` nunca são tocados: sem
 * eles o aparelho não substitui a notificação nem abre a tela certa.
 * Devolve o que foi cortado, pro registro do envio.
 */
export function ajustarAoOrcamento(
  data: Record<string, string>,
  orcamento = ORCAMENTO_DATA_BYTES,
): { data: Record<string, string>; cortes: string[] } {
  const saida = { ...data };
  const cortes: string[] = [];
  if (tamanhoDoData(saida) <= orcamento) return { data: saida, cortes };

  const cortar = (campo: string, maxBytes: number) => {
    const antes = saida[campo] ?? "";
    const depois = truncarUnicode(antes, maxBytes);
    if (depois !== antes) { saida[campo] = depois; cortes.push(campo); }
  };
  cortar("title", TITULO_MAX_BYTES);
  cortar("productName", PRODUTO_MAX_BYTES);
  if (tamanhoDoData(saida) <= orcamento) return { data: saida, cortes };

  if (saida.itensJson) {
    const semItens = { ...saida, itensJson: "" };
    const folga = orcamento - tamanhoDoData(semItens);
    const reduzido = reduzirItensJson(saida.itensJson, Math.max(0, folga));
    if (reduzido !== saida.itensJson) { saida.itensJson = reduzido; cortes.push("itensJson"); }
    if (tamanhoDoData(saida) <= orcamento) return { data: saida, cortes };
  }

  const semCorpo = { ...saida, body: "" };
  const folgaDoCorpo = orcamento - tamanhoDoData(semCorpo);
  cortar("body", Math.max(0, folgaDoCorpo));
  return { data: saida, cortes };
}
