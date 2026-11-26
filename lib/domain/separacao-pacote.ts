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

/** Quando o ML cancelou (`cancel_detail.date`), ou null. */
export function canceladoEm(pedidoMl: Record<string, unknown>): string | null {
  const d = pedidoMl.cancel_detail as Record<string, unknown> | null | undefined;
  const data = d && typeof d === "object" ? String(d.date ?? "").trim() : "";
  return data && Number.isFinite(Date.parse(data)) ? data : null;
}

/**
 * ─── A DATA DA VENDA NA SEPARAÇÃO ───────────────────────────────────────
 *
 * Os pedidos novos nascem com `date_created` = a HORA DA SEPARAÇÃO, não a da
 * compra. Medido no pacote 2000016125187359: compra em 17/11 22:10, pedidos
 * novos com 18/11 05:05. Como o original sai da conta (pack_splitted), a venda
 * MUDAVA DE DIA: sumia do dia da compra e aparecia no dia em que o pacote foi
 * separado na agência — o "faturamento vem pra hoje" (relato do dono, 26/11).
 * Nada duplicava; o valor só pulava de dia.
 *
 * A compra é uma só e o dia dela não muda: o pedido novo herda o
 * `date_created` do original. Achar o original:
 *   · mesmo comprador;
 *   · original cancelado com `pack_splitted`, criado ANTES do novo;
 *   · o anúncio do novo está entre os itens do original;
 *   · quando o original tem a hora do cancelamento, ela tem de estar a até 2 h
 *     da criação do novo (o ML cancela e recria no mesmo minuto — 05:04:32 ×
 *     05:05:20 no caso medido). Sem essa hora (gravados antes de existir o
 *     campo), vale uma janela de 10 dias, e fica a compra mais recente.
 *
 * Puro.
 */
export type PedidoParaOrigem = {
  orderId: string;
  buyerId?: string | null;
  status?: unknown;
  motivoCancelamento?: string | null;
  /** `cancel_detail.date` gravado (cancelado_em). */
  canceladoEm?: string | null;
  dateCreated: string;
  packId?: string | null;
  itens: string[];
};

export type OrigemDaSeparacao = { dateCreated: string; pedidos: string[]; packId: string | null };

export const JANELA_CANCELAMENTO_MS = 2 * 3600 * 1000;
export const JANELA_SEM_HORA_DIAS = 10;

const normMlb = (s: unknown) => String(s ?? "").trim().toUpperCase();

export function origemDaSeparacao(
  novo: { buyerId?: string | null; dateCreated: string; itens: string[] },
  candidatos: readonly PedidoParaOrigem[],
): OrigemDaSeparacao | null {
  const comprador = String(novo.buyerId ?? "").trim();
  const tNovo = Date.parse(novo.dateCreated);
  const itensNovo = new Set(novo.itens.map(normMlb).filter(Boolean));
  if (!comprador || !Number.isFinite(tNovo) || itensNovo.size === 0) return null;

  const originais = candidatos.filter((c) => {
    if (String(c.buyerId ?? "").trim() !== comprador) return false;
    if (String(c.status ?? "") !== "cancelled" || String(c.motivoCancelamento ?? "") !== CODIGO_PACOTE_SEPARADO) return false;
    const tOrig = Date.parse(c.dateCreated);
    if (!Number.isFinite(tOrig) || tOrig > tNovo) return false;
    const tCancel = c.canceladoEm ? Date.parse(c.canceladoEm) : NaN;
    if (Number.isFinite(tCancel)) { if (Math.abs(tNovo - tCancel) > JANELA_CANCELAMENTO_MS) return false; }
    else if (tNovo - tOrig > JANELA_SEM_HORA_DIAS * 86400000) return false;
    return true;
  });
  // O anúncio do novo tem de estar na compra separada (o pacote inteiro, não só um pedido dele).
  const daMesmaCompra = (c: PedidoParaOrigem) => originais.filter((o) => (c.packId && o.packId === c.packId) || o.orderId === c.orderId);
  let melhor: { c: PedidoParaOrigem; t: number } | null = null;
  for (const c of originais) {
    const compra = daMesmaCompra(c);
    const itensCompra = new Set(compra.flatMap((o) => o.itens.map(normMlb)));
    if (![...itensNovo].every((m) => itensCompra.has(m))) continue;
    const t = Date.parse(c.dateCreated);
    if (!melhor || t > melhor.t) melhor = { c, t };
  }
  if (!melhor) return null;
  const compra = daMesmaCompra(melhor.c);
  return {
    dateCreated: compra.map((o) => o.dateCreated).sort()[0],
    pedidos: compra.map((o) => o.orderId).sort(),
    packId: melhor.c.packId ? String(melhor.c.packId) : null,
  };
}
