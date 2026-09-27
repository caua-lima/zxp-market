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
  /** O owner que quem rodou escolheu com `--owner`, se escolheu. */
  ownerEscolhido: string | null;
  /** Quem era owner em `controleAcesso` e vira partner no tenant — pra aparecer na simulação. */
  rebaixados: string[];
};

/**
 * ─── DOIS OWNERS ─────────────────────────────────────────────────────────
 *
 * A produção tem DOIS registros `role: owner` em `controleAcesso` (visto em
 * 22/08/2026) — e o tenant precisa de exatamente um, porque é o owner que
 * administra time, conexão e cobrança. Sem `owner`, `validarPlano` recusa o
 * plano (em vez de escolher sozinho). Com ele, o escolhido é o owner e os
 * outros owners viram `partner`: continuam entrando, sem o poder de
 * administrar — e a simulação lista cada um como rebaixado, pra decisão
 * ficar à vista ANTES de qualquer escrita.
 */
export function planoDeMigracaoDeMembros(
  acessos: readonly AccessEntryMinima[],
  args: { tenantId: string; nomeDoTenant: string; owner?: string | null },
): PlanoMigracaoTenant {
  const escolhido = args.owner?.trim().toLowerCase() || null;
  const rebaixados: string[] = [];
  const membros: MembroMigrado[] = acessos.map((a) => {
    const email = a.email.toLowerCase();
    let role = papelDe(a.role);
    if (escolhido) {
      if (email === escolhido) role = "owner";
      else if (role === "owner") { role = "partner"; rebaixados.push(email); }
    }
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
    ownerEscolhido: escolhido,
    rebaixados,
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

  if (plano.ownerEscolhido && !plano.membros.some((m) => m.email === plano.ownerEscolhido)) {
    problemas.push(`o owner escolhido (${plano.ownerEscolhido}) não está em controleAcesso — confira o e-mail`);
  }
  const owners = plano.membros.filter((m) => m.role === "owner");
  if (owners.length === 0) problemas.push("nenhum owner no plano — o tenant nasceria sem dono");
  if (owners.length > 1) {
    problemas.push(
      `${owners.length} owners no plano (${owners.map((o) => o.email).join(", ")}) — o tenant precisa de um só; ` +
      "escolha com --owner <e-mail> (os outros viram partner)",
    );
  }

  const emails = plano.membros.map((m) => m.email);
  const duplicados = emails.filter((e, i) => emails.indexOf(e) !== i);
  if (duplicados.length > 0) problemas.push(`e-mail duplicado no plano: ${[...new Set(duplicados)].join(", ")}`);

  return problemas;
}

// ── sincronização contínua (Etapa 3) ─────────────────────────────────────

export type PlanoDeSincronizacao = {
  gravar: MembroMigrado[];
  /** E-mails que saíram de controleAcesso: perdem a empresa (membro e ponteiro). */
  remover: string[];
  problemas: string[];
};

/**
 * Depois da virada as regras autorizam por `tenants/{t}/members`, mas quem
 * administra o time ainda é a tela de Acesso, que grava `controleAcesso`. Sem
 * espelhar, quem fosse convidado depois não enxergaria nada — e, o pior, quem
 * fosse REMOVIDO continuaria lendo o dado da empresa pelas regras.
 *
 * O dono da empresa é o que já está em `members` com role owner: controleAcesso
 * pode ter mais de um owner (o caso da produção), e o tenant só um. Os outros
 * entram como partner, igual à primeira fatia.
 */
export function planoDeSincronizacao(
  acessos: readonly AccessEntryMinima[],
  membrosAtuais: readonly { email: string; role: string; permissoesEdicao?: string[] }[],
  tenantId: string,
): PlanoDeSincronizacao {
  const donos = membrosAtuais.filter((m) => m.role === "owner").map((m) => m.email.toLowerCase());
  const problemas: string[] = [];
  if (donos.length !== 1) problemas.push(`a empresa ${tenantId} tem ${donos.length} owner(s) em members — precisa de exatamente um`);
  const dono = donos[0] ?? null;

  const desejado = planoDeMigracaoDeMembros(acessos, { tenantId, nomeDoTenant: tenantId, owner: dono }).membros;
  const porEmail = new Map(membrosAtuais.map((m) => [m.email.toLowerCase(), m]));
  const iguais = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
    JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

  const gravar = desejado.filter((m) => {
    const atual = porEmail.get(m.email);
    return !atual || atual.role !== m.role || !iguais(atual.permissoesEdicao, m.permissoesEdicao);
  });
  const naLista = new Set(desejado.map((m) => m.email));
  const remover = membrosAtuais
    .map((m) => m.email.toLowerCase())
    .filter((e) => !naLista.has(e))
    // O dono não sai por sincronização: sem ele a empresa fica sem quem administre.
    .filter((e) => {
      if (e === dono) { problemas.push(`o owner ${e} não está em controleAcesso — mantido na empresa`); return false; }
      return true;
    });
  if (dono && !naLista.has(dono) && problemas.every((p) => !p.includes(dono))) problemas.push(`o owner ${dono} não está em controleAcesso`);
  return { gravar, remover, problemas };
}
