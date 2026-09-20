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
