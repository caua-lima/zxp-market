/**
 * Vendas brutas por anúncio — a base da Curva ABC de vendas.
 *
 * ─── O QUE "VENDAS BRUTAS" SIGNIFICA AQUI ───────────────────────────────
 *
 * O mesmo que no painel do Seller Center: o valor dos pedidos que de fato
 * valeram — SEM os cancelados e SEM os devolvidos — antes de descontar taxa,
 * frete, custo ou imposto. É o `vendasBrutas` da conciliação de
 * /api/ml/metrics (igual ao faturamento líquido), e NÃO o "Faturamento bruto"
 * do Dashboard, que inclui cancelado e devolvido de propósito.
 *
 * Por isso a soma desta lista fecha com o número que a pessoa confere no
 * Seller Center. E por isso conta TODOS os anúncios, vinculados a produto ou
 * não: a curva de lucro só enxerga os vinculados (é onde há custo), mas venda
 * não depende de ter custo cadastrado.
 *
 * O que foi cancelado/devolvido de cada anúncio vai em `perdido`, à parte —
 * não entra em `bruto`, mas mostra o anúncio que vende muito e perde muito.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type ItemDoPedido = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  title?: string;
};

export type PedidoParaVendasBrutas = {
  orderId: string;
  /** Resultado de classificarVenda. "substituida" nem chega aqui (a rota o descarta antes). */
  classe: "valida" | "cancelada" | "devolvida";
  itens: ItemDoPedido[];
};

export type VendaBrutaDoAnuncio = {
  item_id: string;
  title: string;
  /** Valor vendido (preço × unidades) nos pedidos válidos. */
  bruto: number;
  /** Valor dos pedidos cancelados/devolvidos deste anúncio — fora do `bruto`. */
  perdido: number;
  /** Unidades vendidas nos pedidos válidos. */
  qty: number;
  /** Pedidos válidos distintos que contêm o anúncio. */
  pedidos: number;
};

export function vendasBrutasPorAnuncio(
  pedidos: readonly PedidoParaVendasBrutas[],
  /** Mesma chave do agregado por anúncio: id do anúncio sem "MLB", ou o SKU. */
  chaveDe: (it: ItemDoPedido) => string,
  /** Nome do produto cadastrado, quando o anúncio está vinculado a um. */
  nomeCadastradoDe: (it: ItemDoPedido) => string | undefined,
): VendaBrutaDoAnuncio[] {
  type Acc = VendaBrutaDoAnuncio & { _pedidos: Set<string> };
  const mapa = new Map<string, Acc>();

  for (const p of pedidos) {
    for (const it of p.itens) {
      const chave = chaveDe(it) || "sem-identificacao";
      const qty = Number(it.quantity ?? 1) || 0;
      const valor = (Number(it.unit_price ?? 0) || 0) * qty;
      let a = mapa.get(chave);
      if (!a) {
        a = {
          item_id: String(it.item_id ?? "").trim() || String(it.sku ?? "").trim() || chave,
          title: nomeCadastradoDe(it) || String(it.title ?? "").trim() || String(it.sku ?? "").trim() || "Sem identificação",
          bruto: 0, perdido: 0, qty: 0, pedidos: 0, _pedidos: new Set<string>(),
        };
        mapa.set(chave, a);
      }
      if (p.classe === "valida") {
        a.bruto += valor;
        a.qty += qty;
        a._pedidos.add(p.orderId);
      } else {
        a.perdido += valor;
      }
    }
  }

  return [...mapa.values()]
    // Só quem vendeu de verdade entra na curva; quem só teve pedido cancelado fica de fora.
    .filter((a) => a.bruto > 0)
    .map(({ _pedidos, ...a }) => ({ ...a, pedidos: _pedidos.size }))
    .sort((a, b) => b.bruto - a.bruto || a.title.localeCompare(b.title));
}
