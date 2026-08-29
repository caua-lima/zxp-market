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
  return motivoRecusaDoCron(req) === null;
}

/**
 * Por que a chamada do cron foi recusada — `null` quando foi aceita.
 *
 * ─── POR QUE ISTO PRECISOU EXISTIR ──────────────────────────────────────
 *
 * `isCronRequest` devolvia `false` tanto pra "CRON_SECRET não configurado"
 * quanto pra "segredo errado", e o cron respondia um 401 mudo aos dois. São
 * problemas com correções OPOSTAS — um é configurar a variável na Vercel, o
 * outro é conferir o valor — e o 401 mudo não distinguia.
 *
 * O custo disso foi alto: sem a variável, a Vercel não injeta header nenhum,
 * o cron era recusado na porta todo dia e TODA automação pendurada nele
 * (backup semanal, marcos, alerta de estoque, lembrete de tarefa, aviso de
 * devolução) simplesmente nunca rodou — sem erro, sem log, sem sintoma além
 * da ausência.
 */
export function motivoRecusaDoCron(req: Request): "cron_secret_nao_configurado" | "segredo_invalido" | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "cron_secret_nao_configurado";
  const token = bearer(req) || req.headers.get("x-cron-secret");
  return token === secret ? null : "segredo_invalido";
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
  if (!snap.exists) {
    return NextResponse.json({ error: "forbidden", details: "Not authorized" }, { status: 403 });
  }

  // Qualquer papel que não seja "owner" é tratado como somente-leitura ("user").
  const role: AuthContext["role"] = snap.data()?.role === "owner" ? "owner" : "user";
  if (opts.adminOnly && role !== "owner") {
    return NextResponse.json({ error: "forbidden", details: "Owner only" }, { status: 403 });
  }

  return { email, uid: decoded.uid, role };
}
