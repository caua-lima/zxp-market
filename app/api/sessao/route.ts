import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * A empresa de quem está logado (segundo cliente). O navegador não lê
 * `memberships` (as regras fecham), então pergunta aqui no login e passa a
 * montar os caminhos do dado dessa empresa. No modo raiz, `tenantId` é null.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  // S24: o nome da empresa, pra tela não dizer o nome de outra loja.
  const nomeDaEmpresa = gate.tenantId ? String((await getAdminDb().doc(`tenants/${gate.tenantId}`).get()).data()?.name ?? "") || null : null;
  return NextResponse.json({ email: gate.email, papel: gate.papel, tenantId: gate.tenantId ?? null, nomeDaEmpresa });
}
