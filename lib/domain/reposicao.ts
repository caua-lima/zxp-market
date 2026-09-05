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

/**
 * Quanto tempo o que está NO FULL dura, e quanto mandar pra lá.
 *
 * ─── POR QUE ISTO É UMA PERGUNTA SEPARADA ───────────────────────────────
 *
 * O plano de compra soma Full + casa, porque pro fornecedor o que importa é
 * quanto existe no total. Mas quem organiza envio precisa do contrário: o
 * estoque em casa NÃO segura o Full. Se o Full zera e há 300 unidades no
 * galpão, o anúncio para do mesmo jeito — e a ação não é comprar, é despachar.
 *
 * São decisões com prazos diferentes: comprar espera o fornecedor, enviar
 * espera a coleta e o recebimento no centro de distribuição. Misturar as duas
 * esconde a que dá pra resolver hoje.
 *
 * ─── O TETO É O QUE EXISTE EM CASA ──────────────────────────────────────
 *
 * Não adianta sugerir enviar 200 quando há 40 no galpão. O que falta além do
 * que existe vira compra, e sai separado — assim a linha responde as duas
 * coisas: o que mandar agora e o que ainda precisa chegar.
 */
export type ItemEnvioFull = {
  produtoId: string;
  nome: string;
  mediaDiaria: number;
  /** Unidades no Full hoje. */
  noFull: number;
  /** Unidades no galpão, prontas pra despachar. */
  emCasa: number;
  /** Dias que o FULL sozinho aguenta. `null` sem ritmo de venda. */
  duraFull: number | null;
  /** Unidades que o Full precisa ter pra cobrir o alvo. */
  precisaNoFull: number;
  /** Quanto mandar agora — limitado ao que existe em casa. */
  enviar: number;
  /** O que falta mesmo depois de esvaziar o galpão: isso é compra. */
  faltaComprar: number;
  /** O Full acaba antes do alvo. */
  vaiZerar: boolean;
};

export type PlanoEnvioFull = {
  itens: ItemEnvioFull[];
  /** Os que zeram no Full antes do alvo — os que decidem a coleta de hoje. */
  urgentes: ItemEnvioFull[];
  totalAEnviar: number;
  /** Soma do que nem enviando resolve. */
  totalAComprar: number;
  diasAlvo: number;
};

/**
 * @param diasAlvo  quantos dias o FULL deve cobrir sozinho.
 */
export function planoEnvioParaFull(
  produtos: (ProdutoReposicao & { noFull: number; ehFull: boolean })[],
  diasAlvo: number,
): PlanoEnvioFull {
  const alvo = Math.max(0, Math.floor(diasAlvo) || 0);
  const itens: ItemEnvioFull[] = [];

  for (const p of produtos) {
    // Produto sem anúncio Full não tem envio a organizar.
    if (!p.ativo || !p.ehFull) continue;

    const media = Number.isFinite(p.mediaDiaria) && p.mediaDiaria > 0 ? p.mediaDiaria : 0;
    if (media <= 0) continue;

    const noFull = Math.max(Number(p.noFull) || 0, 0);
    const emCasa = Math.max(Number(p.emCasa) || 0, 0);
    const precisaNoFull = necessarioParaJanela(media, alvo);
    const falta = Math.max(0, precisaNoFull - noFull);
    if (falta <= 0) continue;

    const enviar = Math.min(falta, emCasa);
    const duraFull = duracaoDoEstoque(noFull, media);

    itens.push({
      produtoId: p.id,
      nome: p.nome || p.id,
      mediaDiaria: media,
      noFull,
      emCasa,
      duraFull,
      precisaNoFull,
      enviar,
      faltaComprar: falta - enviar,
      vaiZerar: duraFull != null && duraFull < alvo,
    });
  }

  /**
   * Quem tem menos dias de Full primeiro — é a ordem em que a coleta precisa
   * sair. Empate pelo nome, pra a lista não dançar entre duas leituras.
   */
  itens.sort((a, b) => {
    const da = a.duraFull ?? Number.POSITIVE_INFINITY;
    const db = b.duraFull ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.nome.localeCompare(b.nome);
  });

  return {
    itens,
    urgentes: itens.filter((i) => i.vaiZerar),
    totalAEnviar: itens.reduce((s, i) => s + i.enviar, 0),
    totalAComprar: itens.reduce((s, i) => s + i.faltaComprar, 0),
    diasAlvo: alvo,
  };
}

/**
 * "Quanto enviar pro Full pra durar até uma DATA."
 *
 * ─── POR QUE UMA DATA, E NÃO UM NÚMERO DE DIAS ──────────────────────────
 *
 * "Durar até o fim da semana que vem" é como a decisão é tomada de verdade —
 * a coleta tem dia, o fim de semana tem dia. Traduzir isso pra "16 dias" na
 * cabeça, toda vez, é onde se erra: hoje são 16, amanhã são 15, e o número
 * digitado continua 16.
 *
 * ─── POR QUE O FULL SOZINHO ─────────────────────────────────────────────
 *
 * O galpão não segura o Full. O que decide se o anúncio para é o que está no
 * centro de distribuição, e é só isso que entra na conta de duração.
 *
 * ─── O TEMPO DE TRÂNSITO É PARTE DA PERGUNTA ────────────────────────────
 *
 * O que você manda hoje não está vendável hoje: a coleta sai, o CD recebe e
 * processa. Se o envio leva 3 dias e você calcula pro dia exato, os 3 dias de
 * trânsito saem do estoque que já estava lá — e falta no fim.
 */

export type ItemEnvioAteData = {
  produtoId: string;
  nome: string;
  mediaDiaria: number;
  noFull: number;
  emCasa: number;
  /** Dias entre hoje e a data alvo, inclusive. */
  diasAteAlvo: number;
  /** Unidades que o Full precisa ter pra cobrir até lá. */
  precisaNoFull: number;
  /** Quanto mandar — limitado ao que existe no galpão. */
  enviar: number;
  /** O que falta mesmo esvaziando o galpão: isso é compra, não envio. */
  faltaComprar: number;
  /** O Full atual não chega na data. */
  naoChega: boolean;
};

export type PlanoAteData = {
  itens: ItemEnvioAteData[];
  /** Quem não chega na data com o Full de hoje — decide a coleta. */
  urgentes: ItemEnvioAteData[];
  totalAEnviar: number;
  totalAComprar: number;
  diasAteAlvo: number;
  /** Data alvo, yyyy-mm-dd. */
  alvoISO: string;
};

/** Dias entre duas datas yyyy-mm-dd, contando o dia de hoje. */
export function diasEntre(deISO: string, ateISO: string): number {
  const p = (s: string) => {
    const m = String(s ?? "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = p(deISO);
  const b = p(ateISO);
  if (!a || !b) return 0;
  // +1 porque o dia de hoje conta: "até amanhã" são dois dias de venda.
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

/**
 * O domingo do fim da semana QUE VEM.
 *
 * Semana começa no domingo no Brasil, então "fim da semana que vem" é o
 * sábado depois do próximo — 13 a 19 dias à frente conforme o dia de hoje.
 * Calcular isso de cabeça toda vez é onde nasce o erro.
 */
export function fimDaSemanaQueVem(hojeISO: string): string {
  const m = String(hojeISO ?? "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 6 = sábado. Dias até o sábado desta semana, mais 7 pra ir ao da que vem.
  const ateSabado = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + ateSabado + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * @param diasTransito  dias entre despachar e a unidade ficar vendável no
 *   Full. Entram na janela porque nesse período só o estoque atual vende.
 */
export function planoEnvioAteData(
  produtos: (ProdutoReposicao & { noFull: number; ehFull: boolean })[],
  hojeISO: string,
  alvoISO: string,
  diasTransito: number,
): PlanoAteData {
  const diasAteAlvo = diasEntre(hojeISO, alvoISO);
  const transito = Math.max(0, Math.floor(diasTransito) || 0);
  const itens: ItemEnvioAteData[] = [];

  for (const p of produtos) {
    if (!p.ativo || !p.ehFull) continue;
    const media = Number.isFinite(p.mediaDiaria) && p.mediaDiaria > 0 ? p.mediaDiaria : 0;
    if (media <= 0) continue;

    const noFull = Math.max(Number(p.noFull) || 0, 0);
    const emCasa = Math.max(Number(p.emCasa) || 0, 0);

    /**
     * A janela inclui o trânsito: o que sai hoje só vende depois de
     * processado, e até lá quem atende é o estoque que já está no Full.
     */
    const precisaNoFull = necessarioParaJanela(media, diasAteAlvo + transito);
    const falta = Math.max(0, precisaNoFull - noFull);
    if (falta <= 0) continue;

    const enviar = Math.min(falta, emCasa);
    const duraFull = duracaoDoEstoque(noFull, media) ?? 0;

    itens.push({
      produtoId: p.id,
      nome: p.nome || p.id,
      mediaDiaria: media,
      noFull,
      emCasa,
      diasAteAlvo,
      precisaNoFull,
      enviar,
      faltaComprar: falta - enviar,
      naoChega: duraFull < diasAteAlvo,
    });
  }

  itens.sort((a, b) => {
    if (a.naoChega !== b.naoChega) return a.naoChega ? -1 : 1;
    return b.enviar - a.enviar || a.nome.localeCompare(b.nome);
  });

  return {
    itens,
    urgentes: itens.filter((i) => i.naoChega),
    totalAEnviar: itens.reduce((s, i) => s + i.enviar, 0),
    totalAComprar: itens.reduce((s, i) => s + i.faltaComprar, 0),
    diasAteAlvo,
    alvoISO,
  };
}
