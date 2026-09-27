import { rotaDeDiagnostico } from "@/lib/diagnostico";
import { getMlAccessToken } from "../token";
import { sellerIdAtual } from "@/lib/ml/vendedor";

const ML_API = "https://api.mercadolibre.com";

/**
 * Diagnóstico de frete. Para os últimos pedidos, mostra o shipping.id e as
 * respostas cruas de /shipments/{id} e /shipments/{id}/costs, para identificar
 * onde está o "frete vendedor" (list_cost, senders[].cost, base_cost...).
 */
export const GET = rotaDeDiagnostico("debug-shipping", async () => {
  const token = await getMlAccessToken();
  if (!token) return { corpo: { error: "sem token" }, status: 400 };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const now = new Date(Date.now() - 3 * 3600 * 1000);
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const from = `${ym}-01T00:00:00.000-03:00`;

  const ordRes = await fetch(
    `${ML_API}/orders/search?seller=${await sellerIdAtual()}&order.date_created.from=${encodeURIComponent(from)}&limit=3&sort=date_desc`,
    { headers, cache: "no-store" },
  );
  const ordJson = await ordRes.json();
  const orders = ordJson?.results ?? [];

  const out = [];
  for (const o of orders) {
    const shipmentId = String(o?.shipping?.id ?? "").trim();
    let shipment: unknown = null;
    let costs: unknown = null;
    if (shipmentId) {
      const [rs, rc] = await Promise.all([
        fetch(`${ML_API}/shipments/${shipmentId}`, { headers, cache: "no-store" }),
        fetch(`${ML_API}/shipments/${shipmentId}/costs`, { headers, cache: "no-store" }),
      ]);
      shipment = { status: rs.status, body: await rs.json().catch(() => null) };
      costs = { status: rc.status, body: await rc.json().catch(() => null) };
    }
    out.push({
      order_id: String(o.id),
      total_amount: o.total_amount,
      shipping_id: shipmentId,
      shipment,
      costs,
    });
  }

  return { corpo: { count: out.length, orders: out } };
});
