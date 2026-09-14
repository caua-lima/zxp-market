import { dentroDoLimite, emPorcento, TETOS, type ChaveMetrica } from "@/lib/domain/limites-reputacao";

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
  /**
   * A janela que o ML usou NESTA metrica ("60 days", "365 days"). No MLB sao
   * 60 dias so pra quem teve 60+ vendas nos ultimos 60 dias; abaixo disso o ML
   * avalia 365. Nao e uma constante do sistema.
   */
  period?: string;
  rate?: number;
  value?: number;
  /**
   * Vendedor protegido: `rate`/`value` vem ZERADOS e os numeros reais ficam
   * aqui. A protecao termina numa data conhecida — mostrar so o zero adia a
   * noticia em vez de evitar o problema.
   */
  excluded?: { real_rate?: number | null; real_value?: number | null } | null;
};

/**
 * As tres metricas de QUALIDADE, que tem teto. `sales` fica de fora de
 * proposito: e o denominador delas, nao uma metrica com limite, e mante-la
 * aqui quebraria os Record<keyof ...> que dependem de "toda chave tem teto".
 */
export type SellerReputationMetrics = {
  claims?: SellerReputationMetricEntry;
  delayed_handling_time?: SellerReputationMetricEntry;
  cancellations?: SellerReputationMetricEntry;
};

/**
 * O bloco `metrics` inteiro, como a API devolve.
 *
 * `sales.completed` e o denominador oficial de reclamacoes e cancelamentos, e
 * `sales.period` diz qual janela o ML usou — 60 dias, ou 365 pra quem teve
 * menos de 60 vendas em 60 dias. Sem isto no tipo, o numero chegava na tela
 * por acidente de runtime e a tela assumia 60 dias fixos.
 */
export type SellerReputationMetricsBloco = SellerReputationMetrics & {
  sales?: { period?: string | null; completed?: number | null } | null;
};

export type SellerReputation = {
  level_id?: string | null;
  power_seller_status?: string | null;
  transactions?: {
    completed?: number;
    canceled?: number;
    ratings?: { positive?: number; negative?: number; neutral?: number };
  } | null;
  metrics?: SellerReputationMetricsBloco | null;
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

/**
 * A cor de cada degrau do termometro, como o app pinta.
 *
 * ─── POR QUE LARANJA NAO PODE SER O DOURADO DA MARCA ────────────────────
 *
 * "2_orange" vinha com #F4B942 cravado, que e o dourado de ASSINATURA — a
 * cor de acao/CTA. Duas consequencias, as duas ruins:
 *
 *   · --yellow tambem e o dourado desde a unificacao dos tokens, entao
 *     "Amarelo" e "Laranja" — dois degraus DIFERENTES do termometro do ML —
 *     saiam exatamente da mesma cor. O degrau ficava ilegivel.
 *   · um estado de alerta vestia a cor de acao da marca, que o guia de
 *     identidade manda manter visualmente distinta.
 *
 * --warning e o laranja operacional (#FF8A1F), que e literalmente a cor do
 * degrau. E o unico dos cinco que precisava mudar.
 */
const LEVEL_META: Record<string, { label: string; cor: string }> = {
  "5_green": { label: "Verde — melhor nível", cor: "var(--green)" },
  "4_light_green": { label: "Verde claro", cor: "var(--green)" },
  "3_yellow": { label: "Amarelo — atenção", cor: "var(--yellow)" },
  "2_orange": { label: "Laranja — atenção", cor: "var(--warning)" },
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

/**
 * Derivado de TETOS (lib/domain/limites-reputacao), que guarda os valores em
 * DECIMAL — a unidade que a API do ML devolve.
 *
 * Os tetos estavam escritos duas vezes, em unidades diferentes: 1, 0.5 e 6 em
 * porcento aqui; 0.01, 0.005 e 0.06 em decimal em proxima-medalha.ts. Iguais
 * hoje por coincidencia de manutencao, nao por construcao — e o comparador dos
 * dois lados ja tinha divergido.
 */
export const METRIC_LIMITES: Record<keyof SellerReputationMetrics, LimiteMetrica> = {
  claims: { permitido: emPorcento(TETOS.claims.permitido), mercadoLider: emPorcento(TETOS.claims.mercadoLider) },
  cancellations: { permitido: emPorcento(TETOS.cancellations.permitido), mercadoLider: emPorcento(TETOS.cancellations.mercadoLider) },
  delayed_handling_time: { permitido: emPorcento(TETOS.delayed_handling_time.permitido), mercadoLider: emPorcento(TETOS.delayed_handling_time.mercadoLider) },
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
  /**
   * O comparador e UM SO, compartilhado com proxima-medalha.ts.
   *
   * Aqui era `pct > lim` — taxa IGUAL ao teto contava como ok — enquanto
   * proxima-medalha.ts fazia `taxa < limite`, em que igual conta como NAO ok.
   * Os dois paineis ficam lado a lado na aba Desempenho: com a taxa exatamente
   * no teto, este pintava verde e o outro dizia que a medalha nao sai.
   */
  const tetos = TETOS[chave as ChaveMetrica];
  if (!tetos) return "indisponivel";
  if (!dentroDoLimite(rate, tetos.permitido)) return "estourado";
  if (!dentroDoLimite(rate, tetos.mercadoLider)) return "atencao";
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
