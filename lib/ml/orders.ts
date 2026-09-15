import "server-only";
import { fetchML } from "./fetch-ml";

export const ML_API = "https://api.mercadolibre.com";
export const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

export type OrderItemDoc = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  sale_fee?: number;
  title?: string;
};

export type OrderDoc = {
  order_id: string;
  status: string;
  date_created: string;
  total_amount: number;
  shipping_id?: string;
  shipping_cost?: number | null;
  /** Pacote: agrupa os pedidos de uma mesma compra com produtos diferentes. */
  pack_id?: string | null;
  items: OrderItemDoc[];
};

/** Lê os pedidos de um intervalo (UTC e BR) do Firestore, deduplicando por order_id. */
export async function loadOrders(
  db: FirebaseFirestore.Firestore,
  start: string,
  end: string,
  startBR: string,
  endBR: string,
): Promise<FirebaseFirestore.DocumentData[]> {
  const [snapUTC, snapBR] = await Promise.all([
    db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
    db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
  ]);
  const map = new Map<string, FirebaseFirestore.DocumentData>();
  for (const snap of [snapUTC, snapBR])
    for (const doc of snap.docs) {
      const d = doc.data();
      map.set(d.order_id ?? doc.id, d);
    }
  return Array.from(map.values());
}

/**
 * Busca pedidos AO VIVO no ML para o intervalo (evita depender da sincronização
 * para o faturamento/pedidos aparecerem). Retorna null em falha (usa fallback).
 * O frete (shipping_cost) é enriquecido do cache do Firestore depois.
 */
export async function fetchOrdersLive(
  token: string,
  fromISO: string,
  toISO: string,
): Promise<FirebaseFirestore.DocumentData[] | null> {
  try {
    const all: FirebaseFirestore.DocumentData[] = [];
    let offset = 0;
    while (true) {
      const url =
        `${ML_API}/orders/search?seller=${SELLER_ID}` +
        `&order.date_created.from=${encodeURIComponent(fromISO)}` +
        `&order.date_created.to=${encodeURIComponent(toISO)}` +
        `&limit=50&offset=${offset}`;
      const res = await fetchML(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
      const results = data.results ?? [];
      for (const o of results) {
        const rawItems = (o.order_items as Record<string, unknown>[]) ?? [];
        all.push({
          order_id: String(o.id),
          status: String(o.status ?? ""),
          date_created: String(o.date_created ?? ""),
          total_amount: Number(o.total_amount ?? 0),
          shipping_id: String((o.shipping as Record<string, unknown>)?.id ?? ""),
          pack_id: o.pack_id ? String(o.pack_id) : null,
          /**
           * O comprador é o que permite reconhecer a SEPARAÇÃO DE ENVIO quando
           * o Mercado Livre não reaproveita o `pack_id`: o pedido original é
           * cancelado e outros nascem no lugar, do mesmo comprador, no mesmo
           * dia, com os mesmos itens. Sem este campo (a busca de pedidos nunca
           * o trazia, só o sync completo) não havia como ligar um ao outro, e
           * o cancelamento administrativo era contado como venda perdida.
           */
          buyer_id: (o.buyer as Record<string, unknown>)?.id
            ? String((o.buyer as Record<string, unknown>).id)
            : null,
          items: rawItems.map((it) => {
            const itemObj = (it.item as Record<string, unknown>) ?? {};
            const itemId = String(itemObj.id ?? "").trim();
            const sellerSku = String(itemObj.seller_sku ?? "").trim();
            return {
              item_id: itemId,
              sku: sellerSku || itemId,
              title: String(itemObj.title ?? ""),
              quantity: Number(it.quantity ?? 0),
              unit_price: Number(it.unit_price ?? 0),
              sale_fee: Number(it.sale_fee ?? 0),
            };
          }),
        });
      }
      const total = data.paging?.total ?? 0;
      offset += results.length;
      if (offset >= total || results.length === 0) break;
    }
    return all;
  } catch {
    return null;
  }
}

/** Lê shipping_cost já sincronizado do Firestore para os pedidos informados. */
export async function readShippingCosts(
  db: FirebaseFirestore.Firestore,
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const refs = ids.slice(i, i + CHUNK).filter(Boolean).map((id) => db.collection("ml_orders").doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const v = snap.get("shipping_cost");
      if (typeof v === "number") map.set(snap.id, v);
    }
  }
  return map;
}

/**
 * Custo de frete do VENDEDOR para um envio, direto do ML.
 *
 * ─── POR QUE ISTO SAIU DO SYNC ──────────────────────────────────────────
 *
 * O custo só existia depois que `syncOrdersRange` passava pelo pedido e
 * gravava. Pedido recente, ou que o sync ainda não alcançou, ficava sem — e o
 * Dashboard resolvia isso com `?? 0`, transformando "não sei" em "frete
 * grátis". A margem daquele pedido saía inflada, e nada na tela dizia que
 * aquele número era um teto.
 *
 * Com o helper aqui, quem calcula margem pode BUSCAR o que falta em vez de
 * assumir zero. Mesma leitura do sync, pra não existirem duas definições de
 * custo de frete no app.
 */
export async function fetchShippingCost(token: string, shipmentId: string): Promise<number | null> {
  if (!shipmentId) return null;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  try {
    // `/costs` é o mais preciso: `senders` é literalmente o que VOCÊ paga.
    const rc = await fetchML(`${ML_API}/shipments/${shipmentId}/costs`, { headers, cache: "no-store" });
    if (rc.ok) {
      const jc = (await rc.json()) as { senders?: { cost?: number }[] };
      const soma = (Array.isArray(jc?.senders) ? jc.senders : []).reduce((s, x) => s + Number(x?.cost ?? 0), 0);
      if (soma > 0) return soma;
    }
  } catch { /* cai no detalhe do envio */ }

  try {
    const rs = await fetchML(`${ML_API}/shipments/${shipmentId}`, { headers, cache: "no-store" });
    if (!rs.ok) return null;
    const j = (await rs.json()) as {
      base_cost?: number;
      shipping_option?: { cost?: number; list_cost?: number };
    };
    const pagoPeloComprador = Number(j.shipping_option?.cost ?? 0);
    // Comprador pagou o frete → o vendedor não arca com nada. É zero de
    // verdade, não ausência de dado, e por isso devolve 0 em vez de null.
    if (pagoPeloComprador > 0) return 0;
    const list = Number(j.shipping_option?.list_cost ?? 0);
    const base = Number(j.base_cost ?? 0);
    return list > 0 ? list : base > 0 ? base : 0;
  } catch {
    return null;
  }
}

/**
 * Completa o custo de frete dos pedidos que o cache não tinha, consultando o
 * ML. Devolve quantos continuaram sem — esses seguem entrando como 0, e a
 * tela precisa saber pra avisar que a margem é um teto.
 *
 * `limite` existe porque isto é uma requisição por pedido: num mês inteiro
 * sem sync, buscar tudo estouraria o tempo da função. O teto prioriza os
 * pedidos de maior valor, que são os que mais distorcem a margem.
 */
export async function completarFretesFaltantes(
  token: string,
  pedidos: FirebaseFirestore.DocumentData[],
  limite = 40,
): Promise<{ buscados: number; aindaSemFrete: number }> {
  const faltando = pedidos
    .filter((o) => o.shipping_cost == null && String(o.shipping_id ?? "").trim())
    .sort((a, b) => Number(b.total_amount ?? 0) - Number(a.total_amount ?? 0));

  const alvos = faltando.slice(0, limite);
  let buscados = 0;
  // Concorrência baixa: o ML já devolveu 429 neste endpoint em outras rotas.
  const CONC = 4;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONC, alvos.length) }, async () => {
      while (i < alvos.length) {
        const o = alvos[i++];
        const c = await fetchShippingCost(token, String(o.shipping_id ?? ""));
        if (c != null) { o.shipping_cost = c; buscados++; }
      }
    }),
  );

  const aindaSemFrete = pedidos.filter((o) => o.shipping_cost == null).length;
  return { buscados, aindaSemFrete };
}
