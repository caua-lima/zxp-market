/**
 * Quanto do frete fica com o VENDEDOR quando o ML não devolve `senders` em
 * /shipments/{id}/costs.
 *
 * O envio traz a tarifa cheia (`shipping_option.list_cost`, ou `base_cost`) e o
 * que o comprador pagou (`shipping_option.cost`). A parte do vendedor é a
 * diferença. Exemplo real (12/11/2026, Abacaxi & Hortelã nas agências): tarifa
 * R$ 12,94, comprador pagou R$ 5,99, vendedor pagou R$ 6,95 — o mesmo que o
 * painel do ML mostra em "Envios".
 *
 * Antes a regra era "comprador pagou alguma coisa → vendedor paga 0", e todo
 * pedido abaixo do frete grátis entrava com frete zerado e margem inflada.
 *
 * Puro e autossuficiente (sem `@/`).
 */
export function custoDoVendedor(listCost: number, baseCost: number, pagoPeloComprador: number): number {
  const tarifa = Number(listCost) > 0 ? Number(listCost) : Number(baseCost) > 0 ? Number(baseCost) : 0;
  const comprador = Math.max(Number(pagoPeloComprador) || 0, 0);
  return Math.round(Math.max(tarifa - comprador, 0) * 100) / 100;
}
