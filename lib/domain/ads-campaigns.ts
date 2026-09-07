/**
 * Agregação de métricas por CAMPANHA. A aba Ads sempre mostrou o funil do
 * período inteiro (todas as campanhas somadas), o que esconde o caso mais
 * comum na prática: uma campanha saudável carregando outra que sangra. Aqui
 * cada campanha vira uma linha própria, com o mesmo funil aplicado só a ela.
 *
 * Puro de propósito (sem React/fetch): a soma que decide onde o dinheiro está
 * indo precisa ser testável sem subir tela nenhuma.
 */

/**
 * Como a campanha se chama na tela.
 *
 * ─── POR QUE O PREFIXO ──────────────────────────────────────────────────
 *
 * A visão analítica é uma linha por ANÚNCIO, e a coluna de identidade era o
 * título do produto. Só que a decisão que se toma ali é sobre CAMPANHA —
 * pausar, subir orçamento, mexer no ROAS objetivo — e ler nome de produto
 * numa tela onde se age sobre campanha obriga a traduzir de cabeça a cada
 * linha, com dois produtos de nome parecido em campanhas diferentes.
 *
 * O prefixo entra só quando o nome ainda não o tem: o vendedor batiza a
 * campanha no ML, e várias já se chamam "Campanha X". "Campanha Campanha X"
 * seria pior que não ter prefixo nenhum.
 */
export function rotuloCampanha(nome: string | null | undefined): string {
  const n = String(nome ?? "").trim();
  if (!n) return "Sem campanha";
  return /^campanha\b/i.test(n) ? n : `Campanha ${n}`;
}

/** Fatia do investimento de um anúncio dentro de UMA campanha. */
export type FatiaCampanha = {
  campaignId: string;
  campaignName: string;
  clicks: number;
  prints: number;
  cost: number;
  directSales: number;
  directUnits: number;
  /** Receita atribuída TOTAL (direta + assistida) — é a que o painel do ML usa no ROAS. */
  sales?: number;
  units?: number;
};

export type ItemParaCampanha = {
  campaignId: string;
  campaignName: string;
  clicks: number;
  prints: number;
  cost: number;
  directSales: number;
  directUnits: number;
  /** Configuracao da campanha no painel do ML — orcamento diario e ROAS objetivo. */
  dailyBudget?: number;
  roasTarget?: number;
  totalSales: number;
  totalUnits: number;
  lucroLiquido: number;
  lucroDiretoLiquido: number;
  /** false = sem venda vinculada no período; o lucro "direto" não dá pra afirmar. */
  diretoDisponivel: boolean;
  /**
   * O gasto deste anúncio quebrado por campanha (ver AdItemFull.campanhas).
   * Quando presente, é ELE que manda — os campos de topo são o total do
   * anúncio somando todas as campanhas, e usar esse total aqui era o bug que
   * fazia uma campanha aparecer com o gasto de duas.
   */
  campanhas?: FatiaCampanha[];
};

/**
 * As fatias por campanha de um anúncio, com fallback pro formato antigo.
 *
 * Anúncio que rodou numa campanha só produz exatamente uma fatia — idêntica
 * ao total. Quem rodou em duas produz duas, e é aí que a conta muda.
 */
function fatiasDe(i: ItemParaCampanha): FatiaCampanha[] {
  if (i.campanhas && i.campanhas.length > 0) return i.campanhas;
  return [{
    campaignId: i.campaignId,
    campaignName: i.campaignName,
    clicks: i.clicks,
    prints: i.prints,
    cost: i.cost,
    directSales: i.directSales,
    directUnits: i.directUnits,
  }];
}

export type CampanhaAgregada = {
  campaignId: string;
  campaignName: string;
  anuncios: number;
  prints: number;
  clicks: number;
  cost: number;
  /** Receita e lucro no modo escolhido (direta = só venda atribuída ao clique). */
  receita: number;
  unidades: number;
  /** null quando NENHUM anúncio da campanha tem venda vinculada — não é zero, é falta de dado. */
  lucroAposAds: number | null;
  roas: number | null;
  acos: number | null;
  /**
   * ROAS como o painel do Mercado Ads mostra: receita atribuída TOTAL ÷
   * investido. É o número pra conferir contra o ML — o `roas` acima segue o
   * modo escolhido na tela e por isso difere de propósito.
   */
  roasMlAds: number | null;
  /** Receita atribuída total pelo ML nesta campanha (base do roasMlAds). */
  receitaAtribuida: number;
  /**
   * As métricas vieram do PRÓPRIO recurso de campanha do ML (batem com o
   * painel), e não da soma dos anúncios.
   */
  metricasDoMlAds: boolean;
  /**
   * O custo somado dos anúncios NÃO bate com o da campanha — sinal de que
   * algum anúncio roda em mais de uma campanha e o ML entrega as métricas
   * dele já somadas, sem dizer quanto foi de cada. Quando isso acontece não
   * dá pra dividir a NOSSA receita (que vem dos pedidos, não do ML) entre as
   * campanhas, e o lucro da campanha sai como indisponível em vez de errado.
   */
  atribuicaoIncerta: boolean;
  /**
   * Por que nao ha lucro a mostrar. `null` quando ha.
   *
   * Um traco mudo na coluna nao diz se o problema e do produto, do periodo
   * ou da campanha — e sem saber qual, nao da pra corrigir. A coluna passa a
   * carregar sempre um dos dois: o numero, ou o que falta pra te-lo.
   */
  motivoSemLucro: string | null;
  /**
   * O lucro e a margem saem de um RATEIO, nao de um numero que o ML entregou.
   *
   * Acontece quando um anuncio roda em mais de uma campanha: o ML devolve as
   * metricas dele ja somadas, sem dizer quanto foi de cada. A receita das
   * nossas vendas e entao repartida na proporcao do que cada campanha gastou.
   *
   * O numero continua util — e a melhor estimativa disponivel e a ordem de
   * grandeza esta certa. So nao serve pra conferir centavo contra o painel.
   */
  lucroAproximado: boolean;
  /** O que exatamente foi estimado. `null` quando o numero e exato. */
  avisoLucro: string | null;
  /**
   * Por que nao ha margem a mostrar. `null` quando ha.
   *
   * Margem e lucro/receita: some tambem quando o lucro EXISTE mas a receita e
   * zero — campanha que gastou e nao vendeu tem prejuizo conhecido e margem
   * indefinida (divisao por zero). Sem este campo esse caso caia num traco
   * mudo sem nem tooltip, que e o unico jeito de nao dizer nada.
   */
  motivoSemMargem: string | null;
  /**
   * Orcamento diario e ROAS objetivo configurados na campanha. Vem do anuncio
   * (a config e da campanha, entao todos os anuncios dela trazem o mesmo
   * valor); 0 = o ML nao devolveu a configuracao.
   */
  dailyBudget: number;
  roasTarget: number;
  /**
   * Margem do lucro após ads sobre a receita da campanha, em %.
   *
   * O lucro em reais sozinho engana ao comparar campanhas de tamanhos
   * diferentes: R$ 373 numa que faturou R$ 2.369 é 15,8%; R$ 125 numa de
   * R$ 992 é 12,7% — quem só olha o valor absoluto escala a errada.
   * null quando não há lucro apurado ou receita.
   */
  margem: number | null;
};

/** Anúncio sem campanha identificada — agrupado à parte pra não sumir da soma. */
export const CAMPANHA_SEM_ID = "__sem_campanha__";

/** Métricas que o ML devolve para a própria campanha — a fonte autoritativa. */
export type MetricasReais = { clicks: number; prints: number; cost: number; receitaAtribuida: number };

/**
 * Quanto o custo derivado pode divergir do real antes de a atribuição virar
 * suspeita. Dois centavos ou 2% cobrem arredondamento e o atraso normal entre
 * as duas consultas; acima disso é anúncio rodando em mais de uma campanha.
 */
function custoBate(derivado: number, real: number): boolean {
  return Math.abs(derivado - real) <= Math.max(0.02 * real, 0.02);
}

export function agregarPorCampanha(
  itens: ItemParaCampanha[],
  modo: "pub" | "geral",
  /**
   * campaignId → métricas do recurso de campanha. Quando presentes MANDAM
   * sobre a soma dos anúncios: `/ads/search` devolve uma linha por anúncio
   * com as métricas somadas de TODAS as campanhas dele, carimbada num
   * campaign_id só — medido, isso fazia uma campanha aparecer com 361 cliques
   * e R$ 95,94 quando o ML mostrava 259 e R$ 65,26.
   */
  metricasReais?: Map<string, MetricasReais>,
): CampanhaAgregada[] {
  /**
   * `lucroAntesAds` e `custoDosQueContaram` sao internos: o lucro final e
   * calculado no fecho como (lucro bruto − custo EXIBIDO), pra o numero da
   * coluna sempre bater com o investimento da linha ao lado. Somar o liquido
   * anuncio a anuncio descontava o custo DERIVADO, que diverge do real
   * justamente nas campanhas com anuncio compartilhado.
   */
  const mapa = new Map<string, CampanhaAgregada & {
    temDireto: boolean;
    lucroAntesAds: number;
    custoDosQueContaram: number;
  }>();

  for (const i of itens) {
    const fatias = fatiasDe(i);
    // Base do rateio das métricas que existem só no nível do ANÚNCIO.
    const custoTotalItem = fatias.reduce((s, f) => s + f.cost, 0);

    for (const f of fatias) {
      const id = f.campaignId || CAMPANHA_SEM_ID;
      const atual = mapa.get(id) ?? {
        campaignId: id,
        campaignName: f.campaignName || (id === CAMPANHA_SEM_ID ? "Sem campanha identificada" : id),
        anuncios: 0, prints: 0, clicks: 0, cost: 0, receita: 0, unidades: 0,
        // Calculado no fecho a partir de lucroAntesAds — aqui nao acumula nada.
        lucroAposAds: null, roas: null, acos: null, roasMlAds: null, receitaAtribuida: 0,
        // Preenchidos no fecho, a partir das metricas reais quando existirem.
        metricasDoMlAds: false, atribuicaoIncerta: false,
        lucroAproximado: false, avisoLucro: null,
        motivoSemLucro: null, motivoSemMargem: null,
        dailyBudget: 0, roasTarget: 0, margem: null,
        temDireto: false, lucroAntesAds: 0, custoDosQueContaram: 0,
      };
      // A config e da CAMPANHA: o primeiro anuncio que a trouxer ja define.
      if (!atual.dailyBudget && i.dailyBudget) atual.dailyBudget = i.dailyBudget;
      if (!atual.roasTarget && i.roasTarget) atual.roasTarget = i.roasTarget;
      if (!atual.campaignName && f.campaignName) atual.campaignName = f.campaignName;

      atual.anuncios += 1;
      atual.prints += f.prints;
      atual.clicks += f.clicks;
      atual.cost += f.cost;

      /**
       * Peso do rateio: a receita TOTAL e o lucro do modo "geral" são do
       * anúncio inteiro — uma venda orgânica não sabe de qual campanha veio.
       * Com o anúncio em duas campanhas, dividir na proporção do que cada uma
       * gastou é a única repartição defensável (e some quando há campanha
       * única, que é o caso normal: peso 1).
       */
      const peso = custoTotalItem > 0 ? f.cost / custoTotalItem : 1 / fatias.length;

      // No modo "pub" a receita é a atribuída ao clique — já vem por campanha,
      // sem rateio nenhum.
      atual.receita += modo === "pub" ? f.directSales : i.totalSales * peso;
      atual.unidades += modo === "pub" ? f.directUnits : i.totalUnits * peso;
      // Receita atribuída pelo ML — independe do modo, serve só pra conferência.
      atual.receitaAtribuida += f.sales ?? f.directSales;

      /**
       * No modo "publicidade direta" o lucro só existe pra anúncio com venda
       * vinculada. Somar 0 pelos outros faria a campanha parecer menos lucrativa
       * do que é — então só soma quem tem dado, e a campanha inteira fica sem
       * lucro (null) se NINGUÉM tiver.
       */
      /**
       * `lucroLiquido` e `lucroDiretoLiquido` ja vem com o custo do anuncio
       * INTEIRO descontado; somar `i.cost` de volta devolve o bruto, que e o
       * que se rateia. O custo entra uma vez so, no fecho.
       */
      if (modo === "pub") {
        if (i.diretoDisponivel) {
          atual.temDireto = true;
          atual.lucroAntesAds += (i.lucroDiretoLiquido + i.cost) * peso;
          atual.custoDosQueContaram += f.cost;
        }
      } else {
        atual.temDireto = true;
        atual.lucroAntesAds += (i.lucroLiquido + i.cost) * peso;
        atual.custoDosQueContaram += f.cost;
      }

      mapa.set(id, atual);
    }
  }

  return Array.from(mapa.values())
    .map((c) => {
      const real = metricasReais?.get(c.campaignId) ?? null;
      /**
       * Com o custo real em mãos, dá pra saber se a derivação era confiável:
       * se os anúncios somam o mesmo, cada um roda numa campanha só e a
       * repartição da nossa receita é fiel. Se não somam, não é.
       */
      const atribuicaoIncerta = real != null && !custoBate(c.cost, real.cost);
      const prints = real?.prints ?? c.prints;
      const clicks = real?.clicks ?? c.clicks;
      const cost = real?.cost ?? c.cost;
      const receitaAtribuida = real?.receitaAtribuida ?? c.receitaAtribuida;
      /**
       * ─── ATRIBUICAO INCERTA MOSTRA O NUMERO, COM AVISO ─────────────────
       *
       * Antes o lucro saia como indisponivel aqui, e a coluna virava um
       * paragrafo de explicacao — em 6 das 15 campanhas desta conta. A tela
       * ficava ilegivel e, pior, deixava de responder a unica pergunta que
       * justifica ela existir.
       *
       * O que e incerto NAO e o lucro: e o RATEIO da receita entre as
       * campanhas que dividem um anuncio. A estimativa e defensavel (rateio
       * proporcional ao gasto de cada uma) e a ordem de grandeza esta certa.
       * Esconder um numero util pra evitar um erro de centavos troca uma
       * imprecisao pequena por uma cegueira total.
       *
       * ─── O CUSTO DESCONTADO E O QUE ESTA NA TELA ───────────────────────
       *
       * O lucro sai de (bruto rateado − custo). Quando as metricas reais
       * chegam, o custo exibido e o do ML, entao o descontado tem que ser
       * esse mesmo — senao a linha mostraria lucro de um investimento e
       * investimento de outro. `fatorCusto` reajusta na mesma proporcao.
       *
       * No modo "pub" so os anuncios com venda vinculada entram no bruto, e
       * so o custo DELES e descontado (`custoDosQueContaram`): descontar a
       * campanha inteira faria a parte medida parecer pior do que e.
       */
      const fatorCusto = real != null && c.cost > 0 ? real.cost / c.cost : 1;
      const custoDescontado = c.custoDosQueContaram * fatorCusto;
      const lucroAposAds = c.temDireto ? c.lucroAntesAds - custoDescontado : null;

      const lucroAproximado = lucroAposAds != null && atribuicaoIncerta;
      const avisoLucro = !lucroAproximado ? null
        : "Algum anuncio desta campanha roda em outra tambem, e o Mercado Livre entrega as metricas dele ja somadas, "
          + "sem dizer quanto foi de cada. Investimento, cliques e impressoes acima sao os da CAMPANHA e batem com o painel. "
          + "Ja a receita e o lucro sao a sua venda repartida entre as campanhas na proporcao do que cada uma gastou — "
          + "melhor estimativa disponivel, boa pra decidir onde mexer, nao pra conferir centavo.";

      /**
       * O motivo e tao importante quanto o numero: cada caso pede uma acao
       * diferente — cadastrar custo ou esperar venda.
       */
      const motivoSemLucro = lucroAposAds != null ? null
        : c.receita <= 0
          ? "Nenhuma venda atribuida a esta campanha no periodo."
          : "Produto sem custo cadastrado no Estoque — sem custo nao ha lucro a calcular.";
      const receita = c.receita;
      /** Margem so existe com lucro conhecido E receita pra dividir. */
      const margem = lucroAposAds != null && receita > 0 ? (lucroAposAds / receita) * 100 : null;
      const motivoSemMargem = margem != null ? null
        : motivoSemLucro
          ?? "Campanha gastou e nao registrou receita no periodo — margem sobre receita zero nao existe. O prejuizo e o proprio investido.";
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        anuncios: c.anuncios,
        prints,
        clicks,
        cost,
        metricasDoMlAds: real != null,
        atribuicaoIncerta,
        lucroAproximado,
        avisoLucro,
        motivoSemLucro,
        motivoSemMargem,
        receita,
        unidades: c.unidades,
        lucroAposAds,
        roas: cost > 0 ? receita / cost : null,
        // ACOS = investido ÷ receita. Sem receita não é "infinito", é indefinido.
        acos: receita > 0 ? (cost / receita) * 100 : null,
        roasMlAds: cost > 0 ? receitaAtribuida / cost : null,
        receitaAtribuida,
        dailyBudget: c.dailyBudget,
        roasTarget: c.roasTarget,
        margem,
      };
    })
    // Maior investimento primeiro: é onde uma decisão errada custa mais caro.
    .sort((a, b) => b.cost - a.cost);
}
