/**
 * O plano de migração de `controleAcesso` pro modelo de tenant (S01/Etapa 5
 * — a primeira fatia: só membership, não dado de negócio). Puro, sem
 * Firestore — `scripts/migrar-tenant-legado.mjs` lê `controleAcesso`, chama
 * isto, e escreve o resultado (ou só mostra, no modo padrão).
 *
 * ─── POR QUE MEMBERSHIP PRIMEIRO, SOZINHO ────────────────────────────────
 *
 * Mesma lição de `ORDEM_DE_RESTAURACAO` (controleAcesso volta primeiro num
 * restore, senão ninguém entra pra conferir o resto): sem tenant e membro
 * migrados e VERIFICADOS, não faz sentido migrar produto, custo, meta — a
 * fundação de autorização vem antes do dado que ela protege.
 *
 * ─── SEM IMPORT DE ./types OU ./tenant, DE PROPÓSITO ────────────────────
 *
 * Este arquivo também é importado DIRETO por `scripts/migrar-tenant-legado.mjs`,
 * rodado com `node` puro — sem bundler, sem ts-node. A resolução nativa de
 * TS do Node exige caminho completo (`.ts`) em import relativo, e o `tsc`
 * deste projeto recusa extensão `.ts` no import (`allowImportingTsExtensions`
 * não está ligado). Mesmo padrão que `backup-inventario.ts`/`backup-serie.ts`
 * já seguem: um módulo pensado pra rodar direto via `node` fica
 * AUTOCONTIDO — sem import relativo nenhum — em vez de arrastar essa
 * exigência pro resto do grafo de módulos. O formato do papel é copiado
 * (3 linhas, ver `papelDe` em `lib/domain/types.ts`), não redefinido.
 */

/** Espelha `lib/domain/types.ts::Papel` — mantenha as duas em sincronia se o conjunto mudar. */
export type PapelTenant = "owner" | "partner" | "member";

/** Só os campos de `AccessEntry` (lib/domain/types.ts) que esta migração lê. */
export type AccessEntryMinima = { email: string; role: string; permissoesEdicao?: string[] };

/** Cópia de `papelDe` (lib/domain/types.ts) — mesma regra: só "owner" e "member" são literais, o resto é "partner". */
function papelDe(role: string | undefined | null): PapelTenant {
  if (role === "owner") return "owner";
  if (role === "member") return "member";
  return "partner";
}

export type MembroMigrado = {
  email: string;
  role: PapelTenant;
  permissoesEdicao?: string[];
  /** De onde veio — pra uma auditoria futura distinguir migrado de convidado depois do corte. */
  migradoDe: "controleAcesso";
};

export type PlanoMigracaoTenant = {
  tenantId: string;
  tenant: { name: string };
  membros: MembroMigrado[];
  memberships: { email: string; tenantId: string }[];
};

export function planoDeMigracaoDeMembros(
  acessos: readonly AccessEntryMinima[],
  args: { tenantId: string; nomeDoTenant: string },
): PlanoMigracaoTenant {
  const membros: MembroMigrado[] = acessos.map((a) => {
    const email = a.email.toLowerCase();
    const role = papelDe(a.role);
    // `permissoesEdicao` só entra quando existe e tem conteúdo — mesma
    // regra de sanitizeUndefined em lib/firebase/data.ts: campo ausente,
    // não campo vazio, é o que já significa "sem permissão granular" hoje.
    const permissoesEdicao = a.permissoesEdicao?.length ? a.permissoesEdicao : undefined;
    return {
      email,
      role,
      ...(permissoesEdicao ? { permissoesEdicao } : {}),
      migradoDe: "controleAcesso" as const,
    };
  });

  return {
    tenantId: args.tenantId,
    tenant: { name: args.nomeDoTenant },
    membros,
    memberships: membros.map((m) => ({ email: m.email, tenantId: args.tenantId })),
  };
}

/**
 * O que precisa ser verdade ANTES de aplicar o plano — não é uma opinião,
 * é o que a rota de bootstrap já garante pra `controleAcesso` (um único
 * owner) e o que `requireTenantAccess` vai assumir dali pra frente.
 */
export function validarPlano(plano: PlanoMigracaoTenant): string[] {
  const problemas: string[] = [];
  if (!plano.tenantId.trim()) problemas.push("tenantId vazio");
  if (plano.membros.length === 0) problemas.push("nenhum membro pra migrar — controleAcesso está vazio?");

  const owners = plano.membros.filter((m) => m.role === "owner");
  if (owners.length === 0) problemas.push("nenhum owner no plano — o tenant nasceria sem dono");
  if (owners.length > 1) {
    problemas.push(`${owners.length} owners no plano (${owners.map((o) => o.email).join(", ")}) — controleAcesso deveria ter só um`);
  }

  const emails = plano.membros.map((m) => m.email);
  const duplicados = emails.filter((e, i) => emails.indexOf(e) !== i);
  if (duplicados.length > 0) problemas.push(`e-mail duplicado no plano: ${[...new Set(duplicados)].join(", ")}`);

  return problemas;
}
