/**
 * Assinatura da EMPRESA e o que ela libera (S25). Puro: sem Firestore, sem Stripe.
 *
 * A empresa é a unidade de assinatura. O estado mora em `tenants/{id}.assinatura`
 * e só o servidor grava — a partir do Stripe (webhook + busca canônica) ou do
 * trial local criado no cadastro da empresa.
 *
 * ─── A MÁQUINA DE ESTADOS ───────────────────────────────────────────────
 *
 *   interna ──────────────────────────────── (sem cobrança pelo app)
 *   trial ──(venceu sem assinar)──▶ trial_encerrado ⛔
 *     └──(checkout)──▶ incompleta ──(pagou)──▶ ativa ◀──(pagou)── inadimplente
 *                                                │                    │
 *                               (cobrança falhou)└──▶ carencia ──(N dias)┘⛔
 *   ativa ──(cancelou no fim do período)──▶ ativa com cancelaEm ──▶ cancelada ⛔
 *
 * ⛔ = bloqueada: LEITURA continua (e exportação), ESCRITA para. Nada é
 * apagado: voltar a pagar desbloqueia com tudo no lugar.
 *
 * O status do Stripe é a fonte (a página de sucesso do checkout NÃO libera
 * nada — só o webhook/reconciliação, depois de buscar a assinatura no Stripe).
 */
import { CATALOGO, type IdDoPlano } from "../../config/planos";

export type EstadoDaAssinatura =
  | "interna"
  | "trial"
  | "trial_encerrado"
  | "incompleta"
  | "ativa"
  | "carencia"
  | "inadimplente"
  | "cancelada";

/** O que fica gravado em `tenants/{id}.assinatura`. */
export type Assinatura = {
  plano: IdDoPlano;
  /** Estado vindo da fonte (Stripe ou trial local), antes de aplicar o relógio. */
  estado: EstadoDaAssinatura;
  /** Fim do teste grátis (ms). */
  trialAte?: number | null;
  /** Fim do período pago atual (ms). */
  periodoFim?: number | null;
  /** Quando a cobrança falhou pela primeira vez (ms) — começa a carência. */
  falhouEm?: number | null;
  /** Cancelamento agendado pro fim do período (ms). */
  cancelaEm?: number | null;
  clienteId?: string | null;
  assinaturaId?: string | null;
  /** Momento da leitura na fonte (ms) — só grava se for mais novo que o gravado. */
  sincronizadoEm?: number;
  versaoCatalogo?: number;
};

const DIA = 86_400_000;

export const BLOQUEADOS: readonly EstadoDaAssinatura[] = ["trial_encerrado", "inadimplente", "cancelada"];

/** Sem assinatura gravada = operação cadastrada fora do checkout: interna. */
export function assinaturaOuInterna(a: Assinatura | null | undefined): Assinatura {
  return a ?? { plano: "interno", estado: "interna" };
}

/** O estado AGORA: o gravado mais o relógio (trial que venceu, carência que acabou). */
export function estadoEfetivo(a: Assinatura | null | undefined, agora: number): EstadoDaAssinatura {
  const s = assinaturaOuInterna(a);
  if (s.estado === "trial" && s.trialAte != null && agora >= s.trialAte) return "trial_encerrado";
  if (s.estado === "carencia") {
    const inicio = s.falhouEm ?? s.periodoFim ?? agora;
    if (agora >= inicio + CATALOGO.carenciaDias * DIA) return "inadimplente";
  }
  return s.estado;
}

export function estaBloqueada(a: Assinatura | null | undefined, agora: number): boolean {
  return BLOQUEADOS.includes(estadoEfetivo(a, agora));
}

export type Direitos = {
  plano: IdDoPlano;
  estado: EstadoDaAssinatura;
  bloqueada: boolean;
  membros: number | null;
  conexoes: number | null;
};

export function direitosDaEmpresa(a: Assinatura | null | undefined, agora: number): Direitos {
  const s = assinaturaOuInterna(a);
  const estado = estadoEfetivo(s, agora);
  const plano = CATALOGO.planos[s.plano] ?? CATALOGO.planos.trial;
  return { plano: s.plano, estado, bloqueada: BLOQUEADOS.includes(estado), membros: plano.membros, conexoes: plano.conexoes };
}

/** Cabe mais uma pessoa? `atuais` conta o dono. */
export function podeAdicionarMembro(d: Direitos, atuais: number): boolean {
  if (d.bloqueada) return false;
  return d.membros == null || atuais < d.membros;
}

export function podeConectarConta(d: Direitos, atuais: number): boolean {
  if (d.bloqueada) return false;
  return d.conexoes == null || atuais < d.conexoes;
}

/** Trial local de uma empresa nova (cadastro self-service). */
export function trialNovo(agora: number): Assinatura {
  return { plano: "trial", estado: "trial", trialAte: agora + CATALOGO.trialDias * DIA, sincronizadoEm: agora, versaoCatalogo: CATALOGO.versao };
}

// ─── Do Stripe pro nosso estado ────────────────────────────────────────────

/** O pedaço da assinatura do Stripe que importa (lido de GET /v1/subscriptions/{id}). */
export type AssinaturaDoProvedor = {
  id: string;
  clienteId: string;
  /** trialing | active | incomplete | incomplete_expired | past_due | unpaid | canceled | paused */
  status: string;
  precoId: string | null;
  periodoFim: number | null;
  cancelaNoFimDoPeriodo: boolean;
  canceladaEm: number | null;
  trialFim: number | null;
  tenantId: string | null;
};

/** Plano pelo ID do preço, conferido contra as variáveis do catálogo. */
export function planoDoPreco(precoId: string | null, env: Record<string, string | undefined>): IdDoPlano | null {
  if (!precoId) return null;
  for (const [id, p] of Object.entries(CATALOGO.planos) as [IdDoPlano, { precoEnv?: string }][]) {
    if (p.precoEnv && env[p.precoEnv] === precoId) return id;
  }
  return null;
}

export function deStatusDoProvedor(
  sub: AssinaturaDoProvedor,
  anterior: Assinatura | null | undefined,
  opcoes: { agora: number; env: Record<string, string | undefined> },
): Assinatura {
  const plano = planoDoPreco(sub.precoId, opcoes.env) ?? (anterior?.plano && anterior.plano !== "interno" && anterior.plano !== "trial" ? anterior.plano : "essencial");
  const base = {
    plano,
    clienteId: sub.clienteId,
    assinaturaId: sub.id,
    periodoFim: sub.periodoFim,
    cancelaEm: sub.cancelaNoFimDoPeriodo ? sub.periodoFim : null,
    trialAte: sub.trialFim,
    sincronizadoEm: opcoes.agora,
    versaoCatalogo: CATALOGO.versao,
  };
  switch (sub.status) {
    case "trialing":
      return { ...base, estado: "trial", falhouEm: null };
    case "active":
      return { ...base, estado: "ativa", falhouEm: null };
    case "incomplete":
      return { ...base, estado: "incompleta", falhouEm: null };
    case "past_due":
      // A carência conta da PRIMEIRA falha: um retry que falha de novo não a renova.
      return { ...base, estado: "carencia", falhouEm: anterior?.estado === "carencia" && anterior.falhouEm ? anterior.falhouEm : opcoes.agora };
    case "unpaid":
    case "paused":
      return { ...base, estado: "inadimplente", falhouEm: anterior?.falhouEm ?? opcoes.agora };
    case "canceled":
    case "incomplete_expired":
    default:
      return { ...base, estado: "cancelada", cancelaEm: null };
  }
}

/** O marcador que as regras do Firestore leem pra travar a escrita (ver regras-tenant.ts). */
export function bloqueioPara(a: Assinatura | null | undefined, agora: number): { motivo: EstadoDaAssinatura; desde: number } | null {
  const estado = estadoEfetivo(a, agora);
  return BLOQUEADOS.includes(estado) ? { motivo: estado, desde: agora } : null;
}
