import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";

/**
 * A empresa de quem está logado (segundo cliente). O navegador não lê
 * `memberships` (as regras fecham), então pergunta aqui no login e passa a
 * montar os caminhos do dado dessa empresa. No modo raiz, `tenantId` é null.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ email: gate.email, papel: gate.papel, tenantId: gate.tenantId ?? null });
}
