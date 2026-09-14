import "server-only";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { podeCapacidade, type Capacidade } from "@/lib/domain/capacidades";
import { papelDe, type Papel, type PermissionTab } from "@/lib/domain/types";

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
  const exigida: Capacidade | undefined = opts.capacidade ?? (opts.adminOnly ? "administrar" : undefined);

  // Bypass para jobs automatizados (sincronização agendada).
  if (opts.allowCron && isCronRequest(req)) {
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

  const snap = await getAdminDb().collection("controleAcesso").doc(email).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "forbidden", details: "Not authorized" }, { status: 403 });
  }

  const dados = snap.data() ?? {};
  const papel = papelDe(dados.role);
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
  };
}
