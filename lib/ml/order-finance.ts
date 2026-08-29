import "server-only";
import { impostoNaData, type ImpostoFaixa } from "@/lib/domain/types";
import type { SaleFinanceInput } from "@/lib/domain/notifications";

export type OrderFinanceItem = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  sale_fee?: number;
  title?: string;
};

export type ProdutoCusto = { custo: number; imposto?: string | number; impostoFaixas?: ImpostoFaixa[] };

export type OrderFinanceEstimate = SaleFinanceInput & {
  productName: string;
  itemCount: number;
  quantityTotal: number;
  /**
   * Algum item do pedido não bate com nenhum produto cadastrado. Já existia
   * como variável interna (`algumSemProduto`) e só virava `estimatedProfit:
   * null` — o aviso saía como "cálculo financeiro em atualização", que soa
   * temporário e não diz o que fazer. É o caso mais caro que passa
   * despercebido: o CMV entra como ZERO e o lucro do dia fica inflado até
   * alguém cadastrar o SKU.
   */
  semCadastro: boolean;
  /**
   * O custo de frete do vendedor não pôde ser apurado. Separado de
   * `semCadastro` porque a ação do usuário é outra: sem cadastro ele
   * cadastra o produto; sem frete, é só esperar o ML publicar o custo.
   */
  freteDesconhecido: boolean;
  /** Um item por produto distinto do pedido — o que a notificação usa pra listar "+N itens" em detalhe. */
  itens: { title: string; quantity: number }[];
};

const normSku = (s: string) => s.trim().toLowerCase();
const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");

/**
 * Estimativa de lucro/margem de UM pedido, no momento em que ele chega —
 * mesma lógica de custo/imposto/taxa que o resto do app usa (ver
 * vendasPorItem em app/api/ml/ads/route.ts), só que pra um pedido isolado em
 * vez de agregar um período inteiro.
 *
 * `financialState` é sempre "estimated" quando dá pra calcular: mesmo com
 * TODOS os produtos vinculados, o valor pode mudar depois — frete definitivo,
 * taxas ajustadas, repasse do Mercado Pago confirmado. Nunca "confirmed"
 * aqui, de propósito (só a sincronização completa fecha esse número).
 *
 * Se QUALQUER item do pedido não tiver produto vinculado (sem custo pra
 * calcular), o pedido inteiro vira "unavailable" — misturar item com custo
 * conhecido e item sem custo daria uma margem inventada, pior que não
 * mostrar nada.
 *
 * ─── FRETE AUSENTE É O MESMO CASO, E ISSO CUSTOU CARO ───────────────────
 *
 * Aqui já se tratou frete ausente como ZERO, com o argumento de que o resto
 * do app tolerava isso até o sync completar. Só que o campo que chegava era
 * `order.shipping_cost` — o que o COMPRADOR pagou —, e com frete grátis ele
 * é zero em 100% dos pedidos desta conta (medido: 12 de 12). O custo do
 * vendedor mora em /shipments/{id}/costs e somava R$ 46,55 nesses mesmos 12.
 *
 * Ou seja: toda notificação de venda já emitida calculou margem com frete
 * zero. Medido contra o ML, o pedido de R$ 38,60 foi anunciado com 14,2% de
 * margem quando a real era 4,9% — a diferença é exatamente o frete. Era por
 * isso que só 23 de 464 vendas disparavam o alerta de margem baixa.
 *
 * Frete desconhecido agora derruba pra "unavailable" pelo mesmo motivo que
 * item sem cadastro derruba: assumir zero não é estimar, é inventar — e
 * inventar PRA CIMA, no único número que decide preço.
 */
export function estimateOrderFinance(
  items: OrderFinanceItem[],
  porMlb: Map<string, ProdutoCusto>,
  porSku: Map<string, ProdutoCusto>,
  shippingCost: number | null,
  dataVendaISO: string,
  metaMargem: number | null,
): OrderFinanceEstimate {
  let grossAmount = 0;
  let cmv = 0;
  let taxaML = 0;
  let imposto = 0;
  let quantityTotal = 0;
  let algumSemProduto = false;

  for (const it of items) {
    const qty = Number(it.quantity ?? 1);
    const receita = Number(it.unit_price ?? 0) * qty;
    grossAmount += receita;
    taxaML += Number(it.sale_fee ?? 0) * qty;
    quantityTotal += qty;

    const id = String(it.item_id ?? "").trim().toUpperCase();
    const prod = (id && porMlb.get(normId(id))) || porSku.get(normSku(String(it.sku ?? "")));
    if (!prod) { algumSemProduto = true; continue; }
    cmv += prod.custo * qty;
    imposto += receita * (impostoNaData(prod, dataVendaISO.slice(0, 10)) / 100);
  }

  const productName = items[0]?.title || "Produto";
  const itemCount = items.length;
  const itens = items.map((it) => ({ title: it.title || "Produto", quantity: Number(it.quantity ?? 1) }));

  if (algumSemProduto || items.length === 0) {
    return {
      grossAmount, estimatedProfit: null, estimatedMargin: null, metaMargem,
      productName, itemCount, quantityTotal, semCadastro: algumSemProduto,
      freteDesconhecido: shippingCost == null, itens,
    };
  }

  if (shippingCost == null) {
    return {
      grossAmount, estimatedProfit: null, estimatedMargin: null, metaMargem,
      productName, itemCount, quantityTotal, semCadastro: false,
      freteDesconhecido: true, itens,
    };
  }

  const frete = shippingCost;
  const estimatedProfit = grossAmount - cmv - taxaML - imposto - frete;
  const estimatedMargin = grossAmount > 0 ? (estimatedProfit / grossAmount) * 100 : 0;

  return {
    grossAmount, estimatedProfit, estimatedMargin, metaMargem,
    productName, itemCount, quantityTotal, semCadastro: false,
    freteDesconhecido: false, itens,
  };
}
