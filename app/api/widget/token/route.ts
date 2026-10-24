import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { hashDoToken, novoToken } from "@/lib/domain/widget-token";
import { scriptDoWidget } from "@/lib/domain/widget-script";

/**
 * O código secreto do widget do iPhone (Scriptable). Gerar de novo REVOGA o
 * anterior — um por pessoa e por empresa. O código nunca fica guardado: só o
 * hash, então ele aparece UMA vez, aqui, junto do script pronto pra colar.
 * Vale o que a barra ao vivo já mostra a qualquer acesso (`ver_resumo`).
 */
const COLECAO = "widget_tokens";

async function apagarDe(email: string, tenantId: string | null) {
  const db = getAdminDb();
  const snap = await db.collection(COLECAO).where("email", "==", email).get();
  await Promise.all(snap.docs.filter((d) => (d.get("tenantId") ?? null) === tenantId).map((d) => d.ref.delete()));
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;
  const email = gate.email.toLowerCase();
  const tenantId = gate.tenantId ?? null;

  await apagarDe(email, tenantId);
  const token = novoToken();
  await getAdminDb().collection(COLECAO).doc(hashDoToken(token)).set({ email, tenantId, criadoEm: Date.now() });

  const url = `${new URL(req.url).origin}/api/widget/ao-vivo?t=${token}`;
  return NextResponse.json({ ok: true, url, script: scriptDoWidget(url) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;
  await apagarDe(gate.email.toLowerCase(), gate.tenantId ?? null);
  return NextResponse.json({ ok: true });
}
