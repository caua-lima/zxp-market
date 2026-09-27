import { rotaDeDiagnostico } from "@/lib/diagnostico";
import { getMlAccessToken } from "../token";
import { sellerIdAtual } from "@/lib/ml/vendedor";

const ML_API = "https://api.mercadolibre.com";

/** Testa vários endpoints candidatos de inbound do Full e mostra qual responde. */
export const GET = rotaDeDiagnostico("debug-inbound", async () => {
  const token = await getMlAccessToken();
  if (!token) return { corpo: { error: "sem token" }, status: 400 };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Api-Version": "1" };

  const candidatos = [
    `/inbound/shipments/search?seller_id=${await sellerIdAtual()}&limit=3`,
    `/inbound/shipments/search?seller_id=${await sellerIdAtual()}&site_id=MLB&limit=3`,
    `/fbm/inbound/shipments/search?seller_id=${await sellerIdAtual()}&limit=3`,
    `/stock/fulfillment/operations/search?seller_id=${await sellerIdAtual()}&limit=3`,
    `/marketplace/stock/fulfillment/operations/search?seller_id=${await sellerIdAtual()}&limit=3`,
    `/users/${await sellerIdAtual()}/inbound/shipments`,
    `/inbound-shipments/search?seller_id=${await sellerIdAtual()}&limit=3`,
    `/fulfillment/inbound_shipments/search?seller_id=${await sellerIdAtual()}&limit=3`,
    `/logistics/inbound/shipments/search?seller_id=${await sellerIdAtual()}&limit=3`,
  ];

  const resultados: { url: string; status: number; sample?: unknown }[] = [];
  for (const path of candidatos) {
    try {
      const res = await fetch(`${ML_API}${path}`, { headers, cache: "no-store" });
      const entry: { url: string; status: number; sample?: unknown } = { url: path, status: res.status };
      if (res.ok) entry.sample = await res.json().catch(() => null);
      else entry.sample = (await res.text().catch(() => "")).slice(0, 160);
      resultados.push(entry);
    } catch (e) {
      resultados.push({ url: path, status: -1, sample: String(e) });
    }
  }

  return { corpo: { sellerId: await sellerIdAtual(), resultados } };
});
