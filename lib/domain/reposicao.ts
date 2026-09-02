/**
 * Quanto pedir de cada produto pro estoque durar X dias — sem zerar.
 *
 * ─── A PERGUNTA ─────────────────────────────────────────────────────────
 *
 * "O fornecedor passa hoje. Quero estoque pra 30 dias. Quais produtos e
 * quanto de cada um?"
 *
 * ─── POR QUE A MÉDIA PURA NÃO SERVE ─────────────────────────────────────
 *
 * Comprar `média diária × 30` faz o estoque chegar a ZERO exatamente no dia
 * 30. E média é média: metade dos dias vende acima dela. Basta uma semana
 * boa pra acabar no dia 24 — e no Full, ficar sem estoque não é só perder a
 * venda do dia, é o anúncio perdendo posição e demorando pra voltar.
 *
 * Por isso existe a folga. Ela não é enfeite: é a diferença entre "dura 30
 * dias em média" e "dura 30 dias mesmo quando vende bem".
 *
 *     dias a cobrir = dias desejados + folga
 *     necessário    = média diária × dias a cobrir   (arredondado pra cima)
 *     comprar       = necessário − estoque atual
 *
 * ─── O QUE A TELA MOSTRA ────────────────────────────────────────────────
 *
 * Além de quanto pedir: quantos dias o estoque de hoje aguenta e quantos
 * dias FALTAM pro alvo. É a resposta direta a "se estiver faltando, me dá o
 * dado".
 */

export type ProdutoReposicao = {
  id: string;
  nome: string;
  /** Tudo que dá pra vender hoje: Full + o que está fora do Full. */
  estoqueTotal: number;
  /** A parte que já está no galpão, pronta pra enviar ao Full. */
  emCasa: number;
  /** Unidades vendidas por dia, no período medido. */
  mediaDiaria: number;
  /** Custo médio, pra estimar o investimento. */
  custoUnitario: number;
  /** Produto desativado não entra no plano. */
  ativo: boolean;
};

export type ItemDoPlano = {
  produtoId: string;
  nome: string;
  mediaDiaria: number;
  estoqueTotal: number;
  emCasa: number;
  /** Dias que o estoque de hoje aguenta no ritmo atual. */
  duraDias: number;
  /** Dias que faltam pro alvo. 0 = o estoque já alcança o alvo. */
  faltamDias: number;
  /** Unidades que precisam existir: alvo + folga. */
  necessario: number;
  /** Quanto pedir ao fornecedor. */
  comprar: number;
  investimento: number;
  /**
   * O estoque de hoje não chega ao alvo — vai zerar antes. É o caso que
   * quebra o Full, e por isso é destacado.
   */
  vaiZerarAntes: boolean;
  /** Quanto do pedido já está em casa e só precisa ir pro Full. */
  jaTemEmCasa: number;
};

export type PlanoReposicao = {
  /** Quem precisa de compra, do mais apertado pro menos. */
  itens: ItemDoPlano[];
  /** Os que zeram antes do alvo — a lista que não pode esperar. */
  vaoZerar: ItemDoPlano[];
  /** Já alcançam o alvo com folga: nada a pedir. */
  suficientes: number;
  /** Sem venda no período — sem ritmo, projetar seria chute. */
  semHistorico: number;
  totalUnidades: number;
  totalInvestimento: number;
  /** Alvo pedido pelo usuário, em dias. */
  diasAlvo: number;
  /** Folga aplicada, em dias. */
  diasFolga: number;
  /** Janela efetivamente comprada (alvo + folga). */
  diasACobrir: number;
};

/**
 * Dias que o estoque aguenta no ritmo atual.
 *
 * Arredonda pra BAIXO: dia parcial não é dia coberto. Sem ritmo conhecido
 * devolve `null` — "não sei" não é "dura pra sempre".
 */
export function duracaoDoEstoque(estoque: number, mediaDiaria: number): number | null {
  if (!Number.isFinite(mediaDiaria) || mediaDiaria <= 0) return null;
  return Math.floor(Math.max(estoque, 0) / mediaDiaria);
}

/**
 * Unidades necessárias pra cobrir a janela.
 *
 * Arredonda pra CIMA — meia unidade de cobertura não existe, e faltar custa
 * mais que sobrar: sobra vira estoque, falta vira anúncio parado.
 */
export function necessarioParaJanela(mediaDiaria: number, diasACobrir: number): number {
  if (!Number.isFinite(mediaDiaria) || mediaDiaria <= 0) return 0;
  if (!Number.isFinite(diasACobrir) || diasACobrir <= 0) return 0;
  return Math.ceil(mediaDiaria * diasACobrir);
}

/**
 * Monta o pedido de compra.
 *
 * @param diasAlvo   quantos dias o estoque deve durar.
 * @param diasFolga  dias a mais comprados pra não zerar no alvo. Zero é
 *   permitido, mas aí o estoque termina exatamente no dia do alvo — e
 *   qualquer dia acima da média antecipa a ruptura.
 */
export function montarPlanoReposicao(
  produtos: ProdutoReposicao[],
  diasAlvo: number,
  diasFolga: number,
): PlanoReposicao {
  const alvo = Math.max(0, Math.floor(diasAlvo) || 0);
  const folga = Math.max(0, Math.floor(diasFolga) || 0);
  const diasACobrir = alvo + folga;

  const itens: ItemDoPlano[] = [];
  let suficientes = 0;
  let semHistorico = 0;

  for (const p of produtos) {
    if (!p.ativo) continue;

    const media = Number.isFinite(p.mediaDiaria) && p.mediaDiaria > 0 ? p.mediaDiaria : 0;
    const estoque = Math.max(Number(p.estoqueTotal) || 0, 0);

    if (media <= 0) {
      semHistorico++;
      continue;
    }

    const necessario = necessarioParaJanela(media, diasACobrir);
    const comprar = Math.max(0, necessario - estoque);
    const duraDias = duracaoDoEstoque(estoque, media) ?? 0;
    const faltamDias = Math.max(0, alvo - duraDias);
    const vaiZerarAntes = duraDias < alvo;

    if (comprar <= 0) {
      suficientes++;
      continue;
    }

    const emCasa = Math.max(Number(p.emCasa) || 0, 0);
    itens.push({
      produtoId: p.id,
      nome: p.nome || p.id,
      mediaDiaria: media,
      estoqueTotal: estoque,
      emCasa,
      duraDias,
      faltamDias,
      necessario,
      comprar,
      investimento: comprar * (Number(p.custoUnitario) || 0),
      vaiZerarAntes,
      /**
       * Parte do pedido que já está no galpão. Não muda o quanto comprar —
       * muda o que fazer HOJE: essas unidades só precisam ir pro Full, e
       * mandá-las é mais rápido que esperar o fornecedor.
       */
      jaTemEmCasa: Math.min(emCasa, comprar),
    });
  }

  /**
   * Ordem: quem zera antes do alvo primeiro, e dentro disso quem dura menos.
   * Empate pelo nome, pra a lista não dançar entre duas leituras da tela.
   */
  itens.sort((a, b) => {
    if (a.vaiZerarAntes !== b.vaiZerarAntes) return a.vaiZerarAntes ? -1 : 1;
    if (a.duraDias !== b.duraDias) return a.duraDias - b.duraDias;
    return a.nome.localeCompare(b.nome);
  });

  return {
    itens,
    vaoZerar: itens.filter((i) => i.vaiZerarAntes),
    suficientes,
    semHistorico,
    totalUnidades: itens.reduce((s, i) => s + i.comprar, 0),
    totalInvestimento: itens.reduce((s, i) => s + i.investimento, 0),
    diasAlvo: alvo,
    diasFolga: folga,
    diasACobrir,
  };
}

/**
 * Média diária considerando só os dias em que o produto esteve à venda.
 *
 * ─── POR QUE NÃO DIVIDIR PELA JANELA INTEIRA ────────────────────────────
 *
 * Anúncio que ficou ativo 10 dos 30 dias e vendeu 20 unidades vende 2 por
 * dia — não 0,67. Dividir pela janela cheia trata pausa como fraqueza de
 * venda, e quem compra por essa média garante a ruptura assim que o anúncio
 * volta ao ar.
 *
 * Vale pro caso quebrado também: ativo nos 10 primeiros dias, pausado na
 * segunda dezena, ativo do 20 ao 30 são 20 dias de base, não 30.
 *
 * `diasAtivos` ausente ou zero cai na janela — é o comportamento de quem não
 * tem o dado, e não uma divisão por zero disfarçada.
 */
export function mediaDiariaAjustada(
  unidadesVendidas: number,
  diasDaJanela: number,
  diasAtivos?: number | null,
): number {
  const vendidas = Math.max(Number(unidadesVendidas) || 0, 0);
  if (vendidas <= 0) return 0;

  const janela = Math.max(Number(diasDaJanela) || 0, 0);
  const ativos = Math.max(Number(diasAtivos) || 0, 0);

  /**
   * Nunca usa mais dias do que a janela tem: `diasAtivos` maior seria dado
   * inconsistente, e aceitar diluiria a média em dias que não existiram.
   */
  const base = ativos > 0 ? Math.min(ativos, janela || ativos) : janela;
  if (base <= 0) return 0;
  return vendidas / base;
}

/** Quanto o estoque dura, sem plano de compra — pra listar TODOS os produtos. */
export type SituacaoProduto = {
  produtoId: string;
  nome: string;
  estoqueTotal: number;
  emCasa: number;
  mediaDiaria: number;
  /** Dias usados como base da média (ativos, ou a janela quando não se sabe). */
  diasBase: number;
  /** `null` quando não houve venda: sem ritmo, não dá pra projetar. */
  duraDias: number | null;
  ativo: boolean;
};

/**
 * Situação de TODOS os produtos, incluindo os sem venda no período.
 *
 * Separado de `montarPlanoReposicao` de propósito: aquele responde "o que
 * pedir", este responde "como está cada um". Misturar faria a lista de
 * compra carregar produto que não precisa de compra nenhuma.
 */
export function situacaoDoEstoque(
  produtos: (ProdutoReposicao & { diasBase: number })[],
): SituacaoProduto[] {
  return produtos
    .map((p) => ({
      produtoId: p.id,
      nome: p.nome || p.id,
      estoqueTotal: Math.max(Number(p.estoqueTotal) || 0, 0),
      emCasa: Math.max(Number(p.emCasa) || 0, 0),
      mediaDiaria: Math.max(Number(p.mediaDiaria) || 0, 0),
      diasBase: Math.max(Number(p.diasBase) || 0, 0),
      duraDias: duracaoDoEstoque(Math.max(Number(p.estoqueTotal) || 0, 0), p.mediaDiaria),
      ativo: Boolean(p.ativo),
    }))
    /**
     * Quem dura menos primeiro; sem ritmo conhecido vai pro fim — é
     * informação, não urgência. Empate pelo nome, pra a lista não dançar.
     */
    .sort((a, b) => {
      const da = a.duraDias ?? Number.POSITIVE_INFINITY;
      const db = b.duraDias ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return a.nome.localeCompare(b.nome);
    });
}
