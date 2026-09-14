import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";
import { currentMonthRangeBR, syncOrdersRange } from "@/lib/ml/sync";

export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const accessToken = await getMlAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { error: "Token do Mercado Livre não encontrado ou expirado" },
        { status: 400 },
      );
    }

    const saved = await syncOrdersRange(accessToken, currentMonthRangeBR());
    return NextResponse.json({ ok: true, saved });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Falha ao sincronizar pedidos", details: msg }, { status: 500 });
  }
}
