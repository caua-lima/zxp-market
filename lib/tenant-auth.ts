import "server-only";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { capacidadesDoPapel, caminhoMembership, caminhoMembro, type PapelTenant, type TenantContext } from "@/lib/domain/tenant";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Resolve o `TenantContext` de uma requisição — a versão multi-tenant de
 * `requireAccess` (lib/api-auth.ts), que ainda é a autoridade pra tudo que
 * lê/escreve nas coleções globais legadas. Nenhuma rota chama isto ainda:
 * é a fundação (S01), construída ANTES de qualquer rota depender dela, pra
 * poder ser testada isolada.
 *
 * ─── POR QUE DUAS LEITURAS (memberships → tenants/{id}/members) ────────
 *
 * O Admin SDK não tem "dado embutido no token" pra tenant — o token do
 * Firebase só prova QUEM (uid/e-mail), não EM QUE TENANT. `memberships/{email}`
 * é o ponteiro (existe uma leitura curta, sem index composto, sem varrer
 * tenant nenhum) pro `tenantId`; a segunda leitura confirma o papel/versão
 * ATUAIS — nunca confiar no que uma sessão de até 1h de idade "lembra".
 *
 * Quando uma pessoa pertencer a mais de um tenant (fora do escopo de hoje:
 * cada negócio é um tenant, e ninguém trabalha pra dois ao mesmo tempo
 * nesta operação), `memberships/{email}` deixa de apontar pra UM tenantId e
 * a rota passa a exigir qual tenant a requisição quer — não é este arquivo
 * que muda, é o formato do ponteiro.
 */
export async function requireTenantAccess(req: Request): Promise<TenantContext | NextResponse> {
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

  const db = getAdminDb();
  const ponteiro = await db.doc(caminhoMembership(email)).get();
  const tenantId = ponteiro.exists ? (ponteiro.data() as { tenantId?: string } | undefined)?.tenantId : null;
  if (!tenantId) {
    return NextResponse.json({ error: "sem_tenant", details: "Este e-mail não pertence a nenhum tenant." }, { status: 403 });
  }

  const membroSnap = await db.doc(caminhoMembro(tenantId, email)).get();
  if (!membroSnap.exists) {
    // Ponteiro órfão: memberships apontava pra um tenant onde a pessoa não
    // está mais (removida, tenant apagado). Nunca confiar só no ponteiro.
    return NextResponse.json({ error: "sem_tenant", details: "Vínculo com o tenant não encontrado." }, { status: 403 });
  }

  const dados = membroSnap.data() as { role?: PapelTenant; permissoesEdicao?: string[]; membershipVersion?: number } | undefined;
  const papel: PapelTenant = dados?.role ?? "member";

  return {
    uid: decoded.uid,
    email,
    tenantId,
    papel,
    membershipVersion: Number(dados?.membershipVersion ?? 0),
    capabilities: capacidadesDoPapel(papel, dados?.permissoesEdicao ?? []),
  };
}
