import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

/**
 * Cria (ou atualiza a senha de) um usuário de login por e-mail/senha.
 * Somente admin. O acesso em si é controlado pela coleção controleAcesso.
 *
 * ─── S02 DA AUDITORIA SAAS (P0) ─────────────────────────────────────────
 *
 * `getUserByEmail(email)` busca em TODO o Firebase Auth do projeto — não só
 * entre quem tem acesso a este app. Um owner podia resetar a senha de
 * QUALQUER identidade do projeto (inclusive de outro owner) só sabendo o
 * e-mail, sem essa pessoa ter pedido nem consentido nada. Hoje, com um app
 * single-tenant, o alcance prático já é ruim (colega derruba colega). No dia
 * em que virar multi-tenant, sem esta trava o owner da empresa A reseta a
 * senha do owner da empresa B — cada Firebase Auth é compartilhado entre
 * todos os tenants do projeto, e nada aqui olhava pra isso.
 *
 * A trava: o alvo já precisa estar em `controleAcesso` — a fila real
 * (`AccessControlTab.tsx`) já grava lá ANTES de chamar esta rota, então
 * nenhum fluxo legítimo muda. O que fica impossível é usar esta rota pra
 * tocar um e-mail que nunca passou pelo convite de um owner.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || password.length < 6) {
      return NextResponse.json({ error: "E-mail e senha (mínimo 6 caracteres) são obrigatórios." }, { status: 400 });
    }

    const acesso = await getAdminDb().collection("controleAcesso").doc(email).get();
    if (!acesso.exists) {
      return NextResponse.json(
        { error: "nao_convidado", details: "Este e-mail ainda não foi adicionado em Acesso. Convide primeiro, depois defina a senha." },
        { status: 403 },
      );
    }

    const auth = getAdminAuth();
    try {
      const existing = await auth.getUserByEmail(email);
      await auth.updateUser(existing.uid, { password });
      return NextResponse.json({ ok: true, updated: true });
    } catch {
      await auth.createUser({ email, password, emailVerified: true });
      return NextResponse.json({ ok: true, created: true });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "create_user_failed", details: msg }, { status: 500 });
  }
}
