import "server-only";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { capacidadesDoPapel, caminhoMembership, caminhoMembro, type ConnectionContext, type PapelTenant, type TenantContext } from "@/lib/domain/tenant";

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

/**
 * `requireTenantAccess` mais a conexão ML ativa do tenant — pra rotas que
 * vão FALAR com o Mercado Livre (S03). Continua sem consumidor: a leitura
 * real do token de acesso e o refresh (achado S05, fencing) moram em
 * `lib/ml/token.ts`, que hoje resolve um ÚNICO token global — a migração
 * pra esta função ser CHAMADA de verdade é o corte que exige o script de
 * migração + ensaio, não uma troca de código isolada.
 *
 * ─── POR QUE "A conexão ativa", NÃO "a conexão" ─────────────────────────
 *
 * Um tenant pode ter zero (ainda não conectou o ML) ou, no futuro, mais de
 * uma conexão (duas contas ML na mesma empresa). Hoje a operação real tem
 * exatamente UMA — por isso a busca pega a primeira com `status: "active"`
 * e não pede `connectionId`. No dia em que existir mais de uma de verdade,
 * quem chama passa a precisar dizer QUAL, e essa mudança é no `opts` desta
 * função, não em cada rota que a usa.
 */
export async function requireConnectionAccess(
  req: Request,
  opts: { capacidade?: string } = {},
): Promise<ConnectionContext | NextResponse> {
  const tenantCtx = await requireTenantAccess(req);
  if (tenantCtx instanceof NextResponse) return tenantCtx;

  if (opts.capacidade && !tenantCtx.capabilities.has(opts.capacidade)) {
    return NextResponse.json({ error: "forbidden", details: `Falta a capacidade: ${opts.capacidade}` }, { status: 403 });
  }

  const db = getAdminDb();
  const conexoes = await db
    .collection(`tenants/${tenantCtx.tenantId}/connections`)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (conexoes.empty) {
    return NextResponse.json({ error: "sem_conexao", details: "Este tenant ainda não conectou o Mercado Livre." }, { status: 409 });
  }

  const conexao = conexoes.docs[0];
  const dados = conexao.data() as { sellerId?: string; siteId?: string; generation?: number };

  return {
    ...tenantCtx,
    connectionId: conexao.id,
    sellerId: String(dados.sellerId ?? ""),
    siteId: String(dados.siteId ?? "MLB"),
    generation: Number(dados.generation ?? 0),
  };
}
