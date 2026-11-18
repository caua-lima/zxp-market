import { rotaDeDiagnostico } from "@/lib/diagnostico";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getMlAccessToken } from "../token";
import { sellerIdAtual } from "@/lib/ml/vendedor";

const ML_API = "https://api.mercadolibre.com";

/**
 * Diagnóstico da SEPARAÇÃO DE PACOTE: dado um pedido ou pacote (?id=), mostra
 * direto do ML todos os pedidos do mesmo pacote e os do mesmo comprador nos
 * 7 dias seguintes — status, motivo do cancelamento, pack, envio e itens.
 * Sem nome, endereço ou documento do comprador (o id dele vira "comprador").
 */
export const GET = rotaDeDiagnostico("debug-pacote", async (req) => {
  const id = (new URL(req.url).searchParams.get("id") ?? "").replace(/\D/g, "");
  if (!id) return { corpo: { error: "informe ?id=" }, status: 400 };
  const token = await getMlAccessToken();
  if (!token) return { corpo: { error: "sem token" }, status: 400 };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const json = async (url: string) => {
    const r = await fetchML(url, { headers, cache: "no-store" }).catch(() => null);
    return r ? { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null } : { status: 0, body: null };
  };

  const resumo = (o: Record<string, unknown>) => ({
    id: String(o.id),
    status: o.status,
    status_detail: o.status_detail ?? null,
    cancel_detail: o.cancel_detail ?? null,
    tags: o.tags ?? [],
    pack_id: o.pack_id ?? null,
    date_created: o.date_created,
    date_closed: o.date_closed ?? null,
    last_updated: o.last_updated ?? null,
    total_amount: o.total_amount,
    shipping_id: (o.shipping as Record<string, unknown> | undefined)?.id ?? null,
    itens: ((o.order_items as Record<string, unknown>[]) ?? []).map((it) => ({
      mlb: (it.item as Record<string, unknown> | undefined)?.id,
      titulo: (it.item as Record<string, unknown> | undefined)?.title,
      quantidade: it.quantity,
      preco: it.unit_price,
    })),
    comprador: (o.buyer as Record<string, unknown> | undefined)?.id ? "mesmo" : null,
  });

  const pedido = await json(`${ML_API}/orders/${id}`);
  const pack = await json(`${ML_API}/packs/${id}`);
  const ordensDoPack: string[] = [];
  const packBody = pack.body as { orders?: { id?: unknown }[] } | null;
  if (pack.status === 200 && Array.isArray(packBody?.orders)) for (const o of packBody.orders) ordensDoPack.push(String(o?.id ?? ""));
  const base = pedido.status === 200 ? pedido.body : null;
  const packId = base?.pack_id ? String(base.pack_id) : pack.status === 200 ? id : null;
  if (packId && packId !== id) {
    const p = await json(`${ML_API}/packs/${packId}`);
    const b = p.body as { orders?: { id?: unknown }[] } | null;
    if (Array.isArray(b?.orders)) for (const o of b.orders) ordensDoPack.push(String(o?.id ?? ""));
  }

  const primeiro = base ?? (ordensDoPack[0] ? (await json(`${ML_API}/orders/${ordensDoPack[0]}`)).body : null);
  const comprador = (primeiro?.buyer as Record<string, unknown> | undefined)?.id;
  let doComprador: ReturnType<typeof resumo>[] = [];
  if (comprador && primeiro?.date_created) {
    const de = new Date(new Date(String(primeiro.date_created)).getTime() - 86400000).toISOString();
    const r = await json(`${ML_API}/orders/search?seller=${await sellerIdAtual()}&buyer=${comprador}&order.date_created.from=${encodeURIComponent(de)}&sort=date_asc&limit=50`);
    doComprador = (((r.body?.results as Record<string, unknown>[]) ?? [])).map(resumo);
  }

  return {
    corpo: {
      consultado: id,
      pedido: base ? resumo(base) : { status: pedido.status },
      pack: pack.status === 200 ? { id, pedidos: ordensDoPack, status: (pack.body as Record<string, unknown>)?.status ?? null } : { status: pack.status },
      packDoPedido: packId,
      pedidosDoComprador: doComprador,
    },
  };
});
