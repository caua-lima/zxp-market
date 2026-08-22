/**
 * Quais tenants o cron sincroniza, e quando ele para.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * O cron nasceu single-tenant: pegava o único tenant e rodava. Com o segundo
 * cliente ele passava a RECUSAR (ver resolverTenantDaRequisicao em
 * lib/tenant.ts) — trava deliberada, porque escolher o tenant errado seria
 * pior que não rodar. Este módulo é o que destrava, e traz duas decisões que
 * não existiam quando havia um cliente só:
 *
 * 1. QUEM RODA. Cliente com licença vencida ou suspensa não deve consumir
 *    chamada da API do Mercado Livre nem cota do Firestore: ele nem consegue
 *    abrir o painel. Sincronizar para ele é gastar por dado que ninguém vai
 *    ver.
 *
 * 2. QUANDO PARAR. O cron tem 60s de teto na Vercel, e cada tenant faz várias
 *    chamadas ao ML. Com clientes suficientes a função morre no meio — e o
 *    pior é COMO ela morre: sem controle, o corte cai sempre nos mesmos
 *    últimos da lista, que nunca sincronizam e ninguém percebe. Parar por
 *    orçamento de tempo, de propósito e com registro, troca uma falha
 *    silenciosa por uma informação.
 *
 * Puro: nada de Firestore nem de rede aqui, só as regras.
 */

export type LicencaTenant = {
  /** "ativo" | "suspenso" | outro. Ausente conta como ativo (compat). */
  status?: string | null;
  /** Vencimento em ms. null/ausente = sem prazo. */
  expiresAt?: number | null;
};

export type DecisaoSync =
  | { roda: true }
  | { roda: false; motivo: string };

/**
 * A licença permite sincronizar?
 *
 * Espelha `licencaAtiva()` do firestore.rules.saas de propósito: se as duas
 * divergirem, existe um estado em que o cron sincroniza dados que o cliente
 * não consegue ler — trabalho invisível, e conta de Firestore subindo por
 * nada.
 */
export function licencaPermiteSync(lic: LicencaTenant | null | undefined, agora = Date.now()): DecisaoSync {
  // Sem licença nenhuma: não é cliente ativo. Pode ser tenant criado pela
  // migração antes do modelo comercial existir — não é erro, só não roda.
  if (!lic) return { roda: false, motivo: "sem licença" };

  const status = String(lic.status ?? "ativo").trim().toLowerCase();
  if (status === "suspenso") return { roda: false, motivo: "licença suspensa" };

  const exp = lic.expiresAt;
  if (exp != null && Number.isFinite(exp) && exp <= agora) {
    return { roda: false, motivo: `licença vencida em ${new Date(exp).toLocaleDateString("pt-BR")}` };
  }

  return { roda: true };
}

/**
 * Margem antes do teto da função. Se sobra menos que isto, não vale começar
 * outro tenant: começar e ser cortado no meio é pior que não começar — deixa
 * escrita parcial e nenhum registro de que ficou pela metade.
 *
 * 12s cobre com folga o ciclo de um tenant (pedidos + devoluções + claims dos
 * dois meses) na medição desta conta.
 */
export const MARGEM_SEGURANCA_MS = 12_000;

/**
 * Ainda dá tempo de processar mais um tenant?
 *
 * `limiteMs` é o teto da função (maxDuration). A conta é sobre o tempo já
 * gasto, não sobre quantos tenants faltam: um cliente com muito pedido demora
 * mais que outro, e estimar por contagem erraria justamente nos maiores.
 */
export function cabeMaisUm(inicioMs: number, agoraMs: number, limiteMs: number, margemMs = MARGEM_SEGURANCA_MS): boolean {
  const gasto = agoraMs - inicioMs;
  return gasto + margemMs < limiteMs;
}

export type TenantParaSync = { tenantId: string; email: string; licenca: LicencaTenant | null };

export type PlanoSync = {
  /** Os que devem rodar, na ordem em que devem rodar. */
  rodar: TenantParaSync[];
  /** Os que ficam de fora agora, com o porquê — nunca some sem explicação. */
  pulados: { tenantId: string; motivo: string }[];
};

/**
 * Monta o plano de execução: quem roda e quem fica de fora.
 *
 * `ultimoSincronizado` faz o RODÍZIO. Sem ele, a lista sai sempre na mesma
 * ordem e, quando o tempo acaba, são sempre os mesmos do fim que ficam sem
 * sincronizar — para eles o cron simplesmente nunca existiu. Começando pelo
 * seguinte ao último atendido, o corte anda pela lista e todo mundo é
 * atendido em alguma rodada.
 */
export function planejarSync(
  tenants: TenantParaSync[],
  agora = Date.now(),
  ultimoSincronizado?: string | null,
): PlanoSync {
  const pulados: { tenantId: string; motivo: string }[] = [];
  const elegiveis: TenantParaSync[] = [];

  // Ordem estável (por id) antes do rodízio: sem isso a ordem viria do
  // Firestore e mudaria entre execuções, quebrando o rodízio.
  const ordenados = [...tenants].sort((a, b) => a.tenantId.localeCompare(b.tenantId));

  for (const t of ordenados) {
    const d = licencaPermiteSync(t.licenca, agora);
    if (d.roda) elegiveis.push(t);
    else pulados.push({ tenantId: t.tenantId, motivo: d.motivo });
  }

  if (!ultimoSincronizado || elegiveis.length === 0) return { rodar: elegiveis, pulados };

  const i = elegiveis.findIndex((t) => t.tenantId === ultimoSincronizado);
  // Não achou (tenant saiu, ou licença venceu): começa do topo.
  if (i < 0) return { rodar: elegiveis, pulados };

  const rodar = [...elegiveis.slice(i + 1), ...elegiveis.slice(0, i + 1)];
  return { rodar, pulados };
}
