import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { lerSenha, registrarVisualizacao } from "@/lib/senhas-cofre";

/**
 * "Ver senha" (pedido do dono, 23/11/2026).
 *
 * GET ?email=… — a própria senha: qualquer pessoa logada. A senha de OUTRA
 * pessoa: só quem administra (o Master). Cada visualização fica na trilha de
 * auditoria. Ver lib/senhas-cofre.ts.
 */
export async function GET(req: Request) {
  const alvo = String(new URL(req.url).searchParams.get("email") ?? "").trim().toLowerCase();
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  const propria = !alvo || alvo === gate.email.toLowerCase();
  if (!propria) {
    const admin = await requireAccess(req, { adminOnly: true });
    if (admin instanceof NextResponse) return admin;
  }
  const email = propria ? gate.email.toLowerCase() : alvo;
  const r = await lerSenha(email);
  if (r.situacao === "ok") await registrarVisualizacao(email, gate.email.toLowerCase());
  return NextResponse.json({ email, ...r }, { headers: { "Cache-Control": "private, no-store" } });
}
