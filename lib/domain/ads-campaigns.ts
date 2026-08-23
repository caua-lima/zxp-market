/**
 * Agregação de métricas por CAMPANHA. A aba Ads sempre mostrou o funil do
 * período inteiro (todas as campanhas somadas), o que esconde o caso mais
 * comum na prática: uma campanha saudável carregando outra que sangra. Aqui
 * cada campanha vira uma linha própria, com o mesmo funil aplicado só a ela.
 *
 * Puro de propósito (sem React/fetch): a soma que decide onde o dinheiro está
 * indo precisa ser testável sem subir tela nenhuma.
 */

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

export function agregarPorCampanha(
  itens: ItemParaCampanha[],
  modo: "pub" | "geral",
): CampanhaAgregada[] {
  const mapa = new Map<string, CampanhaAgregada & { temDireto: boolean }>();

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
        lucroAposAds: 0, roas: null, acos: null, roasMlAds: null, receitaAtribuida: 0,
        dailyBudget: 0, roasTarget: 0, margem: null,
        temDireto: false,
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
      if (modo === "pub") {
        if (i.diretoDisponivel) {
          atual.temDireto = true;
          atual.lucroAposAds = (atual.lucroAposAds ?? 0) + i.lucroDiretoLiquido * peso;
        }
      } else {
        atual.temDireto = true;
        atual.lucroAposAds = (atual.lucroAposAds ?? 0) + i.lucroLiquido * peso;
      }

      mapa.set(id, atual);
    }
  }

  return Array.from(mapa.values())
    .map((c) => {
      const lucroAposAds = c.temDireto ? c.lucroAposAds : null;
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        anuncios: c.anuncios,
        prints: c.prints,
        clicks: c.clicks,
        cost: c.cost,
        receita: c.receita,
        unidades: c.unidades,
        lucroAposAds,
        roas: c.cost > 0 ? c.receita / c.cost : null,
        // ACOS = investido ÷ receita. Sem receita não é "infinito", é indefinido.
        acos: c.receita > 0 ? (c.cost / c.receita) * 100 : null,
        roasMlAds: c.cost > 0 ? c.receitaAtribuida / c.cost : null,
        receitaAtribuida: c.receitaAtribuida,
        dailyBudget: c.dailyBudget,
        roasTarget: c.roasTarget,
        margem: lucroAposAds != null && c.receita > 0 ? (lucroAposAds / c.receita) * 100 : null,
      };
    })
    // Maior investimento primeiro: é onde uma decisão errada custa mais caro.
    .sort((a, b) => b.cost - a.cost);
}
