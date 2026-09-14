/**
 * "Últimos N dias" — uma definição só, porque havia duas.
 *
 * ─── O ERRO ─────────────────────────────────────────────────────────────
 *
 * `/api/ml/reputacao-vendas` montava a janela assim:
 *
 *   const de  = diaBR(-dias);   // 60 dias atrás
 *   const ate = diaBR();        // hoje
 *
 * e buscava de `de T00:00` até `ate T23:59:59` — INCLUSIVO nas duas pontas.
 * Com `dias = 60` isso cobre 61 datas: os 60 dias anteriores MAIS hoje.
 *
 * `/api/ml/desempenho`, que recebe o MESMO parâmetro `dias` da mesma tela,
 * já fazia `brDayISO(-(dias - 1))` — o correto. Os dois painéis liam o mesmo
 * filtro de período e contavam bases diferentes: a reputação saía com um dia
 * a mais de vendas no denominador do que o desempenho ao lado.
 *
 * Um dia a mais parece pouco até virar percentual de reclamação: com ~15
 * vendas por dia numa janela de 60, o denominador erra ~1,6% pra mais, o que
 * empurra a taxa pra baixo — exatamente na direção que engana.
 */

/**
 * Data no fuso de São Paulo, deslocada por `offsetDias`, como yyyy-mm-dd.
 *
 * Nome diferente do `diaBR` de lib/domain/tempo.ts de propósito: aquele
 * converte um instante ISO, este anda no calendário a partir de agora.
 */
export function diaRelativoBR(offsetDias = 0, agora: number = Date.now()): string {
  const d = new Date(agora - 3 * 3600 * 1000 + offsetDias * 86400000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

export type Janela = {
  /** yyyy-mm-dd, inclusivo. */
  de: string;
  /** yyyy-mm-dd, inclusivo. */
  ate: string;
  /** Quantas datas a janela cobre de fato. */
  dias: number;
};

/**
 * A janela dos últimos `dias` dias, contando HOJE como um deles.
 *
 * `janelaDeDias(1)` é só hoje. `janelaDeDias(60)` vai de 59 dias atrás até
 * hoje — 60 datas, não 61.
 */
export function janelaDeDias(dias: number, agora: number = Date.now()): Janela {
  const n = Math.max(1, Math.floor(Number(dias) || 1));
  return { de: diaRelativoBR(-(n - 1), agora), ate: diaRelativoBR(0, agora), dias: n };
}

/**
 * Quantas datas inclusivas existem entre `de` e `ate`.
 *
 * Serve pra conferir uma janela que veio de fora (o filtro da tela manda
 * `from`/`to` diretos) em vez de assumir que ela tem o tamanho que o
 * parâmetro `dias` diz.
 */
export function diasNaJanela(de: string, ate: string): number {
  const a = Date.parse(`${de}T00:00:00Z`);
  const b = Date.parse(`${ate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}
