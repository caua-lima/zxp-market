/**
 * O ESTADO de um pedido do Mercado Livre, e quem pode gravá-lo por cima de quem.
 *
 * ─── S12 DA AUDITORIA SAAS ───────────────────────────────────────────────
 *
 * Três caminhos gravam o mesmo documento em `ml_orders`: o webhook (segundos
 * depois de cada mudança), o sync (cron, sync manual, backfill) e a rota
 * legada `POST /api/ml/orders`. Todos com `set(..., { merge: true })` e um
 * `updatedAt` do relógio LOCAL — que diz quando a gravação aconteceu, não de
 * quando é o dado.
 *
 * O sync lê a página de pedidos no começo e só grava depois de buscar envio e
 * pagamento de cada um — minutos, num mês cheio. Se no meio disso o pedido é
 * cancelado, o webhook grava `cancelled`, e em seguida o sync grava por cima o
 * `paid` que tinha lido antes. A venda cancelada volta a contar no faturamento
 * até o próximo sync — que no plano gratuito da Vercel é no dia seguinte.
 *
 * O mesmo vale entre dois webhooks do mesmo pedido que se cruzam, e entre dois
 * syncs (cron e sync manual ao mesmo tempo).
 *
 * ─── A VERSÃO É A DO ML, NÃO A NOSSA ──────────────────────────────────────
 *
 * O pedido traz `last_updated`: o instante da última mudança NO ML. É ele que
 * ordena dois retratos do mesmo pedido. O documento guarda o `last_updated` do
 * retrato que está gravado, e só grava o estado quem tem um igual ou mais novo.
 *
 * `date_last_updated` NÃO serve: só a busca devolve esse campo (o GET do pedido,
 * que é o que o webhook usa, não), e no exemplo da própria documentação do ML
 * ele difere do `last_updated` do mesmo pedido. Comparar um com o outro
 * compararia relógios diferentes.
 *
 * Só o ESTADO é versionado. O resto que o sync grava (custo e status do envio,
 * líquido e repasse do Mercado Pago) vem de outras APIs, lidas na hora, e
 * nenhum outro caminho grava esses campos: um retrato velho do pedido não
 * torna velha a leitura do envio.
 */

type RawItem = Record<string, unknown>;

/** Normaliza os itens de um pedido do ML para o formato armazenado no Firestore. */
export function mapOrderItems(order: Record<string, unknown>) {
  const rawItems = (order.order_items as RawItem[]) ?? [];
  return rawItems.map((item) => {
    const itemObj = (item.item as Record<string, unknown>) ?? {};
    const itemId = String(itemObj.id ?? "").trim(); // MLB...
    const sellerSku = String(itemObj.seller_sku ?? "").trim();
    return {
      item_id: itemId, // vínculo por MLB
      sku: sellerSku || itemId, // vínculo por SKU do vendedor (fallback MLB)
      title: String(itemObj.title ?? ""),
      quantity: Number(item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      // Taxa de venda cobrada pelo ML nesta linha (por unidade — ver metrics)
      sale_fee: Number(item.sale_fee ?? 0),
    };
  });
}

/** A versão de um retrato do pedido: o `last_updated` em ms. `null` quando ausente ou ilegível. */
export function versaoDoPedido(lastUpdated: unknown): number | null {
  if (typeof lastUpdated !== "string" || !lastUpdated.trim()) return null;
  // Date.parse, não comparação de texto: o ML manda com fuso (-04:00), e dois
  // instantes com fusos diferentes não se ordenam como string.
  const ms = Date.parse(lastUpdated);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * O estado do pedido como TODOS os caminhos gravam — um mapeamento só.
 *
 * Eram três, e divergiam: a rota legada gravava itens sem `item_id` nem
 * `sale_fee` (o vínculo com o produto e a taxa do ML, de que a margem depende)
 * e `shipping_status: null` por cima do status real do envio; o sync gravava
 * `buyer_id: null` quando o comprador não vinha.
 */
export function estadoDoPedido(o: Record<string, unknown>): Record<string, unknown> {
  const comprador = (o.buyer as Record<string, unknown> | undefined)?.id;
  const envio = String((o.shipping as Record<string, unknown> | undefined)?.id ?? "").trim();
  return {
    order_id: String(o.id),
    status: o.status ?? null,
    date_created: String(o.date_created ?? ""),
    total_amount: Number(o.total_amount ?? 0),
    currency: o.currency_id ?? "BRL",
    // Spread condicional, NÃO `buyer_id: ... : null`: a gravação usa merge, e
    // null APAGARIA o comprador que outro retrato já tivesse salvo — e é o
    // buyer_id que sustenta a taxa de recompra (lib/domain/repurchase.ts).
    ...(comprador ? { buyer_id: String(comprador) } : {}),
    items: mapOrderItems(o),
    /**
     * Compra de produtos diferentes vira um pacote no ML: uma venda para o
     * comprador, mas vários pedidos na API. Sem o pack_id não dá para
     * remontar a venda inteira nem saber o lucro real dela.
     */
    pack_id: o.pack_id ? String(o.pack_id) : null,
    /**
     * O id do ENVIO — a chave mais precisa do rateio de frete (ver
     * lib/domain/frete-pacote.ts): dois pedidos podem dividir envio sem
     * dividir pacote. Condicional pelo mesmo motivo do comprador.
     */
    ...(envio ? { shipping_id: envio } : {}),
    // A versão do retrato. Só entra quando o ML mandou: sem ela o documento
    // continua com a versão que tinha (ver podeGravarEstado).
    ...(versaoDoPedido(o.last_updated) !== null ? { last_updated: String(o.last_updated) } : {}),
  };
}

export type MotivoEstado =
  /** Documento novo, ou gravado antes de existir versão: nada a comparar. */
  | "sem_versao_gravada"
  /** O ML não mandou `last_updated`. Grava, como sempre gravou. */
  | "retrato_sem_versao"
  | "igual_ou_mais_novo"
  /** O documento já tem um retrato MAIS NOVO. O estado em mãos não é gravado. */
  | "gravado_mais_novo";

/**
 * O retrato em mãos pode gravar o estado por cima do que está no documento?
 *
 * Retrato sem versão GRAVA — é o comportamento de antes, e a alternativa seria
 * pior: se o ML deixasse de mandar o campo, todo pedido já versionado ficaria
 * congelado no último estado, em silêncio. Sem versão não há o que proteger,
 * mas também não se piora nada em relação a hoje. E a versão gravada não é
 * apagada: continua barrando retratos versionados mais velhos que ela.
 *
 * Igual GRAVA: é o mesmo retrato, e regravar traz os campos que só um dos
 * caminhos tinha (o sync traz o envio, o webhook não).
 */
export function podeGravarEstado(
  versaoEmMaos: number | null,
  lastUpdatedGravado: unknown,
): { gravar: boolean; motivo: MotivoEstado } {
  const gravada = versaoDoPedido(lastUpdatedGravado);
  if (gravada === null) return { gravar: true, motivo: "sem_versao_gravada" };
  if (versaoEmMaos === null) return { gravar: true, motivo: "retrato_sem_versao" };
  if (versaoEmMaos >= gravada) return { gravar: true, motivo: "igual_ou_mais_novo" };
  return { gravar: false, motivo: "gravado_mais_novo" };
}
