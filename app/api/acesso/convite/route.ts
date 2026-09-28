import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { caminhoDoTime } from "@/lib/empresas";

/**
 * Convite por e-mail (S24): garante que a pessoa CONVIDADA tem um login de
 * e-mail no Firebase — sem senha — pra a tela pedir ao Firebase o e-mail de
 * "criar senha" (sendPasswordResetEmail). O link vai pra caixa da própria
 * pessoa; o dono nunca vê nem define a senha dela.
 *
 * Mesma trava do S02: só pra quem já está no time da empresa de quem chama.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  const { email: bruto } = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(bruto ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "email_invalido" }, { status: 400 });

  const noTime = await getAdminDb().collection(caminhoDoTime()).doc(email).get();
  if (!noTime.exists) {
    return NextResponse.json({ error: "nao_convidado", details: "Adicione a pessoa em Acesso antes de enviar o convite." }, { status: 403 });
  }

  const auth = getAdminAuth();
  try {
    await auth.getUserByEmail(email);
    return NextResponse.json({ ok: true, criado: false });
  } catch {
    await auth.createUser({ email });
    return NextResponse.json({ ok: true, criado: true });
  }
}
