/**
 * Os tetos da reputação, o comparador, o denominador e a janela — num lugar só.
 *
 * ─── FONTE ──────────────────────────────────────────────────────────────
 *
 * developers.mercadolivre.com.br/pt_br/reputacao-de-vendedores
 * Página com "Última atualização em 11/08/2025", lida em 14/09/2026.
 * Tabela "Limites para cada variável", linha MLB.
 *
 * ─── A CONTRADIÇÃO QUE ISTO RESOLVE ─────────────────────────────────────
 *
 * Havia duas decisões sobre o MESMO número, em módulos diferentes, e elas
 * discordavam justamente na igualdade ao teto:
 *
 *   reputation.ts        if (pct > lim.mercadoLider) return "atencao";
 *                        → taxa IGUAL ao teto conta como OK
 *
 *   proxima-medalha.ts   const ok = taxa < limite;
 *                        → taxa IGUAL ao teto conta como NÃO ok
 *
 * Os dois painéis ficam um ao lado do outro na aba Desempenho. Com a taxa
 * exatamente no teto, o ReputacaoPanel pintava verde e o ProximaMedalhaPanel
 * dizia que a medalha não sai.
 *
 * A documentação oficial decide: a faixa vermelha do MLB é "> 8%", ou seja,
 * 8% ainda é laranja. Os limites são INCLUSIVOS — estar exatamente no teto
 * ainda está dentro dele. Quem estava certo era o reputation.ts.
 *
 * E os tetos estavam escritos duas vezes, em UNIDADES diferentes: 1, 0.5 e 6
 * em porcento num arquivo; 0.01, 0.005 e 0.06 em decimal no outro. Iguais por
 * coincidência de manutenção, não por construção.
 *
 * ─── A FOLGA PROMETIA UM CASO QUE O COMPARADOR RECUSAVA ─────────────────
 *
 * A folga era `Math.max(0, Math.floor(limite * vendas) - casos)` — a conta
 * certa PARA UM TETO INCLUSIVO. Mas o `ok` ao lado dela usava `taxa < limite`,
 * exclusivo. Com 100 vendas e teto de 1%, a tela dizia "cabem mais 1" e, com
 * essa 1 reclamação, o mesmo componente reprovaria.
 *
 * Aqui a folga é DERIVADA do comparador. As duas não podem divergir porque
 * uma é definida pela outra.
 *
 * ─── O DENOMINADOR NÃO É O MESMO PRAS TRÊS ──────────────────────────────
 *
 * Direto da documentação:
 *
 *   claims_rate                = vendas com reclamações / vendas totais
 *   cancellations rate         = cancelamentos do vendedor / vendas totais
 *   delayed handling time rate = vendas com envio atrasado / vendas ENVIADAS COM ME2
 *
 * A terceira tem outra base. Traduzir a taxa de atraso em casos usando o
 * total de vendas dá um número que não corresponde a nada — e era o que a
 * tela fazia com as três.
 */

export type ChaveMetrica = "claims" | "cancellations" | "delayed_handling_time";

/**
 * Uma métrica como a API devolve.
 *
 * `excluded` aparece pra vendedor protegido: o `rate`/`value` visível vem
 * zerado e os números reais ficam ali dentro. Ignorar isso mostra "0%" pra
 * quem na verdade tem casos — e a proteção acaba numa data conhecida.
 */
export type MetricaML = {
  period?: string | null;
  rate?: number | null;
  value?: number | null;
  excluded?: { real_rate?: number | null; real_value?: number | null } | null;
} | null | undefined;

export type TetosDaMetrica = {
  /** Teto pra manter a cor verde. Decimal (0.02 = 2%). */
  permitido: number;
  /** Teto exigido pra ser MercadoLíder. Decimal. */
  mercadoLider: number;
};

/**
 * Tabela oficial do MLB. Decimal — a unidade que a API devolve.
 *
 * `permitido` é a coluna "Green"; `mercadoLider` é a coluna "Líderes".
 * As faixas completas ficam em FAIXAS_MLB.
 */
export const TETOS: Record<ChaveMetrica, TetosDaMetrica> = {
  claims: { permitido: 0.02, mercadoLider: 0.01 },
  cancellations: { permitido: 0.015, mercadoLider: 0.005 },
  delayed_handling_time: { permitido: 0.10, mercadoLider: 0.06 },
};

/**
 * As faixas de cor completas do MLB, da documentação oficial.
 *
 * Guardadas inteiras porque "estourou o permitido" não diz o quanto: 2,1% de
 * reclamação e 7,9% levam a conversas diferentes, e as duas saíam como
 * "estourado".
 */
export const FAIXAS_MLB: Record<ChaveMetrica, { green: number; yellow: number; orange: number }> = {
  claims: { green: 0.02, yellow: 0.045, orange: 0.08 },
  cancellations: { green: 0.015, yellow: 0.035, orange: 0.04 },
  delayed_handling_time: { green: 0.10, yellow: 0.18, orange: 0.22 },
};

/** De onde vieram os números e quando foram conferidos. */
export const ORIGEM_DOS_TETOS = {
  fonte: "developers.mercadolivre.com.br/pt_br/reputacao-de-vendedores",
  paginaAtualizadaEm: "2025-08-11",
  lidaEm: "2026-09-14",
  site: "MLB",
} as const;

/**
 * Margem pra ruído de ponto flutuante.
 *
 * `3 * 0.02` não é exatamente `0.06` em binário. Sem isto, uma taxa que
 * deveria bater no teto cairia pra um lado ou pro outro conforme o caminho da
 * conta — e o resultado dependeria de qual painel fez a multiplicação.
 */
const EPSILON = 1e-9;

/**
 * O ÚNICO comparador. Teto INCLUSIVO, conforme a tabela oficial ("> 8%" é que
 * é vermelho, logo 8% ainda não é).
 *
 * @param taxa decimal (0 a 1), como a API devolve.
 */
export function dentroDoLimite(taxa: number, teto: number): boolean {
  return taxa <= teto + EPSILON;
}

/**
 * Quantos casos ainda cabem sem estourar — derivado do comparador acima.
 *
 * É o maior `k >= 0` tal que `dentroDoLimite((casos + k) / base, teto)`.
 * Nunca promete um caso que `dentroDoLimite` vai recusar, porque é ele quem
 * responde. Já estourado dá zero, nunca negativo.
 */
export function folgaEmCasos(casos: number, base: number, teto: number): number | null {
  if (!Number.isFinite(casos) || !Number.isFinite(base) || base <= 0) return null;
  if (casos < 0) return null;

  // casos + k <= teto * base  →  k <= teto*base - casos
  const maximo = teto * base - casos;
  if (maximo < 0) return 0;
  return Math.max(0, Math.floor(maximo + EPSILON));
}

/**
 * A taxa e a contagem que valem — preferindo os números reais da proteção.
 *
 * Vendedor protegido recebe `rate`/`value` zerados e os verdadeiros em
 * `excluded`. Mostrar o zero é confortável e falso: a proteção termina numa
 * data, e aí o número real aparece de uma vez.
 */
export function lerMetrica(m: MetricaML): {
  taxa: number | null;
  casos: number | null;
  taxaReal: number | null;
  casosReais: number | null;
  protegida: boolean;
  periodo: string | null;
} {
  const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const taxa = num(m?.rate);
  const casos = num(m?.value);
  const taxaReal = num(m?.excluded?.real_rate);
  const casosReais = num(m?.excluded?.real_value);
  return {
    taxa,
    casos,
    taxaReal,
    casosReais,
    protegida: taxaReal != null || casosReais != null,
    periodo: typeof m?.period === "string" && m.period ? m.period : null,
  };
}

/**
 * O denominador que a própria métrica implica: se `rate = value / base`,
 * então `base = value / rate`.
 *
 * É o único jeito de descobrir sobre o que o ML dividiu — e ele divide
 * diferente por métrica. Só funciona com taxa e casos positivos; com zero
 * casos a taxa é zero e a divisão não diz nada.
 */
export function baseImplicita(casos: number | null, taxa: number | null): number | null {
  if (casos == null || taxa == null) return null;
  if (!Number.isFinite(casos) || !Number.isFinite(taxa)) return null;
  if (taxa <= 0 || casos <= 0) return null;
  return casos / taxa;
}

/**
 * A base pra traduzir taxa em casos — ou `null` quando não dá pra saber.
 *
 * Ordem de preferência:
 *
 *  1. A base que a PRÓPRIA métrica implica (`value / rate`). É a que o ML
 *     usou, seja ela qual for.
 *  2. Pra reclamações e cancelamentos, `sales.completed` — a documentação diz
 *     que as duas dividem por vendas totais.
 *  3. Pra atraso no envio, NADA. A fórmula oficial divide por "vendas
 *     enviadas com ME2", que não é o total de vendas e não está na resposta.
 *     Chutar aqui produz um "cabem mais X" que não corresponde a nada — e era
 *     exatamente o que a tela fazia.
 *
 * @param vendasCompletas `metrics.sales.completed` da API — não a contagem de
 *   pedidos do app, que é feita sobre outra janela.
 */
export function baseDaMetrica(
  chave: ChaveMetrica,
  m: MetricaML,
  vendasCompletas: number | null | undefined,
): number | null {
  const { taxa, casos, taxaReal, casosReais } = lerMetrica(m);

  const implicita = baseImplicita(casos, taxa) ?? baseImplicita(casosReais, taxaReal);
  if (implicita != null) return implicita;

  if (chave === "delayed_handling_time") return null;

  const vendas = Number(vendasCompletas);
  return Number.isFinite(vendas) && vendas > 0 ? vendas : null;
}

/**
 * A janela que o ML usou nesta métrica, lida da resposta.
 *
 * A documentação é explícita: no MLB o período é de 60 dias para quem teve
 * 60 ou mais vendas nos últimos 60 dias, e de 365 dias para quem teve menos.
 * Ou seja, "60 dias" não é uma constante do sistema — é o caso comum. Fixar
 * 60 na tela mente pra uma conta em recuperação, justamente a que mais
 * precisa ler o número certo.
 */
export function periodoDaMetrica(m: MetricaML): string | null {
  return lerMetrica(m).periodo;
}

/** Decimal pra porcento, pra a tela. */
export function emPorcento(decimal: number): number {
  return decimal * 100;
}
