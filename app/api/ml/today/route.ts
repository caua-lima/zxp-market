import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";

const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

interface MlOrdersResponse {
  results: Record<string, unknown>[];
  paging: { total: number; offset: number; limit: number };
}

function todayRangeISO() {
  const now = new Date();
  const brTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const yyyy = brTime.getUTCFullYear();
  const mm = String(brTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(brTime.getUTCDate()).padStart(2, "0");
  return {
    from: `${yyyy}-${mm}-${dd}T00:00:00.000-03:00`,
    to:   `${yyyy}-${mm}-${dd}T23:59:59.999-03:00`,
  };
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  try {
    const access = await getMlAccessToken();
    if (!access) return NextResponse.json({ error: "no_token", connected: false }, { status: 401 });

    const { from, to } = todayRangeISO();
    let allResults: Record<string, unknown>[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const url =
        `https://api.mercadolibre.com/orders/search?seller=${SELLER_ID}` +
        `&order.date_created.from=${encodeURIComponent(from)}` +
        `&order.date_created.to=${encodeURIComponent(to)}` +
        `&limit=${limit}&offset=${offset}`;

      const pageRes = await fetch(url, {
        headers: { Authorization: `Bearer ${access}` },
        cache: "no-store",
      });

      if (!pageRes.ok) {
        const txt = await pageRes.text();
        return NextResponse.json({ error: "ml_fetch_failed", details: txt }, { status: 502 });
      }

      const pageJson = await pageRes.json() as MlOrdersResponse;
      const results = pageJson.results ?? [];
      allResults = allResults.concat(results);
      const total = pageJson.paging?.total ?? 0;
      offset += results.length;
      if (offset >= total || results.length === 0) break;
    }

    let faturamento = 0;
    const perListing: Record<string, { title: string; vendas: number; faturamento: number }> = {};

    for (const o of allResults) {
      faturamento += Number(o.total_amount || 0);
      const orderItems = (o.order_items as Record<string, unknown>[]) ?? [];
      for (const it of orderItems) {
        const item = it as Record<string, Record<string, unknown>>;
        const id = String(item.item?.id ?? item.item?.seller_sku ?? "unknown");
        const unit = Number(item.unit_price || 0);
        const qty = Number(item.quantity || 0);
        if (!perListing[id]) perListing[id] = { title: String(item.item?.title ?? id), vendas: 0, faturamento: 0 };
        perListing[id].vendas += qty;
        perListing[id].faturamento += unit * qty;
      }
    }

    const items = Object.entries(perListing)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.faturamento - a.faturamento);

    return NextResponse.json({ connected: true, faturamento, ordersCount: allResults.length, items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "unexpected", details: msg }, { status: 500 });
  }
}