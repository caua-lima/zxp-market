import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";

function buildRange(from?: string | null, to?: string | null) {
  if (from && to) {
    return { start: `${from}T00:00:00.000Z`, end: `${to}T23:59:59.999Z`, startBR: `${from}T00:00:00.000-03:00`, endBR: `${to}T23:59:59.999-03:00` };
  }
  const br = new Date(Date.now() - 3 * 3600 * 1000);
  const y = br.getUTCFullYear();
  const m = br.getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");
  const ld = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  return { start: `${y}-${mm}-01T00:00:00.000Z`, end: `${y}-${mm}-${ld}T23:59:59.999Z`, startBR: `${y}-${mm}-01T00:00:00.000-03:00`, endBR: `${y}-${mm}-${ld}T23:59:59.999-03:00` };
}

function bucket(status: string): "entregue" | "aCaminho" | "preparando" | "problema" | "outros" {
  if (status === "delivered") return "entregue";
  if (status === "shipped") return "aCaminho";
  if (["pending", "handling", "ready_to_ship"].includes(status)) return "preparando";
  if (["not_delivered", "cancelled"].includes(status)) return "problema";
  return "outros";
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const { start, end, startBR, endBR } = buildRange(url.searchParams.get("from"), url.searchParams.get("to"));
    const db = getAdminDb();

    const [snapUTC, snapBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const map = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) for (const doc of snap.docs) { const d = doc.data(); map.set(d.order_id ?? doc.id, d); }

    const resumo = { entregue: 0, aCaminho: 0, preparando: 0, problema: 0, outros: 0, total: 0 };
    const envios = Array.from(map.values())
      .filter((o) => String(o.shipping_status ?? "")) // só os que têm status sincronizado
      .map((o) => {
        const status = String(o.shipping_status ?? "");
        const b = bucket(status);
        resumo[b]++; resumo.total++;
        const items = (o.items as { title?: string }[]) ?? [];
        return {
          order_id: String(o.order_id ?? ""),
          data: String(o.date_created ?? "").slice(0, 10),
          produto: items.map((it) => it.title).filter(Boolean).join(", "),
          status, substatus: String(o.shipping_substatus ?? ""),
          bucket: b,
          logistic: String(o.logistic_type ?? ""),
          tracking: String(o.tracking ?? ""),
          estimated: String(o.estimated_delivery ?? "").slice(0, 10),
          entregaEm: String(o.date_delivered ?? "").slice(0, 10),
          valor: Number(o.total_amount ?? 0),
        };
      })
      .sort((a, b) => (b.data + b.order_id).localeCompare(a.data + a.order_id));

    return NextResponse.json({ envios, resumo });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "envios_failed", details: msg }, { status: 500 });
  }
}
