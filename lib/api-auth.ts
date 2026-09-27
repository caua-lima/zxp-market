import "server-only";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { podeCapacidade, type Capacidade } from "@/lib/domain/capacidades";
import { papelDe, type Papel, type PermissionTab } from "@/lib/domain/types";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { abrirContextoDaRequisicao } from "@/lib/firebase/contexto-tenant";

/**
 * De onde vem a autorização de quem chama.
 *
 * Modo raiz (hoje): `controleAcesso`, a lista única da operação.
 *
 * Modo empresa (segundo cliente): o ponteiro `memberships/{email}` diz a
 * empresa, e o registro `tenants/{t}/members/{email}` diz o papel — nunca o
 * ponteiro sozinho (pode estar órfão). Achada a empresa, a requisição ENTRA
 * nela (contexto-tenant.ts): todo acesso ao banco dali em diante vai pro dado
 * dessa empresa, e de nenhuma outra.
 */
async function lerAcesso(email: string, definirEmpresa: (t: string) => void): Promise<{ dados: Record<string, unknown>; tenantId: string | null } | null> {
  const db = getAdminDb();
  if (lerModoDeDados() === "raiz") {
    const snap = await db.collection("controleAcesso").doc(email).get();
    return snap.exists ? { dados: snap.data() ?? {}, tenantId: null } : null;
  }
  const ponteiro = await db.doc(`memberships/${email}`).get();
  const tenantId = String(ponteiro.data()?.tenantId ?? "").trim();
  if (!tenantId) return null;
  const membro = await db.doc(`tenants/${tenantId}/members/${email}`).get();
  if (!membro.exists) return null;
  definirEmpresa(tenantId);
  return { dados: membro.data() ?? {}, tenantId };
}

export type AuthContext = {
  email: string;
  uid: string;
  /**
   * Mantido por compatibilidade com quem já lia `gate.role`. Prefira `papel`
   * ou `pode()`: este campo achata partner e member no mesmo "user", que foi
   * exatamente a origem do vazamento corrigido aqui.
   */
  role: "owner" | "user";
  papel: Papel;
  permissoesEdicao: PermissionTab[];
  /** A matriz única de capacidades — ver lib/domain/capacidades.ts. */
  pode: (cap: Capacidade) => boolean;
  /** A empresa de quem chama (modo empresa). `null` no modo raiz e no cron. */
  tenantId?: string | null;
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
 * Verifica o ID token do Firebase, confirma que o e-mail está autorizado em
 * `controleAcesso` e — quando `capacidade` é pedida — que o papel realmente
 * alcança aquilo. Retorna o contexto autenticado ou um NextResponse de erro
 * (401/403), que o handler deve repassar.
 *
 * ─── POR QUE A CAPACIDADE É EXPLÍCITA ───────────────────────────────────
 *
 * Antes existiam dois papéis aqui — `owner` e `user` — e todo papel diferente
 * de owner virava `user`. Com isso a restrição de `member` (que existe pra
 * NÃO ver custo, margem, preço nem estoque) desaparecia no servidor: as
 * regras do Firestore barravam a leitura direta da coleção, mas a rota de
 * métricas respondia faturamento, CMV e margem pro member.
 *
 * Esconder campo no frontend não corrige isso — a resposta da API é pública
 * pra quem tem o token. Por isso cada handler declara a capacidade que exige,
 * e quem não a tem recebe 403 antes de qualquer consulta cara.
 *
 * Uso:
 *   const gate = await requireAccess(req, { capacidade: "ver_financeiro" });
 *   if (gate instanceof NextResponse) return gate;
 */
export async function requireAccess(
  req: Request,
  opts: {
    /** Atalho histórico pra `capacidade: "administrar"`. */
    adminOnly?: boolean;
    allowCron?: boolean;
    capacidade?: Capacidade;
  } = {},
): Promise<AuthContext | NextResponse> {
  // Antes de QUALQUER await — ver abrirContextoDaRequisicao.
  const definirEmpresa = abrirContextoDaRequisicao();
  const exigida: Capacidade | undefined = opts.capacidade ?? (opts.adminOnly ? "administrar" : undefined);

  // Bypass para jobs automatizados (sincronização agendada).
  if (opts.allowCron && isCronRequest(req)) {
    // Chamada interna do cron (ex.: marcos consultando /api/ml/metrics) leva a
    // empresa no cabeçalho — vale SÓ junto com o segredo do cron, então não é
    // um jeito de um usuário escolher a empresa.
    const empresa = req.headers.get("x-zxp-tenant");
    if (empresa) definirEmpresa(empresa);
    return {
      email: "cron@system",
      uid: "cron",
      role: "owner",
      papel: "owner",
      permissoesEdicao: [],
      pode: () => true,
    };
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

  const acesso = await lerAcesso(email, definirEmpresa);
  if (!acesso) {
    return NextResponse.json({ error: "forbidden", details: "Not authorized" }, { status: 403 });
  }

  const dados = acesso.dados;
  const papel = papelDe(dados.role as Parameters<typeof papelDe>[0]);
  const permissoesEdicao: PermissionTab[] = Array.isArray(dados.permissoesEdicao) ? dados.permissoesEdicao : [];
  const pode = (cap: Capacidade) => podeCapacidade(papel, permissoesEdicao, cap);

  if (exigida && !pode(exigida)) {
    return NextResponse.json(
      { error: "forbidden", details: `Requer capacidade: ${exigida}`, capacidade: exigida },
      { status: 403 },
    );
  }

  return {
    email,
    uid: decoded.uid,
    // Compatibilidade: quem ainda lê `role` continua vendo owner/user.
    role: papel === "owner" ? "owner" : "user",
    papel,
    permissoesEdicao,
    pode,
    tenantId: acesso.tenantId,
  };
}
