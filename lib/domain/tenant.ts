/**
 * O modelo de tenant — S01 da auditoria SaaS.
 *
 * Contratos puros, sem I/O: quem resolve isto de verdade (servidor, via
 * Admin SDK) é `lib/tenant-auth.ts`. Aqui só o formato e as regras que não
 * precisam tocar o Firestore pra existir — o que dá pra testar em
 * milissegundos, sem emulador.
 *
 * ─── POR QUE `membershipVersion`/`generation` ──────────────────────────
 *
 * Um token de sessão (o ID token do Firebase) pode durar até uma hora. Se o
 * owner remove um membro ou rebaixa o papel dele NO MEIO desse tempo, o
 * token antigo continua "válido" pro Firebase Auth — mas o CONTEXTO de
 * autorização (papel, capacidades) mudou. `membershipVersion` é o que deixa
 * o servidor perceber isso a cada request (compara a versão do token/cache
 * contra a versão atual do documento de membership) em vez de confiar cego
 * no que veio embutido na sessão. `generation` em `ConnectionContext` é a
 * mesma ideia pra uma conexão ML: reconectar (trocar de conta ML) precisa
 * invalidar imediatamente qualquer job ou cache que ainda pense que é a
 * conexão antiga — achado direto do S03/S05 (fencing de token).
 */

export type PapelTenant = "owner" | "partner" | "member";

/**
 * O que qualquer rota de servidor recebe depois de `requireTenantAccess`.
 * `capabilities` é um conjunto (não um papel só) porque granular por aba já
 * existe hoje (`PermissionTab` em lib/domain/types.ts) — o tenant não pode
 * regredir isso pra um modelo mais grosso.
 */
export type TenantContext = {
  uid: string;
  email: string;
  tenantId: string;
  papel: PapelTenant;
  membershipVersion: number;
  capabilities: ReadonlySet<string>;
};

/** `TenantContext` mais o que uma rota que fala com o Mercado Livre precisa. */
export type ConnectionContext = TenantContext & {
  connectionId: string;
  sellerId: string;
  siteId: string;
  generation: number;
};

/**
 * O que se sabe sobre a FRESCURA de um dado que depende de sincronização
 * externa (pedidos, reputação, estoque do Full) — não é status HTTP, é
 * status de CONTEÚDO: "os dados que você está vendo são de quando?"
 *
 * Existe pra substituir o padrão atual de cada painel ter seu próprio
 * "carregando"/"erro"/"desatualizado" com regra própria (achado S10 —
 * reputação fragmentada — e a base do que a Etapa 4 precisa pra jobs e
 * snapshots).
 */
export type SourceState = {
  status: "fresh" | "stale" | "partial" | "unavailable" | "empty";
  fetchedAt: string | null;
  sourceUpdatedAt: string | null;
  connectionGeneration: number;
  coverage: { from: string; to: string; complete: boolean } | null;
  lastSuccessAt: string | null;
  errorCode: string | null;
};

/**
 * Capacidades — mesma ideia de `lib/domain/capacidades.ts` (`podeCapacidade`),
 * só que expressa como strings soltas em vez de um enum fechado, porque um
 * tenant pode ter capacidades que o modelo de papel único (owner/partner/
 * member) de hoje não previa (ex.: um papel "financeiro" que só a DRE).
 * Convertida a partir do papel + permissões granulares no momento da
 * resolução — ver `capacidadesDoPapel`.
 */
const CAPACIDADES_POR_PAPEL: Record<PapelTenant, readonly string[]> = {
  owner: ["tenant:administrar", "membros:gerir", "conexoes:gerir", "billing:gerir", "dados:editar-tudo"],
  partner: ["dados:ler"],
  member: ["dados:ler-restrito"],
};

/**
 * As capacidades de um papel, mais as permissões granulares por aba
 * (mesmo campo `permissoesEdicao` que `controleAcesso` já usa) traduzidas
 * pro formato `dados:editar:<aba>`.
 */
export function capacidadesDoPapel(papel: PapelTenant, permissoesEdicao: readonly string[] = []): ReadonlySet<string> {
  const base = new Set<string>(CAPACIDADES_POR_PAPEL[papel]);
  if (papel !== "member") {
    for (const aba of permissoesEdicao) base.add(`dados:editar:${aba}`);
  }
  return base;
}

// ─── Caminhos do Firestore ───────────────────────────────────────────────
// Centralizados aqui — não espalhados em template strings pelo app — pra
// uma mudança de convenção (ex.: trocar `members` por `membros`) não virar
// uma busca-e-substitui arriscada por dezenas de arquivos.

export function caminhoTenant(tenantId: string): string {
  return `tenants/${tenantId}`;
}

export function caminhoMembro(tenantId: string, email: string): string {
  return `tenants/${tenantId}/members/${email.toLowerCase()}`;
}

export function caminhoConexao(tenantId: string, connectionId: string): string {
  return `tenants/${tenantId}/connections/${connectionId}`;
}

/** O ponteiro reverso e-mail → tenant. Só o servidor lê (ver firestore.rules). */
export function caminhoMembership(email: string): string {
  return `memberships/${email.toLowerCase()}`;
}

/** Uma coleção de dado de negócio (produtos, custos, metas...) já escopada pro tenant. */
export function caminhoColecaoDoTenant(tenantId: string, colecao: string): string {
  return `tenants/${tenantId}/${colecao}`;
}
