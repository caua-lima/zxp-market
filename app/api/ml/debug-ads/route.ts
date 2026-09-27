import { rotaDeDiagnostico } from "@/lib/diagnostico";
import { getValidMlAccessToken } from "@/lib/ml/getToken";

const ML_API = "https://api.mercadolibre.com";

/**
 * Diagnóstico da API de Product Ads. Retorna a resposta crua de anunciantes e
 * uma amostra das métricas por item, para verificar advertiser_id, escopos e
 * nomes de campos na conta real.
 *
 * Uso: /api/ml/debug-ads?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const GET = rotaDeDiagnostico("debug-ads", async (req) => {
  const url = new URL(req.url);
  const now = new Date(Date.now() - 3 * 3600 * 1000);
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const from = url.searchParams.get("from") || `${ym}-01`;
  const to = url.searchParams.get("to") || now.toISOString().slice(0, 10);

  const token = await getValidMlAccessToken();

  // 1. Anunciantes
  const advRes = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
    headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
    cache: "no-store",
  });
  const advBody = await advRes.json().catch(() => null);

  const advertisers = advBody?.advertisers ?? [];
  const mlb = advertisers.find((a: { site_id?: string }) => String(a?.site_id ?? "").toUpperCase() === "MLB");
  const advertiserId = (mlb ?? advertisers[0])?.advertiser_id ?? null;

  // 2. Amostra de métricas por item
  let itemsStatus: number | null = null;
  let itemsBody: unknown = null;
  if (advertiserId) {
    const itemsRes = await fetch(
      `${ML_API}/advertising/advertisers/${advertiserId}/product_ads/items?` +
        `date_from=${from}&date_to=${to}&metrics=cost,clicks,prints&limit=5&offset=0`,
      { headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" }, cache: "no-store" },
    );
    itemsStatus = itemsRes.status;
    itemsBody = await itemsRes.json().catch(() => null);
  }

  return { corpo: {
    range: { from, to },
    advertisers: { status: advRes.status, body: advBody },
    advertiserIdEscolhido: advertiserId,
    itemsMetrics: { status: itemsStatus, body: itemsBody },
  } };
});
