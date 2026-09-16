/**
 * Qual recomendação de Ads merece ser lida primeiro.
 *
 * ─── O QUE HAVIA ─────────────────────────────────────────────────────────
 *
 * O painel de decisão ordenava cada grupo por UM número: lucro, nos que
 * mandava escalar; gasto, nos sem retorno. Impacto puro, sem confiança.
 *
 * O efeito é que um anúncio com 3 cliques e R$ 400 gastos aparecia acima de
 * um com 3.000 cliques e R$ 380 — e o ROAS do primeiro não significa
 * praticamente nada. Três cliques podem virar uma venda ou nenhuma por acaso,
 * e essa diferença muda o ROAS de 0 pra 12.
 *
 * Pior: a recomendação em cima da lista é a que tem mais chance de ser
 * seguida. Ordenar sem confiança coloca no topo exatamente os anúncios sobre
 * os quais menos se sabe.
 *
 * ─── IMPACTO × CONFIANÇA ─────────────────────────────────────────────────
 *
 * IMPACTO é quanto dinheiro está em jogo: o lucro que se ganha escalando, ou
 * o prejuízo que se para de ter cortando.
 *
 * CONFIANÇA é o quanto dá pra acreditar no número: volume de cliques, custo
 * do produto cadastrado, e se o período é longo o bastante.
 *
 * A prioridade MULTIPLICA os dois em vez de somar. Somar deixaria um impacto
 * enorme com confiança quase nula subir do mesmo jeito — e é justamente esse
 * o caso perigoso: o anúncio que gastou muito em poucos dias, sobre o qual
 * ainda não dá pra concluir nada.
 */

export type BaseDaDecisao = {
  /** Cliques no período — a base estatística do ROAS. */
  cliques: number;
  /** Gasto no período. */
  investido: number;
  /**
   * Lucro depois do Ads. `null` quando não deu pra calcular (produto sem
   * custo cadastrado, por exemplo).
   */
  lucro: number | null;
  /** Dias do período apurado. */
  dias: number;
  /** A receita atribuída pôde ser separada entre direta e assistida? */
  atribuicaoCompleta: boolean;
};

/**
 * Cliques a partir dos quais o ROAS começa a significar alguma coisa.
 *
 * 100 é um julgamento declarado, não um número mágico. Com taxa de conversão
 * na casa de 1–2%, cem cliques são uma ou duas vendas esperadas: ainda pouco
 * pra afirmar, e já o bastante pra que "zero venda" deixe de ser sorte. Abaixo
 * disso a confiança cai proporcionalmente; acima, satura.
 */
export const CLIQUES_PARA_CONFIANCA = 100;

/** Dias de período abaixo dos quais qualquer conclusão é precoce. */
export const DIAS_PARA_CONFIANCA = 14;

/**
 * Confiança de 0 a 1.
 *
 * Multiplicativa, e não média: cada fator é uma condição NECESSÁRIA. Numa
 * média, custo não cadastrado seria compensado por muitos cliques — e não é
 * compensável: sem o custo do produto, o lucro não é impreciso, ele é
 * desconhecido.
 */
export function confiancaDaDecisao(b: BaseDaDecisao): number {
  const porCliques = Math.min(Math.max(b.cliques, 0) / CLIQUES_PARA_CONFIANCA, 1);
  const porPeriodo = Math.min(Math.max(b.dias, 0) / DIAS_PARA_CONFIANCA, 1);

  // Sem lucro calculável, a decisão se apoia só em ROAS — que ignora o custo
  // do produto. Não é zero (ROAS ainda diz algo), mas é pouco.
  const porCusto = b.lucro === null ? 0.35 : 1;

  // Atribuição incompleta não invalida, só embaça: sem o corte entre direta e
  // assistida, não dá pra saber quanto da venda dependia da verba.
  const porAtribuicao = b.atribuicaoCompleta ? 1 : 0.8;

  return porCliques * porPeriodo * porCusto * porAtribuicao;
}

/** Como a confiança se chama na tela. Curto, sem eufemismo. */
export function rotuloDaConfianca(c: number): "alta" | "média" | "baixa" {
  if (c >= 0.7) return "alta";
  if (c >= 0.35) return "média";
  return "baixa";
}

/**
 * Por que a confiança não é alta — a frase que torna o rótulo acionável.
 *
 * Devolve o motivo DOMINANTE, e não a lista de todos: três ressalvas ao lado
 * de uma recomendação fazem ignorar a recomendação inteira. Quem quer o
 * detalhe abre o anúncio.
 */
export function motivoDaConfianca(b: BaseDaDecisao): string | null {
  if (b.lucro === null) {
    return "Sem custo do produto cadastrado: dá pra ver o ROAS, não o lucro.";
  }
  if (b.cliques < CLIQUES_PARA_CONFIANCA) {
    return `Só ${b.cliques} clique(s) no período — poucos pra concluir; o ROAS ainda oscila muito.`;
  }
  if (b.dias < DIAS_PARA_CONFIANCA) {
    return `Período de ${b.dias} dia(s): curto pra separar tendência de oscilação.`;
  }
  if (!b.atribuicaoCompleta) {
    return "Sem o corte entre venda direta e assistida, não dá pra saber quanto depende da verba.";
  }
  return null;
}

/**
 * Quanto dinheiro está em jogo nesta decisão.
 *
 * ─── POR QUE LUCRO NEGATIVO USA O MÓDULO ────────────────────────────────
 *
 * Cortar um anúncio que perde R$ 800 vale exatamente tanto quanto escalar um
 * que ganha R$ 800: os dois mexem R$ 800 no resultado. Ordenar por lucro cru
 * mandaria todos os prejuízos pro fim da lista, que é o contrário do útil.
 *
 * Sem lucro calculável, o gasto é o piso do que está em jogo — é o que já
 * saiu do bolso, independente do que voltou.
 */
export function impactoDaDecisao(b: BaseDaDecisao): number {
  if (b.lucro === null) return Math.max(b.investido, 0);
  return Math.abs(b.lucro);
}

export type Prioridade = {
  /** impacto × confiança. Só serve pra ordenar — não é reais. */
  score: number;
  impacto: number;
  confianca: number;
  rotulo: "alta" | "média" | "baixa";
  /** Por que a confiança não é alta, ou null. */
  ressalva: string | null;
};

export function prioridadeDaDecisao(b: BaseDaDecisao): Prioridade {
  const confianca = confiancaDaDecisao(b);
  const impacto = impactoDaDecisao(b);
  return {
    score: impacto * confianca,
    impacto,
    confianca,
    rotulo: rotuloDaConfianca(confianca),
    ressalva: motivoDaConfianca(b),
  };
}

/**
 * Ordena decisões pela prioridade, maior primeiro.
 *
 * O desempate é pelo IMPACTO e depois pela chave — nunca pela ordem de
 * chegada. Lista de recomendação que muda de ordem sozinha entre dois
 * carregamentos faz perder a que se estava lendo.
 */
export function ordenarPorPrioridade<T>(
  itens: readonly T[],
  base: (t: T) => BaseDaDecisao,
  chave: (t: T) => string,
): T[] {
  return [...itens].sort((a, b) => {
    const pa = prioridadeDaDecisao(base(a));
    const pb = prioridadeDaDecisao(base(b));
    if (pb.score !== pa.score) return pb.score - pa.score;
    if (pb.impacto !== pa.impacto) return pb.impacto - pa.impacto;
    return chave(a).localeCompare(chave(b), "pt-BR");
  });
}
