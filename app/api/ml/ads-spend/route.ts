import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdsSpendByItem } from "@/lib/ml/ads";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "ver_financeiro" });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from"); // YYYY-MM-DD
    const to = url.searchParams.get("to"); // YYYY-MM-DD
    if (!from || !to) {
      return NextResponse.json({ error: "from e to são obrigatórios" }, { status: 400 });
    }

    const adsByItem = await getAdsSpendByItem(from, to);
    return NextResponse.json({ adsByItem, from, to });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "ads_spend_failed", details: msg }, { status: 500 });
  }
}
