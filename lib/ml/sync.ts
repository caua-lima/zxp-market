import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  carregarProdutos,
  metaMargemAtual,
  notificarVendaConfirmada,
  vendaRecente,
} from "@/lib/ml/notificar-venda";

const ML_API = "https://api.mercadolibre.com";
const MP_API = "https://api.mercadopago.com";
const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

export type SyncRange = { from: string; to: string };

/** Intervalo do mês atual (fuso BR, -03:00) em ISO. */
export function currentMonthRangeBR(): SyncRange {
  const brTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const year = brTime.getUTCFullYear();
  const month = brTime.getUTCMonth();
  const mm = String(month + 1).padStart(2, "0");
  const ld = String(new Date(Date.UTC(year, month + 1, 0)).getUTCDate()).padStart(2, "0");
  return {
    from: `${year}-${mm}-01T00:00:00.000-03:00`,
    to: `${year}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

/**
 * Intervalo do MÊS ANTERIOR (fuso BR). O cron precisa dele porque dado de
 * venda não para de mudar quando o mês vira: o repasse do Mercado Pago cai
 * dias depois, devolução em disputa fecha depois, envio finaliza depois.
 * Sincronizar só o mês corrente congelava o fechamento do mês passado.
 */
export function previousMonthRangeBR(): SyncRange {
  const brTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const year = brTime.getUTCFullYear();
  const month = brTime.getUTCMonth(); // 0-based; -1 = mês anterior
  const ini = new Date(Date.UTC(year, month - 1, 1));
  const y = ini.getUTCFullYear();
  const m = ini.getUTCMonth();
  const mm = String(m + 1).padStart(2, "0");
  const ld = String(new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).padStart(2, "0");
  return {
    from: `${y}-${mm}-01T00:00:00.000-03:00`,
    to: `${y}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

/** Intervalo dos últimos N dias (fuso BR) em ISO, incluindo hoje. */
export function lastNDaysRangeBR(days: number): SyncRange {
  const brNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const to = brNow.toISOString().slice(0, 10);
  const brStart = new Date(brNow.getTime() - Math.max(0, days - 1) * 24 * 60 * 60 * 1000);
  const from = brStart.toISOString().slice(0, 10);
  return {
    from: `${from}T00:00:00.000-03:00`,
    to: `${to}T23:59:59.999-03:00`,
  };
}

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

/** Executa `fn` sobre `items` com no máximo `limit` chamadas simultâneas. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

type ShipmentInfo = {
  cost: number | null;
  status: string;
  substatus: string;
  logistic: string;
  tracking: string;
  estimated: string;
  dateDelivered: string;   // data real da entrega (status_history)
};

/**
 * Busca custo (senders) + status/logística do envio numa passada.
 * Retorna null em falha (para permitir nova tentativa no próximo sync).
 */
type LeadTime = {
  estimated_delivery_time?: { date?: string };
  estimated_delivery_final?: { date?: string };
  estimated_delivery_limit?: { date?: string };
};
function pickEstimate(lt?: LeadTime): string {
  return String(lt?.estimated_delivery_final?.date ?? lt?.estimated_delivery_time?.date ?? lt?.estimated_delivery_limit?.date ?? "");
}

async function fetchShipment(accessToken: string, shipmentId: string): Promise<ShipmentInfo | null> {
  // x-format-new enriquece o envio (inclui lead_time/prazo)
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "x-format-new": "true" };
  try {
    // detalhe do envio (status, logística, tracking, prazo, list_cost)
    const rs = await fetch(`${ML_API}/shipments/${shipmentId}`, { headers, cache: "no-store" });
    if (!rs.ok) return null;
    const j = (await rs.json()) as {
      status?: string; substatus?: string; logistic_type?: string; tracking_number?: string;
      shipping_option?: { cost?: number; list_cost?: number; estimated_delivery_time?: { date?: string }; estimated_delivery_final?: { date?: string } };
      base_cost?: number; lead_time?: LeadTime;
      status_history?: { date_delivered?: string };
    };
    const status = String(j.status ?? "");
    const substatus = String(j.substatus ?? "");
    const logistic = String(j.logistic_type ?? "");
    const tracking = String(j.tracking_number ?? "");
    const dateDelivered = String(j.status_history?.date_delivered ?? "");
    let estimated = pickEstimate(j.lead_time) ||
      String(j.shipping_option?.estimated_delivery_final?.date ?? j.shipping_option?.estimated_delivery_time?.date ?? "");
    // fallback: sub-recurso de prazo, quando o envio não trouxe lead_time
    if (!estimated) {
      try {
        const rl = await fetch(`${ML_API}/shipments/${shipmentId}/lead_time`, { headers, cache: "no-store" });
        if (rl.ok) estimated = pickEstimate((await rl.json()) as LeadTime);
      } catch { /* segue */ }
    }
    const buyerCost = Number(j.shipping_option?.cost ?? 0);
    const listCost = Number(j.shipping_option?.list_cost ?? 0);
    const baseCost = Number(j.base_cost ?? 0);

    // custo do vendedor: /costs senders (mais preciso), fallback list_cost em frete grátis
    // (sem x-format-new para não alterar a estrutura de custo já validada)
    const costHeaders = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
    let cost: number | null = null;
    try {
      const rc = await fetch(`${ML_API}/shipments/${shipmentId}/costs`, { headers: costHeaders, cache: "no-store" });
      if (rc.ok) {
        const jc = (await rc.json()) as { senders?: { cost?: number }[] };
        const senders = Array.isArray(jc?.senders) ? jc.senders : [];
        const sum = senders.reduce((s, x) => s + Number(x?.cost ?? 0), 0);
        if (sum > 0) cost = sum;
      }
    } catch { /* segue */ }
    if (cost == null) cost = buyerCost === 0 ? (listCost > 0 ? listCost : baseCost > 0 ? baseCost : 0) : 0;

    return { cost, status, substatus, logistic, tracking, estimated, dateDelivered };
  } catch {
    return null;
  }
}

/** Ids de pedidos cujo envio já está em estado FINAL (não precisa re-buscar). */
async function terminalShipmentIds(db: FirebaseFirestore.Firestore, orderIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  const terminal = new Set(["delivered", "not_delivered", "cancelled"]);
  const CHUNK = 300;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const refs = orderIds.slice(i, i + CHUNK).map((id) => db.collection("ml_orders").doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const st = String(snap.get("shipping_status") ?? "");
      if (!terminal.has(st)) continue;
      // Entregue mas ainda sem a data de entrega salva → re-busca uma vez pra capturá-la.
      if (st === "delivered" && !snap.get("date_delivered")) continue;
      set.add(snap.id);
    }
  }
  return set;
}

/** Ids de pedidos que já têm o campo salvo no Firestore (evita re-buscar). */
async function idsComCampo(db: FirebaseFirestore.Firestore, orderIds: string[], field: string): Promise<Set<string>> {
  const set = new Set<string>();
  const CHUNK = 300;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const refs = orderIds.slice(i, i + CHUNK).map((id) => db.collection("ml_orders").doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) if (snap.get(field)) set.add(snap.id);
  }
  return set;
}

/**
 * Detalhe do pagamento no Mercado Pago: líquido REAL (net_received_amount) e a
 * data de liberação. Usa o mesmo token do ML. Retorna null se não autorizado.
 */
async function fetchPaymentInfo(accessToken: string, paymentId: string): Promise<{ net: number; release: string } | null> {
  try {
    const r = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { money_release_date?: string; transaction_details?: { net_received_amount?: number } };
    return { net: Number(j.transaction_details?.net_received_amount ?? 0), release: String(j.money_release_date ?? "") };
  } catch {
    return null;
  }
}

async function fetchAllOrders(
  accessToken: string,
  range: SyncRange,
  extraQuery = "",
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url =
      `${ML_API}/orders/search?seller=${SELLER_ID}` +
      `&order.date_created.from=${encodeURIComponent(range.from)}` +
      `&order.date_created.to=${encodeURIComponent(range.to)}` +
      `${extraQuery}&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ML orders fetch failed: ${await res.text()}`);

    const data = (await res.json()) as { results: Record<string, unknown>[]; paging: { total: number } };
    const results = data.results ?? [];
    all.push(...results);
    const total = data.paging?.total ?? 0;
    offset += results.length;
    if (offset >= total || results.length === 0) break;
  }
  return all;
}

/** Busca pedidos do período no ML (com custo de frete real) e grava em `ml_orders`. */
export async function syncOrdersRange(accessToken: string, range: SyncRange): Promise<number> {
  const db = getAdminDb();
  const all = await fetchAllOrders(accessToken, range);

  // ── Envio (Full): custo + status, via API de envios ──
  // Re-busca envios não-finais para o status ficar atualizado (a caminho→entregue)
  const orderIds = all.map((o) => String((o as Record<string, unknown>).id));
  const finais = await terminalShipmentIds(db, orderIds);

  const toFetch: { orderId: string; shipmentId: string }[] = [];
  for (const o of all) {
    const orderId = String((o as Record<string, unknown>).id);
    const shipmentId = String((o.shipping as Record<string, unknown>)?.id ?? "").trim();
    if (shipmentId && !finais.has(orderId)) toFetch.push({ orderId, shipmentId });
  }

  const infoByOrder = new Map<string, ShipmentInfo>();
  await mapPool(toFetch, 8, async ({ orderId, shipmentId }) => {
    const info = await fetchShipment(accessToken, shipmentId);
    if (info) infoByOrder.set(orderId, info);
  });

  // ── Repasse + líquido REAL (Mercado Pago, por pagamento do pedido) ──
  // net_received_amount e money_release_date vêm do pagamento. Busca o detalhe
  // do MP só de quem ainda não tem o líquido salvo (limite por rodada).
  const releaseByOrder = new Map<string, string>();     // do MP (preferido)
  const releaseFromSearch = new Map<string, string>();  // do payload de busca (fallback)
  const netByOrder = new Map<string, number>();
  const paymentsByOrder = new Map<string, string[]>();
  for (const o of all) {
    const oo = o as Record<string, unknown>;
    const id = String(oo.id);
    const payments = Array.isArray(oo.payments) ? (oo.payments as Record<string, unknown>[]) : [];
    paymentsByOrder.set(id, payments.map((p) => String(p.id ?? "")).filter(Boolean));
    const rel = payments.map((p) => String(p.money_release_date ?? "")).filter(Boolean).sort().pop() ?? "";
    if (rel) releaseFromSearch.set(id, rel);
  }
  const jaTemNet = await idsComCampo(db, orderIds, "net_received");
  const buscarMP = orderIds.filter((id) => !jaTemNet.has(id)).slice(0, 250);
  await mapPool(buscarMP, 8, async (id) => {
    let net = 0;
    let release = "";
    for (const pid of paymentsByOrder.get(id) ?? []) {
      const info = await fetchPaymentInfo(accessToken, pid);
      if (!info) continue;
      net += info.net;
      if (info.release > release) release = info.release; // libera na data mais tardia
    }
    if (net > 0) netByOrder.set(id, net);
    if (release) releaseByOrder.set(id, release);
  });

  // ── Gravação em lote ──
  const BATCH_SIZE = 400;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const order of all.slice(i, i + BATCH_SIZE)) {
      const o = order as Record<string, unknown>;
      const orderId = String(o.id);
      // Repasse (data) e líquido real do Mercado Pago.
      const moneyRelease = releaseByOrder.get(orderId) ?? releaseFromSearch.get(orderId) ?? "";
      const netReceived = netByOrder.get(orderId);
      const doc: Record<string, unknown> = {
        order_id: orderId,
        status: o.status ?? null,
        date_created: String(o.date_created ?? ""),
        total_amount: Number(o.total_amount ?? 0),
        currency: o.currency_id ?? "BRL",
        buyer_id: (o.buyer as Record<string, unknown>)?.id
          ? String((o.buyer as Record<string, unknown>).id)
          : null,
        items: mapOrderItems(o),
        /**
         * Compra de produtos diferentes vira um pacote no ML: uma venda para o
         * comprador, mas vários pedidos na API. Sem o pack_id não dá para
         * remontar a venda inteira nem saber o lucro real dela.
         */
        pack_id: o.pack_id ? String(o.pack_id) : null,
        /**
         * O id do ENVIO. Nao era persistido, e sem ele o rateio do frete so
         * podia agrupar por pack_id (ver lib/domain/frete-pacote.ts). O envio
         * e a chave mais precisa: dois pedidos podem compartilhar envio sem
         * compartilhar pacote.
         */
        shipping_id: String((o.shipping as Record<string, unknown>)?.id ?? "") || null,
        updatedAt: new Date().toISOString(),
      };
      if (moneyRelease) doc.money_release_date = moneyRelease;
      if (typeof netReceived === "number" && netReceived > 0) doc.net_received = netReceived;
      const info = infoByOrder.get(orderId);
      if (info) {
        if (typeof info.cost === "number") doc.shipping_cost = info.cost;
        doc.shipping_status = info.status;
        doc.shipping_substatus = info.substatus;
        doc.logistic_type = info.logistic;
        doc.tracking = info.tracking;
        doc.estimated_delivery = info.estimated;
        if (info.dateDelivered) doc.date_delivered = info.dateDelivered;
      }

      batch.set(db.collection("ml_orders").doc(orderId), doc, { merge: true });
    }
    await batch.commit();
  }

  await notificarVendasPendentes(all);
  return all.length;
}

/**
 * REDE DE SEGURANÇA das notificações de venda.
 *
 * O push dependia inteiramente de o Mercado Livre chamar o nosso webhook.
 * Quando esse caminho falha — notificação não cadastrada no painel de
 * Developers, tópico `orders_v2` não assinado, URL apontando pro deploy
 * antigo, retry estourado, indisponibilidade momentânea — a venda entrava no
 * Dashboard normalmente e o aviso simplesmente nunca saía, sem nada
 * registrando a falta.
 *
 * Como o sync já passa por todos os pedidos do período, ele é o lugar natural
 * pra fechar esse buraco: pedido pago e RECENTE que ainda não tem evento
 * ganha o aviso agora. O webhook segue sendo o caminho rápido (segundos) e
 * isto é a rede (minutos).
 *
 * Não duplica: `notificarVendaConfirmada` usa `dedupeKey` criado com
 * `create()` atômico, então webhook e sync podem correr juntos que só um
 * cria o evento. E o teto de 12h de idade impede que um sync de mês inteiro
 * dispare avisos de vendas antigas.
 */
async function notificarVendasPendentes(orders: unknown[]): Promise<void> {
  const candidatos = orders
    .map((o) => o as Record<string, unknown>)
    .filter((o) => String(o.status ?? "") === "paid" && vendaRecente(String(o.date_created ?? "")));
  if (candidatos.length === 0) return;

  const db = getAdminDb();
  // Contexto carregado UMA vez pro lote — sem isto seria uma varredura do
  // estoque por pedido.
  const [{ porMlb, porSku }, metaMargem] = await Promise.all([
    carregarProdutos(db),
    metaMargemAtual(db),
  ]);

  for (const o of candidatos) {
    try {
      await notificarVendaConfirmada({
        orderId: String(o.id),
        status: "paid",
        dateCreated: String(o.date_created ?? ""),
        items: mapOrderItems(o),
        shippingId: String((o.shipping as Record<string, unknown>)?.id ?? "").trim() || null,
      }, { porMlb, porSku, metaMargem });
    } catch {
      // Best-effort por pedido: uma venda que falhe no aviso não pode
      // derrubar o sync inteiro, que é o que mantém o Dashboard correto.
    }
  }
}

/** Busca pedidos cancelados do período e grava/atualiza em `ml_returns`. */
export async function syncReturnsRange(accessToken: string, range: SyncRange): Promise<number> {
  const db = getAdminDb();
  const all = await fetchAllOrders(accessToken, range, "&order.status=cancelled");
  if (all.length === 0) return 0;

  const BATCH_SIZE = 400;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const order of all.slice(i, i + BATCH_SIZE)) {
      const o = order as Record<string, unknown>;
      const id = String(o.id);
      batch.set(
        db.collection("ml_returns").doc(id),
        {
          order_id: id,
          status: o.status ?? null,
          tipo: "cancelamento",
          date_created: String(o.date_created ?? ""),
          total_amount: Number(o.total_amount ?? 0),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
  return all.length;
}

/**
 * Busca DEVOLUÇÕES reais (claims do tipo return) via API de pós-venda e grava
 * em `ml_returns` com motivo e produto. Best-effort: falha silenciosa (mantém
 * as devoluções baseadas em cancelamento como fallback).
 */
export async function syncClaimsRange(accessToken: string, range: SyncRange): Promise<number> {
  const db = getAdminDb();
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "x-format-new": "true" };

  // 1. Coleta claims (paginado)
  const claims: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset <= 500) {
    const res = await fetch(`${ML_API}/post-purchase/v1/claims/search?sort=date_created,desc&limit=50&offset=${offset}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return 0; // sem permissão/erro → mantém fallback
    const data = (await res.json()) as { data?: Record<string, unknown>[]; results?: Record<string, unknown>[]; paging?: { total?: number } };
    const results = data.data ?? data.results ?? [];
    claims.push(...results);
    const total = data.paging?.total ?? results.length;
    offset += results.length;
    if (offset >= total || results.length === 0) break;
  }
  if (claims.length === 0) return 0;

  const fromDate = range.from.slice(0, 10);
  const toDate = range.to.slice(0, 10);

  // 2. Filtra devoluções no período
  const devs = claims.filter((c) => {
    const type = String(c.type ?? "").toLowerCase();
    const isReturn = type.includes("return") || type.includes("devol");
    const dc = String(c.date_created ?? "").slice(0, 10);
    return isReturn && dc >= fromDate && dc <= toDate;
  });
  if (devs.length === 0) return 0;

  // 3. Enriquecer com dados do pedido (valor + produto) do cache Firestore
  const orderIds = devs.map((c) => String(c.resource_id ?? c.resource ?? c.order_id ?? "")).filter(Boolean);
  const orderMap = new Map<string, FirebaseFirestore.DocumentData>();
  const CHUNK = 300;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const refs = orderIds.slice(i, i + CHUNK).map((id) => db.collection("ml_orders").doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists) orderMap.set(s.id, s.data()!);
  }

  const batch = db.batch();
  for (const c of devs) {
    const orderId = String(c.resource_id ?? c.resource ?? c.order_id ?? "");
    if (!orderId) continue;
    const ord = orderMap.get(orderId);
    const items = (ord?.items as { title?: string }[]) ?? [];
    const produto = items.map((it) => it.title).filter(Boolean).join(", ");
    const valor = Number(c.amount ?? ord?.total_amount ?? 0);
    batch.set(
      db.collection("ml_returns").doc(orderId),
      {
        order_id: orderId,
        claim_id: String(c.id ?? ""),
        tipo: "devolucao",
        status: String(c.status ?? ""),
        // stage/status dizem se a devolução ainda está em disputa: sem isso não
        // dá para saber se ela foi concluída antes de descontar do lucro.
        stage: String(c.stage ?? ""),
        reason: String(c.reason_id ?? c.reason ?? ""),
        produto,
        date_created: String(c.date_created ?? ord?.date_created ?? ""),
        total_amount: valor,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }
  await batch.commit();
  return devs.length;
}
