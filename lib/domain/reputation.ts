/**
 * Leitura da reputação do vendedor (seller_reputation, já vem de graça em
 * app/api/ml/account/route.ts → user.seller_reputation). Nada aqui bate em
 * API — só interpreta o que o Mercado Livre devolve.
 *
 * O ML não documenta publicamente os critérios exatos pra subir de selo
 * (Mercado Líder → Gold → Platinum): por isso mostramos o nível ATUAL e o
 * NOME do próximo degrau, sem inventar % de progresso.
 */

export type SellerReputationMetricEntry = {
  period?: string;
  rate?: number;
  value?: number;
};

export type SellerReputationMetrics = {
  claims?: SellerReputationMetricEntry;
  delayed_handling_time?: SellerReputationMetricEntry;
  cancellations?: SellerReputationMetricEntry;
};

export type SellerReputation = {
  level_id?: string | null;
  power_seller_status?: string | null;
  transactions?: {
    completed?: number;
    canceled?: number;
    ratings?: { positive?: number; negative?: number; neutral?: number };
  } | null;
  metrics?: SellerReputationMetrics | null;
};

export const METRIC_LABELS: Record<keyof SellerReputationMetrics, string> = {
  claims: "Reclamações",
  delayed_handling_time: "Atraso no envio",
  cancellations: "Cancelamentos por você",
};

/** `rate` da API vem em formato decimal (0 a 1) — converte pra percentual exibível. */
export function formatTaxaDecimal(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${(v * 100).toFixed(1)}%`;
}

const LEVEL_META: Record<string, { label: string; cor: string }> = {
  "5_green": { label: "Verde — melhor nível", cor: "var(--green)" },
  "4_light_green": { label: "Verde claro", cor: "var(--green)" },
  "3_yellow": { label: "Amarelo — atenção", cor: "var(--yellow)" },
  "2_orange": { label: "Laranja — atenção", cor: "#F4B942" },
  "1_red": { label: "Vermelho — crítico", cor: "var(--red)" },
};

export function getReputationLevelMeta(levelId: string | null | undefined): { label: string; cor: string } {
  if (!levelId) return { label: "Sem nível calculado ainda", cor: "var(--muted)" };
  return LEVEL_META[levelId] ?? { label: levelId, cor: "var(--muted)" };
}

const POWER_SELLER_META: Record<string, { label: string; ordem: number }> = {
  silver: { label: "Mercado Líder", ordem: 1 },
  gold: { label: "Mercado Líder Gold", ordem: 2 },
  platinum: { label: "Mercado Líder Platinum", ordem: 3 },
};

const PROXIMO_DEGRAU = ["Mercado Líder", "Mercado Líder Gold", "Mercado Líder Platinum"];

export function getPowerSellerLabel(status: string | null | undefined): string {
  if (!status) return "Ainda sem selo de Mercado Líder";
  return POWER_SELLER_META[status]?.label ?? status;
}

export function getPowerSellerOrdem(status: string | null | undefined): number {
  if (!status) return 0;
  return POWER_SELLER_META[status]?.ordem ?? 0;
}

/** Nome do próximo degrau, ou null se já está no topo (Platinum). */
export function getProximoNivelLabel(status: string | null | undefined): string | null {
  const ordem = getPowerSellerOrdem(status);
  return ordem >= 3 ? null : PROXIMO_DEGRAU[ordem];
}

/**
 * Tetos de cada métrica, como o Seller Center os apresenta.
 *
 * ─── POR QUE O LIMITE IMPORTA MAIS QUE A TAXA ───────────────────────────
 *
 * "Reclamações 0%" sozinho não diz nada: não dá pra saber se 0,5% seria
 * tranquilo ou já problema. O painel do Mercado Livre sempre mostra a taxa
 * AO LADO do teto ("Abaixo de 2% permitido"), e é a distância entre os dois
 * que informa. Sem o teto, o número vira decoração.
 *
 * O segundo teto é o de MercadoLíder, sempre mais apertado — é ele que
 * transforma "estou bem" em "estou bem, mas ainda não o suficiente pro selo".
 *
 * Valores conferidos contra o painel da conta em 23/08/2026: reclamações
 * 2%/1%, cancelamentos 1,5%/0,5%, atraso no envio 10%/6%.
 */
export type LimiteMetrica = {
  /** Teto pra manter a cor verde, em % (não decimal). */
  permitido: number;
  /** Teto mais apertado, exigido pra ser MercadoLíder. */
  mercadoLider: number;
};

export const METRIC_LIMITES: Record<keyof SellerReputationMetrics, LimiteMetrica> = {
  claims: { permitido: 2, mercadoLider: 1 },
  cancellations: { permitido: 1.5, mercadoLider: 0.5 },
  delayed_handling_time: { permitido: 10, mercadoLider: 6 },
};

export type SituacaoMetrica = "ok" | "atencao" | "estourado" | "indisponivel";

/**
 * Onde a taxa está em relação aos dois tetos.
 *
 * `atencao` é a faixa entre o limite de MercadoLíder e o permitido: a conta
 * está saudável, mas aquele número é o que impede o selo. Sem esse degrau, a
 * tela mostraria "ok" até o momento em que a cor cai — tarde demais pra agir.
 *
 * `rate` chega em decimal (0 a 1), como a API devolve.
 */
export function situacaoDaMetrica(
  chave: keyof SellerReputationMetrics,
  rate: number | null | undefined,
): SituacaoMetrica {
  if (rate == null || !Number.isFinite(rate)) return "indisponivel";
  const lim = METRIC_LIMITES[chave];
  if (!lim) return "indisponivel";
  const pct = rate * 100;
  if (pct > lim.permitido) return "estourado";
  if (pct > lim.mercadoLider) return "atencao";
  return "ok";
}

export const SITUACAO_COR: Record<SituacaoMetrica, string> = {
  ok: "var(--green)",
  atencao: "var(--warning)",
  estourado: "var(--red)",
  indisponivel: "var(--muted)",
};

/**
 * Os cinco degraus de cor do Mercado Livre, do pior pro melhor — a barra que
 * o vendedor reconhece de cara no painel deles.
 */
export const CORES_NIVEL = [
  { id: "1_red", cor: "#f5b7c0" },
  { id: "2_orange", cor: "#fadfb4" },
  { id: "3_yellow", cor: "#f5eeb4" },
  { id: "4_light_green", cor: "#cfe8b4" },
  { id: "5_green", cor: "#00a650" },
] as const;
