import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { hashDoToken, novoToken } from "@/lib/domain/widget-token";
import { scriptDoWidget } from "@/lib/domain/widget-script";
import { scriptDaVigiaFull } from "@/lib/domain/vigia-script";

/**
 * O código secreto do widget do iPhone (Scriptable). Gerar de novo REVOGA o
 * anterior — um por pessoa e por empresa. O código nunca fica guardado: só o
 * hash, então ele aparece UMA vez, aqui, junto do script pronto pra colar.
 * Vale o que a barra ao vivo já mostra a qualquer acesso (`ver_resumo`).
 */
const COLECAO = "widget_tokens";

/** "painel" (widget do placar) ou "vigia" (Vigia Full): gerar um não revoga o outro. */
type Uso = "painel" | "vigia";
const usoDe = (req: Request): Uso => (new URL(req.url).searchParams.get("uso") === "vigia" ? "vigia" : "painel");

async function apagarDe(email: string, tenantId: string | null, uso: Uso) {
  const db = getAdminDb();
  const snap = await db.collection(COLECAO).where("email", "==", email).get();
  await Promise.all(snap.docs
    .filter((d) => (d.get("tenantId") ?? null) === tenantId && (d.get("uso") ?? "painel") === uso)
    .map((d) => d.ref.delete()));
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;
  const email = gate.email.toLowerCase();
  const tenantId = gate.tenantId ?? null;

  const uso = usoDe(req);
  await apagarDe(email, tenantId, uso);
  const token = novoToken();
  await getAdminDb().collection(COLECAO).doc(hashDoToken(token)).set({ email, tenantId, uso, criadoEm: Date.now() });

  const origem = new URL(req.url).origin;
  const url = uso === "vigia" ? `${origem}/api/widget/vigias?t=${token}` : `${origem}/api/widget/ao-vivo?t=${token}`;
  const script = uso === "vigia" ? scriptDaVigiaFull(origem, token) : scriptDoWidget(url);
  return NextResponse.json({ ok: true, url, script }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;
  await apagarDe(gate.email.toLowerCase(), gate.tenantId ?? null, usoDe(req));
  return NextResponse.json({ ok: true });
}
