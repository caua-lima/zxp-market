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
  /** Itens de venda assistida (fallback de `vendasAtribuidas`). */
  indirectUnits?: number;
  /** "Vendas atribuídas" em UNIDADES (direta + assistida), como o painel conta. */
  vendasAtribuidas?: number | null;
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
   * Margem do produto ANTES de ads (lucro ÷ receita, em fração: 0,15 = 15%),
   * já com CMV, imposto, taxa do ML e frete do dia de cada venda. `null` =
   * sem custo cadastrado ou sem venda pra medir.
   *
   * É o que permite calcular o lucro da campanha sobre a receita que o ML
   * atribui a ELA (recurso de campanha), e não sobre a soma dos anúncios —
   * que vai pra campanha errada quando o anúncio troca de campanha.
   */
  margemAntesAds?: number | null;
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
   * Anúncios CADASTRADOS na campanha, como o painel do ML mostra ("3 anúncios
   * patrocinados"). `anuncios` acima conta só os que gastaram no período.
   * `null` = o ML não informou.
   */
  anunciosCadastrados: number | null;
  /** "Vendas atribuídas" do painel: unidades, direta + assistida. */
  vendasAtribuidas: number;
  /**
   * De onde vieram cliques, impressões, investido e receita atribuída:
   * "campanha" = do recurso de campanha do ML (bate com o painel);
   * "anuncios" = soma dos anúncios (quando a campanha não veio, ou quando o
   * ML ainda não consolidou ontem nela).
   */
  fonteMetricas: "campanha" | "anuncios";
  /**
   * O ML ainda não liberou na API pública a receita de ONTEM desta campanha:
   * o investido de ontem já está na conta, a venda de ontem ainda não. ROAS,
   * receita e lucro ficam MENORES do que serão — e a tela diz isso, em vez
   * de chamar de "rateado" (ver lib/domain/ads-consolidacao.ts).
   */
  receitaParcial: boolean;
  /**
   * ROAS (receita atribuída total ÷ investido) só dos dias que o ML já
   * consolidou. Com `receitaParcial`, é a melhor leitura do ROAS de verdade.
   */
  roasConsolidado: number | null;
  /**
   * Margem do produto ANTES de ads sobre a receita desta linha, em fração.
   * Base do ROAS de equilíbrio. `null` sem custo cadastrado/venda pra medir.
   */
  margemAntesAds: number | null;
  /**
   * ROAS mínimo pra campanha não dar prejuízo: 1 ÷ margem antes de ads. Na
   * mesma base da coluna ROAS (venda direta no modo "Publicidade direta").
   * Abaixo dele, cada real em ads devolve menos de um real de lucro bruto.
   * `null` quando a margem é desconhecida ou ≤ 0 (aí o produto não se paga
   * nem sem ads, e nenhum ROAS resolve).
   */
  roasEquilibrio: number | null;
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
export type MetricasReais = {
  clicks: number; prints: number; cost: number; receitaAtribuida: number;
  /** Receita das vendas diretas da campanha. Ausente = formato antigo. */
  receitaDireta?: number;
  /** Unidades atribuídas (direta + assistida). null/ausente = o ML não mandou. */
  vendasAtribuidas?: number | null;
  /** Unidades de venda direta. */
  vendasDiretas?: number | null;
  /** Nome no ML — lista a campanha mesmo sem nenhum anúncio com gasto. */
  nome?: string;
  /** "N anúncios patrocinados" do painel. */
  anunciosCadastrados?: number;
};

export type OpcoesAgregacao = {
  /**
   * O ML ainda não consolidou ONTEM no recurso de campanha (ver
   * lib/domain/ads-consolidacao.ts). Aí a campanha NÃO manda: ela está sem um
   * dia inteiro, e comparar com a soma dos anúncios acusaria "rateado" em
   * toda campanha. Usa-se a soma dos anúncios (que já tem o custo de ontem)
   * e marca-se a receita como parcial.
   */
  campanhasDefasadas?: boolean;
};

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
  opcoes: OpcoesAgregacao = {},
): CampanhaAgregada[] {
  const defasadas = !!opcoes.campanhasDefasadas;
  /**
   * `lucroAntesAds` e `custoDosQueContaram` sao internos: o lucro final e
   * calculado no fecho como (lucro bruto − custo EXIBIDO), pra o numero da
   * coluna sempre bater com o investimento da linha ao lado. Somar o liquido
   * anuncio a anuncio descontava o custo DERIVADO, que diverge do real
   * justamente nas campanhas com anuncio compartilhado.
   *
   * `margemPond*` acumulam a margem antes de ads dos produtos da campanha,
   * ponderada pela venda direta de cada um (ou pelo gasto, se ninguém vendeu
   * direto). É ela que se aplica sobre a receita que o ML atribui à CAMPANHA.
   */
  type Acc = CampanhaAgregada & {
    temDireto: boolean;
    lucroAntesAds: number;
    custoDosQueContaram: number;
    margemPondVenda: number; pesoVenda: number;
    margemPondCusto: number; pesoCusto: number;
  };
  const mapa = new Map<string, Acc>();

  const nova = (id: string, nome: string): Acc => ({
    campaignId: id,
    campaignName: nome || (id === CAMPANHA_SEM_ID ? "Sem campanha identificada" : id),
    anuncios: 0, prints: 0, clicks: 0, cost: 0, receita: 0, unidades: 0,
    // Calculado no fecho a partir de lucroAntesAds — aqui nao acumula nada.
    lucroAposAds: null, roas: null, acos: null, roasMlAds: null, receitaAtribuida: 0,
    // Preenchidos no fecho, a partir das metricas reais quando existirem.
    metricasDoMlAds: false, atribuicaoIncerta: false,
    lucroAproximado: false, avisoLucro: null,
    motivoSemLucro: null, motivoSemMargem: null,
    dailyBudget: 0, roasTarget: 0, margem: null,
    anunciosCadastrados: null, vendasAtribuidas: 0, fonteMetricas: "anuncios",
    receitaParcial: false, roasConsolidado: null, margemAntesAds: null, roasEquilibrio: null,
    temDireto: false, lucroAntesAds: 0, custoDosQueContaram: 0,
    margemPondVenda: 0, pesoVenda: 0, margemPondCusto: 0, pesoCusto: 0,
  });

  for (const i of itens) {
    const fatias = fatiasDe(i);
    // Base do rateio das métricas que existem só no nível do ANÚNCIO.
    const custoTotalItem = fatias.reduce((s, f) => s + f.cost, 0);

    for (const f of fatias) {
      const id = f.campaignId || CAMPANHA_SEM_ID;
      const atual = mapa.get(id) ?? nova(id, f.campaignName);
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
      atual.vendasAtribuidas += f.vendasAtribuidas ?? f.directUnits + (f.indirectUnits ?? 0);

      if (i.margemAntesAds != null) {
        atual.margemPondVenda += i.margemAntesAds * f.directSales;
        atual.pesoVenda += f.directSales;
        atual.margemPondCusto += i.margemAntesAds * f.cost;
        atual.pesoCusto += f.cost;
      }

      /**
       * No modo "publicidade direta" o lucro só existe pra anúncio com venda
       * vinculada. Somar 0 pelos outros faria a campanha parecer menos lucrativa
       * do que é — então só soma quem tem dado, e a campanha inteira fica sem
       * lucro (null) se NINGUÉM tiver.
       *
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

  /**
   * Campanha que o ML lista e que não teve NENHUM anúncio com gasto no
   * período (ex.: "Menta & Cereja - Full", 754 impressões e R$ 0). Sumia da
   * tela, e o app mostrava 14 campanhas contra 15 do painel.
   */
  for (const [id, real] of metricasReais ?? []) {
    if (mapa.has(id) || (real.cost <= 0 && real.prints <= 0 && real.receitaAtribuida <= 0)) continue;
    mapa.set(id, nova(id, real.nome ?? ""));
  }

  return Array.from(mapa.values())
    .map((c) => {
      const real = metricasReais?.get(c.campaignId) ?? null;
      /**
       * A campanha manda — exceto quando o ML ainda não consolidou ontem
       * nela. Aí ela está sem um dia inteiro, e os anúncios (que já têm o
       * custo de ontem) são a melhor fonte de investimento/cliques.
       */
      const usarReal = real != null && !defasadas;
      /**
       * Com o custo real em mãos, dá pra saber se a derivação era confiável:
       * se os anúncios somam o mesmo, cada um roda numa campanha só e a
       * repartição da nossa receita é fiel. Se não somam, não é.
       *
       * Com a campanha DEFASADA a comparação não vale nada (um lado está sem
       * ontem) — era ela que acendia "rateado" em 13 de 14 campanhas de um
       * anúncio só.
       */
      const atribuicaoIncerta = usarReal && !custoBate(c.cost, real.cost);
      /**
       * Defasada e com investimento acima do consolidado: o investido de
       * ontem já entrou nesta linha, a venda de ontem ainda não.
       */
      const receitaParcial = real != null && defasadas && !custoBate(c.cost, real.cost) && c.cost > real.cost;

      const prints = usarReal ? real.prints : c.prints;
      const clicks = usarReal ? real.clicks : c.clicks;
      const cost = usarReal ? real.cost : c.cost;
      const receitaAtribuida = usarReal ? real.receitaAtribuida : c.receitaAtribuida;
      const vendasAtribuidas = usarReal && real.vendasAtribuidas != null ? real.vendasAtribuidas : c.vendasAtribuidas;

      /**
       * ─── RECEITA DIRETA DA CAMPANHA, NÃO DOS ANÚNCIOS ──────────────────
       *
       * No modo "Publicidade direta" a receita vinha da soma dos anúncios, e
       * o `/ads/search` carimba o anúncio inteiro com a campanha ATUAL dele.
       * Anúncio que trocou de campanha no período levava a venda direta toda
       * pra campanha nova. O recurso de campanha sabe de quem foi cada venda.
       */
      const receitaDiretaReal = usarReal && real.receitaDireta != null ? real.receitaDireta : null;
      const receita = modo === "pub" && receitaDiretaReal != null ? receitaDiretaReal : c.receita;
      const unidades = modo === "pub" && usarReal && real.vendasDiretas != null ? real.vendasDiretas : c.unidades;

      /** Margem antes de ads dos produtos desta campanha (fração). */
      const margemProdutos = c.pesoVenda > 0 ? c.margemPondVenda / c.pesoVenda
        : c.pesoCusto > 0 ? c.margemPondCusto / c.pesoCusto : null;

      /**
       * ─── O LUCRO ────────────────────────────────────────────────────────
       *
       * Modo "pub" com margem conhecida: receita direta DA CAMPANHA × margem
       * dos produtos dela − investido da campanha. Exato quando a campanha
       * tem um produto (quase todas) e não depende de a receita dos anúncios
       * ter caído na campanha certa.
       *
       * Sem margem (dado antigo, sem `margemAntesAds`): o caminho de antes —
       * bruto somado anúncio a anúncio − custo EXIBIDO. Quando as métricas
       * reais chegam, o custo exibido é o do ML, então o descontado tem que
       * ser esse mesmo (`fatorCusto`); no modo "pub" só o custo de quem tem
       * venda vinculada entra (`custoDosQueContaram`).
       *
       * Modo "geral": a venda é NOSSA (pedidos), não do ML — não há como
       * saber de que campanha veio. Rateio pelo gasto, como sempre.
       */
      const viaMargem = modo === "pub" && margemProdutos != null;
      const fatorCusto = usarReal && c.cost > 0 ? real.cost / c.cost : 1;
      const lucroAposAds = viaMargem
        ? receita * margemProdutos - cost
        : c.temDireto ? c.lucroAntesAds - c.custoDosQueContaram * fatorCusto : null;

      /**
       * ─── ATRIBUICAO INCERTA MOSTRA O NUMERO, COM AVISO ─────────────────
       *
       * O que e incerto NAO e o lucro: e o RATEIO da receita entre as
       * campanhas que dividem um anuncio. A estimativa e defensavel (rateio
       * proporcional ao gasto de cada uma) e a ordem de grandeza esta certa.
       * Esconder um numero util pra evitar um erro de centavos troca uma
       * imprecisao pequena por uma cegueira total.
       *
       * No modo "pub" pela margem, a receita já é a da campanha (do ML) — não
       * há rateio, e o aviso de rateio não se aplica.
       */
      const rateado = atribuicaoIncerta && !viaMargem;
      const lucroAproximado = lucroAposAds != null && (rateado || receitaParcial);
      const avisoLucro = !lucroAproximado ? null
        : receitaParcial
          ? "O Mercado Livre ainda nao liberou na API a venda de ONTEM desta campanha: o investido de ontem ja esta na conta, "
            + "a receita de ontem ainda nao. Receita, ROAS e lucro vao subir quando o ML consolidar o dia (normalmente ainda hoje). "
            + "Investimento e cliques ja batem com o painel."
          : "Algum anuncio desta campanha roda em outra tambem, e o Mercado Livre entrega as metricas dele ja somadas, "
            + "sem dizer quanto foi de cada. Investimento, cliques e impressoes acima sao os da CAMPANHA e batem com o painel. "
            + "Ja a receita e o lucro sao a sua venda repartida entre as campanhas na proporcao do que cada uma gastou — "
            + "melhor estimativa disponivel, boa pra decidir onde mexer, nao pra conferir centavo.";

      /**
       * O motivo e tao importante quanto o numero: cada caso pede uma acao
       * diferente — cadastrar custo ou esperar venda.
       */
      const motivoSemLucro = lucroAposAds != null ? null
        : c.anuncios === 0
          ? (cost <= 0
            ? "Campanha nao investiu no periodo."
            : "Nenhum anuncio desta campanha aparece na listagem do periodo — sem produto, nao ha margem pra calcular.")
          : receita <= 0
            ? "Nenhuma venda atribuida a esta campanha no periodo."
            : "Produto sem custo cadastrado no Estoque — sem custo nao ha lucro a calcular.";
      /** Margem so existe com lucro conhecido E receita pra dividir. */
      const margem = lucroAposAds != null && receita > 0 ? (lucroAposAds / receita) * 100 : null;
      const motivoSemMargem = margem != null ? null
        : motivoSemLucro
          ?? "Campanha gastou e nao registrou receita no periodo — margem sobre receita zero nao existe. O prejuizo e o proprio investido.";

      /**
       * Margem antes de ads da LINHA, na mesma base da receita exibida. Pelo
       * caminho da margem é a dos produtos; senão sai do próprio lucro
       * (lucro + investido = lucro antes de ads).
       */
      const margemAntesAds = viaMargem ? margemProdutos
        : lucroAposAds != null && receita > 0 ? (lucroAposAds + cost) / receita : null;
      const roasEquilibrio = margemAntesAds != null && margemAntesAds > 0 ? 1 / margemAntesAds : null;

      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName || real?.nome || c.campaignId,
        anuncios: c.anuncios,
        anunciosCadastrados: real?.anunciosCadastrados ?? null,
        prints,
        clicks,
        cost,
        metricasDoMlAds: usarReal,
        fonteMetricas: usarReal ? "campanha" as const : "anuncios" as const,
        atribuicaoIncerta: rateado,
        receitaParcial,
        roasConsolidado: real != null && real.cost > 0 ? real.receitaAtribuida / real.cost : null,
        lucroAproximado,
        avisoLucro,
        motivoSemLucro,
        motivoSemMargem,
        receita,
        unidades,
        vendasAtribuidas,
        lucroAposAds,
        roas: cost > 0 ? receita / cost : null,
        // ACOS = investido ÷ receita. Sem receita não é "infinito", é indefinido.
        acos: receita > 0 ? (cost / receita) * 100 : null,
        roasMlAds: cost > 0 ? receitaAtribuida / cost : null,
        receitaAtribuida,
        dailyBudget: c.dailyBudget,
        roasTarget: c.roasTarget,
        margem,
        margemAntesAds,
        roasEquilibrio,
      };
    })
    // Maior investimento primeiro: é onde uma decisão errada custa mais caro.
    .sort((a, b) => b.cost - a.cost);
}
