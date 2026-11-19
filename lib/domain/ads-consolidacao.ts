/**
 * O Mercado Livre ainda não consolidou ONTEM na API pública de Ads?
 *
 * ─── O QUE FOI MEDIDO ──────────────────────────────────────────────────
 *
 * Em 19/11, às 06:45, no período 13–19/11:
 *
 *  - painel do Mercado Ads: R$ 406,84 de investimento (R$ 132,01 do dia 18);
 *  - `/campaigns/search` (API pública, por campanha): R$ 274,83 — o período
 *    INTEIRO menos o dia 18. Hoje (19) já vinha; ontem não;
 *  - `/ads/search` (API pública, por anúncio): custo de ontem presente, mas a
 *    receita atribuída de ontem não.
 *
 * Em período fechado (06–12/11) e em "hoje" as duas APIs batem centavo por
 * centavo com o painel. O buraco é só o dia anterior, enquanto o ML processa.
 *
 * O app comparava as duas fontes e, com a diferença passando de 2%, concluía
 * "anúncio em duas campanhas" e acendia "⚠ rateado" em 13 de 14 campanhas
 * que têm um anúncio só. Não era rateio: era um dia faltando de um lado.
 *
 * ─── COMO SE DETECTA ───────────────────────────────────────────────────
 *
 * Pergunta-se às duas fontes o custo SÓ de ontem. Anúncio compartilhado ou
 * campanha excluída redistribuem gasto entre campanhas, mas não fazem o
 * recurso de campanha "perder" quase todo o dia — isso só a falta de
 * consolidação faz. Daí o limiar: o recurso de campanha trazer menos de 90%
 * do que os anúncios gastaram ontem.
 */

export type Consolidacao = {
  /** Dia conferido (ontem, no fuso de Brasília), AAAA-MM-DD. */
  dia: string;
  /** Investimento de ontem segundo o recurso de CAMPANHA. */
  custoCampanhas: number;
  /** Investimento de ontem segundo o recurso de ANÚNCIO. */
  custoAnuncios: number;
  /**
   * true = o recurso de campanha ainda não tem ontem. Enquanto isso, a
   * receita atribuída de ontem também não existe na API pública.
   */
  pendente: boolean;
};

/** Gasto abaixo disto é ruído de centavos — não sustenta conclusão nenhuma. */
const GASTO_MINIMO = 0.5;

export function avaliarConsolidacao(dia: string, custoCampanhas: number, custoAnuncios: number): Consolidacao {
  const pendente = custoAnuncios >= GASTO_MINIMO && custoCampanhas < 0.9 * custoAnuncios;
  return { dia, custoCampanhas, custoAnuncios, pendente };
}

/** AAAA-MM-DD de `dias` atrás, no fuso de Brasília (UTC−3, sem horário de verão). */
export function diaBR(agoraMs: number, dias = 0): string {
  return new Date(agoraMs - 3 * 3600 * 1000 - dias * 86400000).toISOString().slice(0, 10);
}

/** O período pedido inclui ontem? Só aí a consolidação pode estar pendente. */
export function periodoIncluiOntem(from: string, to: string, agoraMs: number): string | null {
  const ontem = diaBR(agoraMs, 1);
  return from <= ontem && to >= ontem ? ontem : null;
}

/**
 * Anúncios CADASTRADOS em cada campanha, como o painel mostra
 * ("3 anúncios patrocinados").
 *
 * A tela contava só os anúncios que gastaram no período: "MS, LC, TT" tem 3,
 * um deles teve 248 impressões e R$ 0, e a linha dizia 2. A contagem vem da
 * MESMA listagem de anúncios das métricas (todos, inclusive os sem gasto),
 * pela campanha atual de cada um.
 *
 * Status fora de active/paused (ex.: "idle", anúncio fora de campanha) não
 * conta — o painel também não lista.
 */
export function contarAnunciosPorCampanha(
  anuncios: { campaignId: string; status: string }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of anuncios) {
    const st = a.status.toLowerCase();
    if (!a.campaignId || (st !== "active" && st !== "paused")) continue;
    m.set(a.campaignId, (m.get(a.campaignId) ?? 0) + 1);
  }
  return m;
}
