/**
 * O que aceitar na única porta aberta do sistema.
 *
 * ─── O QUE ESTA ROTA ACEITAVA ───────────────────────────────────────────
 *
 * `/api/ml/webhook` é público por natureza: o Mercado Livre chama sem token,
 * e não há como exigir um. Mas a rota aceitava qualquer JSON com um
 * `resource` parecido com `/orders/123` e, a partir daí, buscava o pedido na
 * API do ML COM O NOSSO TOKEN e gravava no Firestore.
 *
 * Nada era conferido: nem o `topic`, nem o `user_id` (de qual vendedor é a
 * notificação), nem o `application_id` (de qual aplicação). Qualquer pessoa
 * que soubesse a URL podia disparar trabalho pago por nós — uma chamada à
 * API do ML e escritas no Firestore por requisição, sem limite — e ressuscitar
 * pedidos antigos em laço.
 *
 * ─── O QUE DÁ PRA CONFERIR DE VERDADE ───────────────────────────────────
 *
 * O Mercado Livre NÃO assina as notificações. Não existe HMAC pra validar, e
 * inventar um cabeçalho de assinatura seria teatro. O que o ML manda de fato,
 * e que dá pra conferir, é o conteúdo:
 *
 *   topic           — o assunto; só tratamos orders_v2
 *   user_id         — o vendedor; tem que ser o NOSSO
 *   application_id  — a aplicação; tem que ser a NOSSA
 *   resource        — o ponteiro, que tem que ter a forma esperada
 *
 * Isso não prova origem (quem souber os três números forja um corpo válido),
 * e é justamente por isso que a validação é barata e vem ANTES da consulta
 * cara: o objetivo aqui é recusar lixo e repetição sem pagar por eles, não
 * autenticar o remetente. A garantia real de não duplicar efeito continua
 * sendo a idempotência pelo `dedupeKey`.
 */

export type NotificacaoML = {
  resource?: unknown;
  topic?: unknown;
  user_id?: unknown;
  application_id?: unknown;
  attempts?: unknown;
};

export type RecusaWebhook =
  | "corpo_invalido"
  | "topico_nao_tratado"
  | "vendedor_diferente"
  | "aplicacao_diferente"
  | "recurso_invalido";

export type VeredictoWebhook =
  | { ok: true; topic: string; orderId: string; tentativa: number }
  | { ok: false; motivo: RecusaWebhook; topic: string };

/** O único tópico que esta rota transforma em evento de negócio. */
export const TOPICO_TRATADO = "orders_v2";

/**
 * Tópicos que o ML manda e nós descartamos de propósito. Listados pra a
 * contagem diária separar "descartado porque não tratamos" de "descartado
 * porque veio errado" — são diagnósticos diferentes.
 */
export const TOPICOS_CONHECIDOS = [
  "orders_v2", "shipments", "items", "payments", "invoices",
  "stock-locations", "price_suggestion", "messages", "claims",
];

function texto(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
}

/**
 * Decide se esta notificação merece a consulta à API do ML.
 *
 * @param esperado.sellerId nosso vendedor. Vazio = não conferir (uma
 *   instalação sem ML_SELLER_ID não pode ficar sem receber venda nenhuma).
 * @param esperado.appId nossa aplicação. Vazio = não conferir, mesma razão.
 */
export function validarNotificacao(
  body: NotificacaoML | null | undefined,
  esperado: { sellerId?: string; appId?: string },
): VeredictoWebhook {
  if (!body || typeof body !== "object") {
    return { ok: false, motivo: "corpo_invalido", topic: "" };
  }

  const topic = texto(body.topic);
  const resource = texto(body.resource);

  // O tópico manda. Antes a rota olhava só o formato do `resource`, então uma
  // notificação de outro assunto com um resource parecido entrava como venda.
  if (topic && topic !== TOPICO_TRATADO) {
    return { ok: false, motivo: "topico_nao_tratado", topic };
  }

  const sellerEsperado = texto(esperado.sellerId);
  const sellerRecebido = texto(body.user_id);
  if (sellerEsperado && sellerRecebido && sellerRecebido !== sellerEsperado) {
    return { ok: false, motivo: "vendedor_diferente", topic };
  }

  const appEsperado = texto(esperado.appId);
  const appRecebido = texto(body.application_id);
  if (appEsperado && appRecebido && appRecebido !== appEsperado) {
    return { ok: false, motivo: "aplicacao_diferente", topic };
  }

  const m = resource.match(/^\/orders\/(\d+)$/);
  if (!m) return { ok: false, motivo: "recurso_invalido", topic };

  const tentativa = Number(body.attempts);
  return {
    ok: true,
    topic: topic || TOPICO_TRATADO,
    orderId: m[1],
    tentativa: Number.isFinite(tentativa) && tentativa > 0 ? tentativa : 1,
  };
}

/** Rótulo curto pra contagem diária — sem id de pedido, sem corpo. */
export function rotuloDaRecusa(v: VeredictoWebhook): string {
  if (v.ok) return "aceito";
  const t = v.topic && TOPICOS_CONHECIDOS.includes(v.topic) ? v.topic : "outro";
  return v.motivo === "topico_nao_tratado" ? t : v.motivo;
}
