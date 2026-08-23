import "server-only";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export type AuthContext = {
  email: string;
  uid: string;
  role: "owner" | "user"; // admin foi removido; papéis legados viram "user"
};

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Permite chamadas automatizadas (cron/jobs) via segredo compartilhado.
 * Retorna true quando o header casa com CRON_SECRET.
 */
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const token = bearer(req) || req.headers.get("x-cron-secret");
  return token === secret;
}

/**
 * Verifica o ID token do Firebase enviado pelo cliente e confirma que o e-mail
 * está autorizado na coleção `controleAcesso`. Retorna o contexto autenticado
 * ou um NextResponse de erro (401/403) — o handler deve repassar esse response.
 *
 * Uso:
 *   const gate = await requireAccess(req);
 *   if (gate instanceof NextResponse) return gate;
 *   // gate.email, gate.role disponíveis
 */
export async function requireAccess(
  req: Request,
  opts: { adminOnly?: boolean; allowCron?: boolean } = {},
): Promise<AuthContext | NextResponse> {
  // Bypass para jobs automatizados (sincronização agendada)
  if (opts.allowCron && isCronRequest(req)) {
    return { email: "cron@system", uid: "cron", role: "owner" };
  }

  const idToken = bearer(req);
  if (!idToken) {
    return NextResponse.json({ error: "unauthorized", details: "Missing token" }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "unauthorized", details: "Invalid token" }, { status: 401 });
  }

  const email = (decoded.email || "").toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "forbidden", details: "No email in token" }, { status: 403 });
  }

  const snap = await getAdminDb().collection("controleAcesso").doc(email).get();

  let role: AuthContext["role"];
  if (snap.exists) {
    // Qualquer papel que não seja "owner" é tratado como somente-leitura ("user").
    role = snap.data()?.role === "owner" ? "owner" : "user";
  } else {
    // Cliente do SaaS não tem entrada em `controleAcesso` — essa coleção é
    // legada e global, criada antes do modelo multi-tenant existir. Quem foi
    // criado pelo painel master só tem vínculo em `tenant_membros`, então é
    // aí que caímos antes de negar (ver o mesmo desdobramento em
    // components/tabs/AccessGuard.tsx). Sem isto, NENHUM cliente criado pelo
    // SaaS conseguia chamar rota nenhuma — 403 em tudo, sempre.
    const membro = await getAdminDb().collection("tenant_membros").doc(decoded.uid).get();
    if (!membro.exists) {
      return NextResponse.json({ error: "forbidden", details: "Not authorized" }, { status: 403 });
    }
    role = membro.data()?.papel === "owner" ? "owner" : "user";
  }

  if (opts.adminOnly && role !== "owner") {
    return NextResponse.json({ error: "forbidden", details: "Owner only" }, { status: 403 });
  }

  return { email, uid: decoded.uid, role };
}
