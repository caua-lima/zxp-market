/**
 * "Venda confirmada AGORA" — a partir de QUANDO o pagamento foi aprovado.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * A elegibilidade do aviso olhava a data de CRIAÇÃO do pedido (até 12 h). Um
 * pedido criado ontem e pago agora (boleto, PIX que o comprador deixou pra
 * depois, pagamento em análise) tinha 24 h de idade, era classificado como
 * "antiga" e nunca gerava aviso — a venda entrava no painel e o push nunca
 * saía.
 *
 * O que importa pra "venda nova" é o instante em que o dinheiro foi aprovado.
 * Isso não afrouxa a proteção que o teto de idade existe pra dar: uma
 * importação de cem pedidos antigos e já pagos continua sem disparar cem
 * pushes, porque a aprovação DELES também é antiga. O que muda é qual data o
 * teto mede.
 *
 * Sem prova do pagamento no pedido (campo ausente ou ilegível), cai na data de
 * criação — o comportamento anterior, que erra pro lado de NÃO avisar.
 */

type PagamentoDoPedido = { status?: unknown; date_approved?: unknown };
type PedidoComPagamentos = { date_created?: unknown; payments?: unknown };

/**
 * O instante (ISO) que vale como "confirmada": a ÚLTIMA aprovação entre os
 * pagamentos aprovados (um pedido pago em duas parcelas só está confirmado
 * quando a segunda entra); senão, a criação.
 */
export function instanteDaConfirmacao(pedido: PedidoComPagamentos): string {
  const pagamentos = Array.isArray(pedido.payments) ? (pedido.payments as PagamentoDoPedido[]) : [];
  let maisRecente = Number.NEGATIVE_INFINITY;
  for (const p of pagamentos) {
    if (p?.status !== "approved") continue;
    const t = Date.parse(String(p.date_approved ?? ""));
    if (Number.isFinite(t) && t > maisRecente) maisRecente = t;
  }
  return Number.isFinite(maisRecente) ? new Date(maisRecente).toISOString() : String(pedido.date_created ?? "");
}

/** Quantos pedidos um único sync pode avisar. É a segunda trava contra tempestade: mesmo com data recente, um lote enorme não vira um enxame de pushes. */
export const MAX_AVISOS_POR_SYNC = 25;
