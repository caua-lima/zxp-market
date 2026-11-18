/**
 * SEPARAÇÃO DE PACOTE — o sinal que o próprio Mercado Livre manda.
 *
 * Quando o vendedor separa um pacote na agência (ex.: 1 Menta & Cereja + 2
 * Menta Limão viram envios separados), o ML NÃO edita o pedido: cancela os
 * pedidos originais e cria pedidos novos, cada um com pacote e envio próprios.
 * Conferido na conta em 18/11/2026 (pacote 2000016125187359):
 *
 *  · os originais: `status: "cancelled"` com
 *    `cancel_detail: { group: "internal", code: "pack_splitted",
 *    requested_by: "meli" }` — o comprador não cancelou nada;
 *  · os novos: `tags` com `"splitted_order"` e `pack_id` NOVO (o antigo não
 *    é reaproveitado), criados na hora da separação.
 *
 * Contar o original como cancelamento infla "canceladas" e dispara aviso de
 * venda cancelada; contar os novos como venda nova dispara aviso de venda de
 * novo. Para o painel, a compra é uma só: os originais somem, os novos valem.
 *
 * Puro — usado no servidor e no teste.
 */

export const CODIGO_PACOTE_SEPARADO = "pack_splitted";
export const TAG_PEDIDO_DA_SEPARACAO = "splitted_order";

/** O `cancel_detail.code` do pedido do ML, ou null. */
export function motivoDoCancelamento(pedidoMl: Record<string, unknown>): string | null {
  const d = pedidoMl.cancel_detail as Record<string, unknown> | null | undefined;
  const code = d && typeof d === "object" ? String(d.code ?? "").trim() : "";
  return code || null;
}

/** O pedido do ML nasceu de uma separação de pacote (é a continuação de uma compra já anunciada)? */
export function nasceuDeSeparacao(pedidoMl: Record<string, unknown>): boolean {
  return Array.isArray(pedidoMl.tags) && pedidoMl.tags.some((t) => String(t) === TAG_PEDIDO_DA_SEPARACAO);
}

/**
 * Cancelado SÓ porque o pacote foi separado? Aceita o pedido cru do ML
 * (`cancel_detail`) ou o documento gravado (`motivo_cancelamento`).
 */
export function canceladoPorSeparacao(p: { status?: unknown; motivo_cancelamento?: unknown; cancel_detail?: unknown } | null | undefined): boolean {
  if (!p || String(p.status ?? "") !== "cancelled") return false;
  const gravado = String(p.motivo_cancelamento ?? "").trim();
  if (gravado) return gravado === CODIGO_PACOTE_SEPARADO;
  return motivoDoCancelamento(p as Record<string, unknown>) === CODIGO_PACOTE_SEPARADO;
}
