"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { linhaCsvSegura } from "@/lib/domain/csv-seguro";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
import { calculateBreakEvenRoas, calculateTargetRoas, getAdRecommendation, lucroNoRoas, motivoSemBreakEven, motivoSemRoasIdeal } from "@/lib/domain/ads";
import { calculateAdsReconciliation } from "@/lib/domain/ads-reconciliation";
import { derivarPeriodoAnterior, periodoAnteriorTemDadosSuficientes } from "@/lib/domain/ads-comparison";
import { formatarResumoAlteracao } from "@/lib/domain/ads-changelog";
import type { AdsAlteracao, Product } from "@/lib/domain/types";
import { watchAdsAlteracoes } from "@/lib/firebase/data";
import AdsChangelogPanel from "@/components/tabs/ads/AdsChangelogPanel";
import AdsModeDescription from "@/components/tabs/ads/AdsModeDescription";
import AdsOverview, { type OverviewTotais } from "@/components/tabs/ads/AdsOverview";
import AdsFunnel from "@/components/tabs/ads/AdsFunnel";
import AdsCampaignList from "@/components/tabs/ads/AdsCampaignList";
import AdsParticipacao from "@/components/tabs/ads/AdsParticipacao";
import AdsDecisionPanel from "@/components/tabs/ads/AdsDecisionPanel";
import AdsChat from "@/components/tabs/ads/AdsChat";
import AdsDataQuality from "@/components/tabs/ads/AdsDataQuality";
import AdsFilters, { AdsStatusQuickFilters, type FiltrosAdsState } from "@/components/tabs/ads/AdsFilters";
import AdsTable from "@/components/tabs/ads/AdsTable";
import TelaHeader from "@/components/TelaHeader";
import { ORDEM_INICIAL, type OrdemAds } from "@/lib/domain/ads-ordenacao";
import AdDetailDrawer from "@/components/tabs/ads/AdDetailDrawer";
import { num, type AdItem, type LinhaAds, type Modo, type StatusAnuncio } from "@/components/tabs/ads/ads-types";

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Mês atual até hoje (igual ao painel do Mercado Ads) — do dia 1º até agora.
function mesAteHoje() {
  const d = new Date();
  return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: isoOf(d) };
}

type Totais = {
  cost: number; clicks: number; prints: number; direct: number; directUn: number;
  adSales: number; total: number; totalUn: number; lucroAntes: number; lucroLiq: number;
  lucroLiqDireto: number; semDadoDireto: number; lucroDiretoAntes: number;
  /** Anúncios fora do lucro por falta de custo cadastrado. */
  semCusto: number;
};

function agregar(items: AdItem[]): Totais {
  return items.reduce((a, i) => {
    a.cost += i.cost; a.clicks += i.clicks; a.prints += i.prints;
    a.direct += i.directSales; a.directUn += i.directUnits;
    a.adSales += i.adSales; a.total += i.totalSales; a.totalUn += i.totalUnits;
    /**
     * Sem custo cadastrado o anúncio fica FORA do lucro, não entra como se
     * fosse lucro cheio. Antes somava com CMV zero e inflava o total da aba,
     * que por isso discordava do Dashboard.
     */
    if (i.custoDisponivel) { a.lucroAntes += i.lucroAntesAds; a.lucroLiq += i.lucroLiquido; }
    else a.semCusto += 1;
    if (i.diretoDisponivel) { a.lucroLiqDireto += i.lucroDiretoLiquido; a.lucroDiretoAntes += i.lucroDiretoAntesAds; }
    else a.semDadoDireto += 1;
    return a;
  }, { cost: 0, clicks: 0, prints: 0, direct: 0, directUn: 0, adSales: 0, total: 0, totalUn: 0, lucroAntes: 0, lucroLiq: 0, lucroLiqDireto: 0, semDadoDireto: 0, lucroDiretoAntes: 0, semCusto: 0 });
}

function paraOverview(t: Totais, pub: boolean): OverviewTotais {
  const vendasTot = pub ? t.direct : t.total;
  const unTot = pub ? t.directUn : t.totalUn;
  const roas = t.cost > 0 ? vendasTot / t.cost : 0;
  const acos = vendasTot > 0 ? (t.cost / vendasTot) * 100 : 0;
  const lucroAposAds = pub ? t.lucroLiqDireto : t.lucroLiq;
  const lucroAntesAds = pub ? t.lucroDiretoAntes : t.lucroAntes;
  return {
    investimento: t.cost,
    receita: vendasTot,
    lucroAposAds,
    eficiencia: pub ? roas : acos,
    impressoes: t.prints, clicks: t.clicks,
    ctr: t.prints > 0 ? (t.clicks / t.prints) * 100 : 0,
    cpc: t.clicks > 0 ? t.cost / t.clicks : 0,
    vendas: unTot, unidades: unTot,
    acosOuTacosComplementar: pub ? acos : roas,
    margemMedia: vendasTot > 0 ? (lucroAposAds / vendasTot) * 100 : null,
    lucroAntesAds,
  };
}

export default function AdsTab({ metaMargem = 10, products = [] }: { metaMargem?: number; products?: Product[] }) {
  const [range, setRange] = useState(() => mesAteHoje());

  /**
   * ─── CAMPANHA E ANÚNCIO SÃO PERGUNTAS DIFERENTES ─────────────────────
   *
   * A aba era uma rolagem só: visão geral, participação, funil, campanhas,
   * decisões, qualidade do dado e a tabela analítica, tudo empilhado. Quem
   * abria pra responder "qual campanha está sangrando?" passava por quatro
   * blocos de anúncio antes; quem abria pra responder "este anúncio dá
   * lucro?" rolava por quatro blocos de campanha.
   *
   * E há uma diferença que a rolagem escondia: ORÇAMENTO é da campanha e
   * não do anúncio. Somar orçamento por anúncio conta a mesma verba tantas
   * vezes quantos anúncios a campanha tiver — e com os dois no mesmo scroll,
   * nada impede alguém de fazer essa soma de cabeça.
   *
   * Decisões é o padrão: é o que se faz com a informação, e não a
   * informação.
   */
  const [vista, setVista] = useState<"decisoes" | "campanhas" | "anuncios">("decisoes");
  const [modo, setModo] = useState<Modo>("pub");
  const [items, setItems] = useState<AdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const [itemsAnterior, setItemsAnterior] = useState<AdItem[] | null>(null);
  const periodoAnterior = useMemo(() => derivarPeriodoAnterior(range, isoOf(new Date())), [range]);

  /**
   * Dias do periodo — entra na CONFIANCA das recomendacoes, nao no calculo.
   * Dois dias de dados nao sustentam decisao de verba por maior que seja o
   * numero que aparece.
   */
  const diasDoPeriodo = useMemo(() => {
    const ms = Date.parse(range.to + "T00:00:00Z") - Date.parse(range.from + "T00:00:00Z");
    return Number.isFinite(ms) ? Math.max(Math.round(ms / 86400000) + 1, 1) : 1;
  }, [range]);

  const [busca, setBusca] = useState("");
  // A ordem da tabela mora aqui: o seletor "Ordenar por" e o cabeçalho mexem no mesmo estado,
  // e ela não se perde quando a tabela desmonta (filtro que zera a lista, por exemplo).
  const [ordemAds, setOrdemAds] = useState<OrdemAds>(ORDEM_INICIAL);
  const [statusFiltro, setStatusFiltro] = useState<StatusAnuncio | "">("");
  const [lucroFiltro, setLucroFiltro] = useState<"" | "lucro" | "prejuizo">("");
  const [roasMin, setRoasMin] = useState("");
  const [roasMax, setRoasMax] = useState("");
  const [acosMin, setAcosMin] = useState("");
  const [acosMax, setAcosMax] = useState("");
  const [investMin, setInvestMin] = useState("");
  const [investMax, setInvestMax] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  type Tentativa = { tentativa: string; status?: number; body?: string; erro?: string };
  const [diag, setDiag] = useState<{
    advertisersStatus?: number; itemsStatus?: number; itemsStatusV1?: number; itemsStatusV2?: number;
    advertiserId?: number | string; conta?: { tokenNickname?: string; mesmaConta?: boolean };
    tentativas?: Tentativa[]; periodo?: { from?: string; to?: string };
  } | null>(null);
  const [cfgDiag, setCfgDiag] = useState<{ url: string; status: number }[]>([]);
  const [cfgAmostra, setCfgAmostra] = useState<{ campanha?: unknown; campanhaOrfa?: unknown } | null>(null);
  const [campanhasEncontradas, setCampanhasEncontradas] = useState(0);
  const [semGastoNoPeriodo, setSemGastoNoPeriodo] = useState(0);
  const [campanhasTotal, setCampanhasTotal] = useState(0);
  const [campanhasResumo, setCampanhasResumo] = useState<{
    id: string; name: string; status: string; gasto: number; totalAds: number;
    real?: { clicks: number; prints: number; cost: number; receitaAtribuida: number } | null;
  }[]>([]);
  const [anunciosTotal, setAnunciosTotal] = useState(0);
  const [anunciosNoPeriodo, setAnunciosNoPeriodo] = useState(0);
  const [anunciosContagemFalhou, setAnunciosContagemFalhou] = useState(false);
  const [gastoOrfao, setGastoOrfao] = useState(0);
  const [gastoSemVinculo, setGastoSemVinculo] = useState(0);
  const [campanhasOrfas, setCampanhasOrfas] = useState<string[]>([]);
  /**
   * Métricas que o ML devolve pra cada campanha no período. São ELAS que
   * batem com o painel do Mercado Ads — a soma dos anúncios não bate quando
   * um anúncio roda em mais de uma campanha (ver agregarPorCampanha).
   */
  const metricasReaisPorCampanha = useMemo(() => {
    const m = new Map<string, { clicks: number; prints: number; cost: number; receitaAtribuida: number }>();
    for (const c of campanhasResumo) if (c.id && c.real) m.set(String(c.id), c.real);
    return m;
  }, [campanhasResumo]);

  const [conta, setConta] = useState<{ receita: number; unidades: number; lucroAntesAds: number; itens: number } | null>(null);

  const [drawerItemId, setDrawerItemId] = useState<string | null>(null);
  const [changelogCampanhaInicial, setChangelogCampanhaInicial] = useState<string | undefined>(undefined);
  const [changelog, setChangelog] = useState<AdsAlteracao[]>([]);
  useEffect(() => watchAdsAlteracoes(setChangelog), []);

  const load = useCallback(async () => {
    setLoading(true); setErro(null); setDiag(null);
    try {
      const r = await authedFetch(`/api/ml/ads?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) {
        setDiag(j.diag ?? null);
        setErro(j.diag ? JSON.stringify(j.diag, null, 2) : (j.details ?? j.error));
        setItems([]);
      } else {
        setItems(j.items ?? []);
        setCfgDiag(j.cfgDiag ?? []);
        setCfgAmostra(j.cfgAmostra ?? null);
        setCampanhasEncontradas(j.campanhasEncontradas ?? 0);
        setSemGastoNoPeriodo(j.semGastoNoPeriodo ?? 0);
        setCampanhasTotal(j.campanhasTotal ?? 0);
        setCampanhasResumo(j.campanhasResumo ?? []);
        setAnunciosTotal(j.anunciosTotal ?? 0);
        setAnunciosNoPeriodo(j.anunciosNoPeriodo ?? 0);
        setAnunciosContagemFalhou(!!j.anunciosContagemFalhou);
        setGastoOrfao(j.gastoOrfao ?? 0);
        setGastoSemVinculo(j.gastoSemVinculo ?? 0);
        setCampanhasOrfas(j.campanhasOrfas ?? []);
        setConta(j.conta ?? null);
        setAtualizadoEm(new Date());
      }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [range]);

  /**
   * Atualização COMPLETA: ressincroniza os pedidos do período antes de
   * recarregar.
   *
   * O `load()` sozinho já busca o Ads ao vivo, mas o outro lado da conta —
   * receita, frete, cancelamento — vem do que o sync gravou. Sem ressincronizar,
   * apertar "Atualizar" trazia gasto de agora contra venda de horas atrás, e o
   * ROAS saía de uma comparação desalinhada. Mesmo padrão da aba Pedidos.
   */
  const [ressincronizando, setRessincronizando] = useState(false);
  const atualizarTudo = useCallback(async () => {
    setRessincronizando(true);
    try {
      // Best-effort: sync que falha não pode impedir a releitura do Ads.
      await authedFetch(`/api/ml/sync-all?from=${range.from}&to=${range.to}`, { method: "POST" }).catch(() => null);
      await load();
    } finally {
      setRessincronizando(false);
    }
  }, [range, load]);

  // Falso positivo comprovado (mesmo padrão já documentado em PedidosTab.tsx/
  // AdsTab.tsx anterior): fetch disparado por mudança de período — load() faz
  // setState de forma assíncrona, não o corpo do efeito em si.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Período anterior: melhor esforço, silencioso — sem período anterior
  // comparável, a comparação simplesmente não aparece (nunca trava a tela
  // principal por causa disso).
  useEffect(() => {
    let vivo = true;
    // Limpa o resultado do período anterior ANTES de buscar o novo — sem
    // isso, ao trocar de período a tela mostraria a comparação do período
    // anterior ERRADO por um instante, misturada com os números novos.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemsAnterior(null);
    authedFetch(`/api/ml/ads?from=${periodoAnterior.from}&to=${periodoAnterior.to}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (vivo && !j.error) setItemsAnterior(j.items ?? []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [periodoAnterior]);

  const t = useMemo(() => agregar(items), [items]);
  const tAnterior = useMemo(() => (itemsAnterior ? agregar(itemsAnterior) : null), [itemsAnterior]);

  const pub = modo === "pub";

  const linhas = useMemo<LinhaAds[]>(() => items.map((i) => {
    const v = pub ? i.directSales : i.totalSales;
    const un = pub ? i.directUnits : i.totalUnits;
    const r = i.cost > 0 ? v / i.cost : 0;
    const a = v > 0 ? (i.cost / v) * 100 : 0;
    const ctr = i.prints > 0 ? (i.clicks / i.prints) * 100 : 0;
    const cpc = i.clicks > 0 ? i.cost / i.clicks : 0;
    const pctAds = i.totalSales > 0 ? (i.adSales / i.totalSales) * 100 : 0;
    /**
     * Zero quando o custo é desconhecido: assim break-even e ROAS ideal caem
     * sozinhos no caminho de "indisponível" que já existe, em vez de saírem
     * calculados sobre um lucro inventado.
     */
    const lucroAntes = i.custoDisponivel ? (pub ? i.lucroDiretoAntesAds : i.lucroAntesAds) : 0;
    const breakEven = calculateBreakEvenRoas(v, lucroAntes);
    const abaixoDoBreakEven = breakEven != null && i.cost > 0 && r < breakEven;
    /**
     * O "—" da coluna de equilíbrio significava três coisas: custo não
     * cadastrado, sem venda no período, e produto que não cobre o próprio
     * custo. A última é uma conclusão FORTE (nenhum ROAS salva este anúncio) e
     * some junto com as outras duas.
     */
    const semBreakEven = breakEven == null
      ? motivoSemBreakEven(v, lucroAntes, i.custoDisponivel)
      : null;
    // ROAS ideal = o que sobra a margem ALVO, não só o que empata.
    const roasIdeal = calculateTargetRoas(v, lucroAntes, metaMargem);
    const abaixoDoIdeal = roasIdeal != null && i.cost > 0 && r < roasIdeal;
    // O ROAS ideal em dinheiro: quanto sobraria mantendo a receita de hoje.
    const lucroNoIdeal = lucroNoRoas(v, lucroAntes, roasIdeal);
    const motivoSemIdeal = roasIdeal == null ? motivoSemRoasIdeal(v, lucroAntes, metaMargem, i.custoDisponivel) : null;
    const lucroAtual = !i.custoDisponivel ? null
      : pub ? (i.diretoDisponivel ? i.lucroDiretoLiquido : null) : i.lucroLiquido;
    const margemAtual = v > 0 && lucroAtual != null ? (lucroAtual / v) * 100 : null;
    const reco = getAdRecommendation({
      clicks: i.clicks, vendas: v, cost: i.cost, lucro: lucroAtual, roas: r,
      roasTarget: i.roasTarget, breakEvenRoas: breakEven, margem: margemAtual,
      metaMargem,
      // Sem isto, "produto no vermelho antes do ads" era rotulado como falta
      // de dado — ver getAdRecommendation.
      lucroAntesAds: lucroAntes,
      custoConhecido: i.custoDisponivel,
    });
    const ganhoNoIdeal = lucroNoIdeal != null && lucroAtual != null ? lucroNoIdeal - lucroAtual : null;
    // O mesmo ROAS que aparece no painel do Mercado Ads (receita atribuída total).
    const roasMlAds = i.cost > 0 ? i.adSales / i.cost : null;
    return { i, v, un, r, a, ctr, cpc, pctAds, breakEven, abaixoDoBreakEven, motivoSemBreakEven: semBreakEven, roasIdeal, abaixoDoIdeal, lucroNoIdeal, ganhoNoIdeal, motivoSemIdeal, roasMlAds, lucroAtual, margemAtual, reco };
  }), [items, pub, metaMargem]);

  const linhasFiltradas = useMemo(() => {
    const rMin = roasMin.trim() ? Number(roasMin.replace(",", ".")) : null;
    const rMax = roasMax.trim() ? Number(roasMax.replace(",", ".")) : null;
    const acMin = acosMin.trim() ? Number(acosMin.replace(",", ".")) : null;
    const acMax = acosMax.trim() ? Number(acosMax.replace(",", ".")) : null;
    const invMin = investMin.trim() ? Number(investMin.replace(",", ".")) : null;
    const invMax = investMax.trim() ? Number(investMax.replace(",", ".")) : null;
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (q && !(l.i.title.toLowerCase().includes(q) || l.i.itemId.toLowerCase().includes(q))) return false;
      if (statusFiltro && l.i.status !== statusFiltro) return false;
      if (lucroFiltro === "lucro" && (l.lucroAtual == null || l.lucroAtual <= 0)) return false;
      if (lucroFiltro === "prejuizo" && (l.lucroAtual == null || l.lucroAtual >= 0)) return false;
      // O ROAS filtrado é o que a COLUNA exibe (`roasMlAds`, o do painel do Mercado Ads),
      // não o `r` do modo escolhido: filtrar por um número e mostrar outro escondia anúncios
      // que estavam dentro da faixa na tela. Sem ROAS (sem investimento) não cabe em faixa.
      const roasVisivel = l.roasMlAds;
      if (rMin != null && !Number.isNaN(rMin) && (roasVisivel == null || roasVisivel < rMin)) return false;
      if (rMax != null && !Number.isNaN(rMax) && (roasVisivel == null || roasVisivel > rMax)) return false;
      if (acMin != null && !Number.isNaN(acMin) && l.a < acMin) return false;
      if (acMax != null && !Number.isNaN(acMax) && l.a > acMax) return false;
      if (invMin != null && !Number.isNaN(invMin) && l.i.cost < invMin) return false;
      if (invMax != null && !Number.isNaN(invMax) && l.i.cost > invMax) return false;
      return true;
    });
  }, [linhas, busca, statusFiltro, lucroFiltro, roasMin, roasMax, acosMin, acosMax, investMin, investMax]);

  const overviewAtual = useMemo(() => paraOverview(t, pub), [t, pub]);
  const overviewAnterior = useMemo(() => {
    if (!tAnterior) return null;
    const vendasAnt = pub ? tAnterior.direct : tAnterior.total;
    if (!periodoAnteriorTemDadosSuficientes(tAnterior.cost, vendasAnt)) return null;
    return paraOverview(tAnterior, pub);
  }, [tAnterior, pub]);

  const reconciliacao = useMemo(() => calculateAdsReconciliation({
    investimentoTotal: t.cost, gastoOrfao, gastoSemVinculo, anunciosContagemFalhou, temItens: items.length > 0,
  }), [t.cost, gastoOrfao, gastoSemVinculo, anunciosContagemFalhou, items.length]);

  const statusAtualizacaoTxt = loading ? "Atualizando…" : erro ? "Falha ao atualizar" : atualizadoEm ? `Dados atualizados às ${atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "—";
  // Só texto de exibição ("dados desatualizados") — recomputar a cada render
  // reflete o relógio de parede passando, não afeta memoização/dependência.
  // eslint-disable-next-line react-hooks/purity
  const desatualizado = !loading && !erro && atualizadoEm != null && Date.now() - atualizadoEm.getTime() > 15 * 60 * 1000;

  function abrirAnuncio(itemId: string) {
    setDrawerItemId(itemId);
  }
  function irParaAlteracoes(campaignId: string) {
    setDrawerItemId(null);
    setChangelogCampanhaInicial(campaignId);
    setModo("log");
  }

  function exportarCsv() {
    const header = [
      "Anúncio", "MLB", "Investido", pub ? "Vendas diretas" : "Vendas totais", "Unidades",
      pub ? "ACOS %" : "TACOS %", "ROAS", "Break-even ROAS", "ROAS ideal (margem alvo)",
      "Lucro no ROAS ideal", "Ganho vs hoje", "Vendas atribuídas (un)",
      "% da receita via Ads", "Lucro", "Margem %",
      "Decisão", "Qualidade dos dados", "Última alteração manual", "Período", "Modo",
    ];
    const linhasCsv = linhasFiltradas.map(({ i, v, un, r, a, breakEven, roasIdeal, lucroNoIdeal, ganhoNoIdeal, pctAds, lucroAtual, margemAtual, reco }) => {
      const ultima = changelog.filter((e) => e.campaignId === i.campaignId).sort((x, y) => y.createdAt - x.createdAt)[0];
      return [
        i.title || i.itemId, i.itemId, num(i.cost, 2), num(v, 2), num(un),
        i.cost > 0 ? num(a, 1) : "", i.cost > 0 ? num(r, 2) : "", breakEven != null ? num(breakEven, 2) : "", roasIdeal != null ? num(roasIdeal, 2) : "",
        lucroNoIdeal != null ? num(lucroNoIdeal, 2) : "", ganhoNoIdeal != null ? num(ganhoNoIdeal, 2) : "", num(i.directUnits),
        i.totalSales > 0 ? num(pctAds, 1) : "",
        lucroAtual != null ? num(lucroAtual, 2) : "não disponível", margemAtual != null ? num(margemAtual, 1) : "",
        reco.label, reconciliacao.status, ultima ? formatarResumoAlteracao(ultima) : "",
        `${range.from} a ${range.to}`, pub ? "Publicidade direta" : "Geral",
      ];
    });
    const linhas2 = [header, ...linhasCsv]
      .map(linhaCsvSegura)
      .join("\r\n");
    const blob = new Blob([String.fromCharCode(0xfeff) + linhas2], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url;
    a2.download = `ads-${pub ? "publicidade" : "geral"}-${range.from}_a_${range.to}.csv`;
    a2.click();
    URL.revokeObjectURL(url);
  }

  const linhaDoDrawer = drawerItemId ? linhas.find((l) => l.i.itemId === drawerItemId) ?? null : null;

  return (
    <div className="dash">
      {/* O cabeçalho padrão (o mesmo de Custos, Estoque, Full…): título, contexto e o que pertence
          ao cabeçalho — atualizar e o período. Antes era um <div className="tab-head"> escrito à mão. */}
      <TelaHeader
        titulo="Ads"
        subtitulo={`${statusAtualizacaoTxt}${desatualizado ? " · dados desatualizados, considere atualizar" : ""}`}
        extra={(
          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={atualizarTudo}
              disabled={loading || ressincronizando}
              title="Ressincroniza os pedidos do período e busca o Ads ao vivo no Mercado Livre."
            >
              {ressincronizando ? "Sincronizando…" : loading ? "..." : "⟳ Atualizar"}
            </button>
            <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
          </>
        )}
      />

      {/* Toggle de análise */}
      <div className="seg" style={{ alignSelf: "flex-start" }} role="group" aria-label="Modo de análise">
        <button type="button" className={`seg-btn ${modo === "pub" ? "active" : ""}`} aria-pressed={modo === "pub"} onClick={() => setModo("pub")}>Publicidade direta</button>
        <button type="button" className={`seg-btn ${modo === "geral" ? "active" : ""}`} aria-pressed={modo === "geral"} onClick={() => setModo("geral")}>Geral</button>
        <button type="button" className={`seg-btn ${modo === "log" ? "active" : ""}`} aria-pressed={modo === "log"} onClick={() => setModo("log")}>Alterações de campanha</button>
      </div>
      <AdsModeDescription modo={modo} />

      {modo === "log" ? (
        <AdsChangelogPanel
          campanhas={campanhasResumo} products={products} itemCampaigns={items} entries={changelog}
          initialCampaignId={changelogCampanhaInicial}
        />
      ) : (
        <>
          {!pub && conta && conta.receita > 0 && (
            <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: -2 }}>
              Esta aba cobre <b>só os {items.length} item(ns) anunciados</b>: {fmtBRL(t.total)} dos {fmtBRL(conta.receita)} que a
              conta faturou no período ({num((t.total / conta.receita) * 100, 0)}% do total, {conta.itens} item(ns) vendidos ao todo).
              Por isso o número aqui é menor que o faturamento do dashboard — não é divergência, é recorte.
            </div>
          )}

          {erro ? (
            <div style={{ padding: "12px 14px", background: "rgba(214,90,74,.08)", border: "1px solid rgba(214,90,74,.3)", borderRadius: 8, fontSize: ".8rem", color: "var(--red-text)" }}>
              {(() => {
                const adv = diag?.advertisersStatus;
                const it = diag?.itemsStatus;
                if (adv === 401 || adv === 403) return (<>O token do Mercado Livre <b>não tem permissão de Publicidade / Mercado Ads</b>. Reconecte a conta concedendo esse acesso.</>);
                if (it === 404) return (<>O Mercado Ads recusou a busca dos anúncios (404) em <b>{range.from.split("-").reverse().join("/")} a {range.to.split("-").reverse().join("/")}</b>. Conta e permissão estão OK ({diag?.conta?.tokenNickname ?? "—"}, anunciante {String(diag?.advertiserId ?? "—")}). Abaixo, o que cada recurso do ML respondeu:</>);
                return (<>Não consegui puxar os Ads agora. O token está autorizado (anunciante {String(diag?.advertisersStatus ?? "—")}), então deve ser instabilidade do Mercado Ads — tente <b>Atualizar</b> em instantes.</>);
              })()}
              {diag?.tentativas?.length ? (
                <div className="table-wrapper" style={{ marginTop: 10, border: "1px solid rgba(214,90,74,.25)" }}>
                  <table className="tbl-modern tbl-cards">
                    <thead><tr>
                      <th style={{ textAlign: "left" }}>Recurso do ML</th>
                      <th>Status</th>
                      <th style={{ textAlign: "left" }}>Resposta do ML</th>
                    </tr></thead>
                    <tbody>
                      {diag.tentativas.map((tt) => (
                        <tr key={tt.tentativa}>
                          <td style={{ textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{tt.tentativa}</td>
                          <td data-label="Status" style={{ fontWeight: 800, color: tt.status && tt.status < 300 ? "var(--green)" : "var(--red)" }}>{tt.status ?? "erro"}</td>
                          <td data-label="Resposta do ML" style={{ textAlign: "left", fontFamily: "monospace", fontSize: ".75rem", color: "var(--muted)", wordBreak: "break-all" }}>{tt.body || tt.erro || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: ".75rem", color: "var(--muted)" }}>Diagnóstico completo (JSON)</summary>
                <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".75rem", maxHeight: 300, overflow: "auto" }}>{erro}</pre>
              </details>
            </div>
          ) : (
            <>
              <AdsOverview modo={modo} atual={overviewAtual} anterior={overviewAnterior} loading={loading} />

              {/*
                A visão geral fica ACIMA das vistas de propósito: os números
                do topo valem pras três, e repeti-los dentro de cada uma
                faria a mesma informação parecer três medições.
              */}
              {!loading && items.length > 0 && (
                <div className="seg" style={{ margin: "14px 0 4px" }}>
                  <button
                    type="button" className={`seg-btn ${vista === "decisoes" ? "active" : ""}`}
                    onClick={() => setVista("decisoes")}
                  >
                    Decisões
                  </button>
                  <button
                    type="button" className={`seg-btn ${vista === "campanhas" ? "active" : ""}`}
                    onClick={() => setVista("campanhas")}
                    title="Orçamento, investimento, receita atribuída, ROAS e meta — por campanha"
                  >
                    Campanhas ({campanhasEncontradas || 0})
                  </button>
                  <button
                    type="button" className={`seg-btn ${vista === "anuncios" ? "active" : ""}`}
                    onClick={() => setVista("anuncios")}
                    title="Custo, resultado e estoque — por anúncio"
                  >
                    Anúncios ({items.length})
                  </button>
                </div>
              )}

              {!loading && items.length > 0 && (
                <>
                  {/*
                    CTR, CPC, impressões e funil moram na vista de CAMPANHAS.
                    São leitura de campanha, não de anúncio, e na vista de
                    decisões eram quatro blocos entre a pessoa e a resposta.
                  */}
                  {vista === "campanhas" && (
                    <>
                      <AdsParticipacao
                        receitaDireta={t.direct}
                        receitaAtribuida={t.adSales}
                        receitaTotal={t.total}
                        investimento={t.cost}
                      />

                      <AdsFunnel
                        impressoes={t.prints} cliques={t.clicks} investimento={t.cost}
                        vendas={pub ? t.directUn : t.totalUn} receita={pub ? t.direct : t.total}
                        lucroAposAds={pub ? t.lucroLiqDireto : t.lucroLiq}
                      />

                      {/* O mesmo funil, recortado por campanha — o de cima
                          soma tudo e esconde a campanha que está sangrando. */}
                      <AdsCampaignList itens={items} modo={modo} metricasReais={metricasReaisPorCampanha} />

                      <div className="note" style={{ marginTop: 12 }}>
                        <b>Orçamento é da campanha, não do anúncio.</b> Ele aparece só aqui de
                        propósito: somado por anúncio, a mesma verba seria contada tantas vezes
                        quantos anúncios a campanha tiver.
                      </div>
                    </>
                  )}

                  {vista === "decisoes" && (
                    <AdsDecisionPanel linhas={linhas} changelog={changelog} onAbrirAnuncio={abrirAnuncio} diasDoPeriodo={diasDoPeriodo} />
                  )}

                  {/* Flutuante (position:fixed), então a posição no JSX não
                      afeta o layout — fica aqui só pra receber as MESMAS
                      `linhas` do painel acima e nunca divergir nos números.
                      Na aba Ads este é o ÚNICO chat: o de dúvidas se esconde
                      aqui (ver app/page.tsx) pra não haver dois no canto. */}
                  <AdsChat linhas={linhas} metaMargem={metaMargem} />

                  <AdsDataQuality
                    investimentoTotal={t.cost} gastoOrfao={gastoOrfao} gastoSemVinculo={gastoSemVinculo}
                    anunciosContagemFalhou={anunciosContagemFalhou} temItens={items.length > 0}
                    campanhasEncontradas={campanhasEncontradas} campanhasTotal={campanhasTotal}
                    atualizadoEm={atualizadoEm}
                  />
                </>
              )}

              {/*
                A tabela analítica é a vista de ANÚNCIOS: custo, resultado e
                estoque item a item. Continua visível enquanto carrega e
                quando não há dado nenhum, porque nesses dois casos não há
                vista pra escolher — e uma tela sem nada nem explicação é
                pior que uma tabela vazia que diz por quê.
              */}
              {(vista === "anuncios" || loading || items.length === 0) && (
              <div className="panel">
                <div className="panel-head" style={{ marginBottom: 8 }}>
                  <span className="panel-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    Anúncios — visão analítica
                    {linhasFiltradas.length > 0 && (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={exportarCsv} title="Exporta as linhas visíveis (respeitando os filtros ativos) em CSV">
                        ⬇ Exportar CSV
                      </button>
                    )}
                  </span>
                  <span className="panel-sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {semGastoNoPeriodo > 0 && (
                      <span title="Anúncios sem nenhum investimento no período — ocultados de propósito pra não poluir a tela" style={{ fontSize: ".75rem", color: "var(--muted)", cursor: "help" }}>
                        ({semGastoNoPeriodo} sem gasto ocultado{semGastoNoPeriodo === 1 ? "" : "s"})
                      </span>
                    )}
                    <AdsStatusQuickFilters items={items} statusFiltro={statusFiltro} setStatusFiltro={setStatusFiltro} lucroFiltro={lucroFiltro} setLucroFiltro={setLucroFiltro} />
                  </span>
                </div>

                {items.length > 0 && (
                  <AdsFilters
                    modo={modo}
                    ordem={ordemAds} onOrdem={setOrdemAds}
                    f={{
                      busca, setBusca, statusFiltro, setStatusFiltro, lucroFiltro, setLucroFiltro,
                      roasMin, setRoasMin, roasMax, setRoasMax, acosMin, setAcosMin, acosMax, setAcosMax,
                      investMin, setInvestMin, investMax, setInvestMax,
                    } satisfies FiltrosAdsState}
                  />
                )}

                {loading ? (
                  <div className="empty-state">Carregando dados de Ads…</div>
                ) : items.length === 0 ? (
                  <div className="empty-state"><span className="empty-ico">📣</span>Sem dados de Ads no período.</div>
                ) : linhasFiltradas.length === 0 ? (
                  <div className="empty-state"><span className="empty-ico">📣</span>Nenhum anúncio bate com esse filtro.</div>
                ) : (
                  <AdsTable modo={modo} linhas={linhasFiltradas} onAbrirAnuncio={abrirAnuncio} ordem={ordemAds} onOrdem={setOrdemAds} />
                )}

                <div style={{ marginTop: 10, fontSize: ".75rem", color: "var(--muted)", lineHeight: 1.6 }}>
                  {pub
                    ? <>Vendas diretas = compras logo após clicar no anúncio · ACOS/ROAS medem só o ad. <b>Lucro</b> com &quot;—&quot; =
                        sem venda vinculada no período pra calcular a margem — não conta como prejuízo na soma do topo.</>
                    : "Vendas totais = tudo que o item vendeu (ads + orgânico) · TACOS = investido ÷ vendas totais (quanto menor, mais o ads se paga no geral)."}
                  <div style={{ marginTop: 4 }}>
                    <b>Ativa</b>/<b>Pausada</b> é o status da CAMPANHA (não do anúncio no catálogo) — campanha pausada não gasta
                    nem gira, mesmo com o anúncio ativo. <b>Sem campanha</b> = não achamos campanha ligada a este anúncio, ou a
                    campanha dele não teve investimento neste período.
                  </div>
                  {items.length > 0 && items.every((i) => i.dailyBudget === 0 && i.roasTarget === 0) && (
                    <div style={{ marginTop: 8, color: "var(--warning)" }}>
                      <b>Orç/dia e ROAS alvo vieram vazios em todos os anúncios</b>
                      {campanhasEncontradas === 0 ? " — nenhuma campanha com investimento neste período foi encontrada" : ` (${campanhasEncontradas} campanha(s) com investimento encontrada(s), mas sem cruzar com os anúncios)`}.
                      Abra &quot;Diagnóstico de configuração&quot; abaixo — se nenhuma URL responder 200, é o endpoint que mudou, não o nome do campo.
                    </div>
                  )}
                  {(cfgDiag.length > 0 || !!cfgAmostra) && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Diagnóstico de configuração (orçamento/ROAS/campanha) — {campanhasEncontradas} campanha(s) com investimento neste período</summary>
                      {cfgDiag.length > 0 && (
                        <div className="table-wrapper" style={{ marginTop: 6, border: "1px solid var(--border)" }}>
                          <table className="tbl-modern tbl-cards">
                            <thead><tr><th style={{ textAlign: "left" }}>URL tentada</th><th style={{ textAlign: "right" }}>Status</th></tr></thead>
                            <tbody>
                              {cfgDiag.map((tt, idx) => (
                                <tr key={`${tt.url}-${idx}`}>
                                  <td style={{ textAlign: "left", fontFamily: "monospace", fontSize: ".75rem", wordBreak: "break-all" }}>{tt.url}</td>
                                  <td data-label="Status" style={{ textAlign: "right", color: tt.status === 200 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{tt.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {!!cfgAmostra?.campanhaOrfa && (
                        <div style={{ marginTop: 8, fontSize: ".75rem", color: "var(--warning)" }}>
                          Campanha que faltava na lista, recuperada pelo id:
                          <pre style={{ marginTop: 4, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".75rem", maxHeight: 240, overflow: "auto" }}>
                            {JSON.stringify(cfgAmostra.campanhaOrfa, null, 2)}
                          </pre>
                        </div>
                      )}
                      {!!cfgAmostra && (
                        <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".75rem", maxHeight: 240, overflow: "auto" }}>
                          {JSON.stringify(cfgAmostra.campanha ?? cfgAmostra, null, 2)}
                        </pre>
                      )}
                    </details>
                  )}
                  {campanhasResumo.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                        Todas as campanhas da conta ({campanhasTotal}{anunciosContagemFalhou ? "" : `, ${anunciosTotal} anúncio(s) cadastrado(s)`}) — conferir se nada sumiu da tabela
                      </summary>
                      {anunciosContagemFalhou ? (
                        <div style={{ marginTop: 6, fontSize: ".75rem", color: "var(--warning)" }}>
                          Não conseguimos contar os anúncios cadastrados por campanha. O gasto por campanha continua confiável,
                          só a contagem total de anúncios que falhou.
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, fontSize: ".75rem", color: "var(--muted)" }}>
                          A tabela acima só mostra anúncio com atividade neste período. <b>{anunciosNoPeriodo}</b> anúncio(s)
                          tiveram atividade (de {anunciosTotal} cadastrados no total).
                        </div>
                      )}
                      <div className="table-wrapper" style={{ marginTop: 6, border: "1px solid var(--border)" }}>
                        <table className="tbl-modern tbl-cards">
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left" }}>Campanha</th>
                              <th style={{ textAlign: "left" }}>Status ML</th>
                              <th style={{ textAlign: "right" }}>Anúncios cadastrados</th>
                              <th style={{ textAlign: "right" }}>Gasto no período</th>
                            </tr>
                          </thead>
                          <tbody>
                            {campanhasResumo.map((c) => (
                              <tr key={c.id}>
                                <td style={{ textAlign: "left", fontWeight: 600 }} title={c.id}>{c.name}</td>
                                <td data-label="Status ML" style={{ textAlign: "left", color: "var(--muted)" }}>{c.status || "—"}</td>
                                <td data-label="Anúncios cadastrados" style={{ textAlign: "right", color: "var(--muted)" }}>{anunciosContagemFalhou ? "—" : c.totalAds}</td>
                                <td data-label="Gasto no período" style={{ textAlign: "right", color: c.gasto > 0 ? "var(--green)" : "var(--muted)", fontWeight: c.gasto > 0 ? 700 : 400 }}>
                                  {c.gasto > 0 ? fmtBRL(c.gasto) : "sem gasto no período"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {(gastoOrfao > 0 || gastoSemVinculo > 0) && (
                        <div style={{ marginTop: 6, fontSize: ".75rem", color: "var(--warning)" }}>
                          <b>{fmtBRL(gastoOrfao + gastoSemVinculo)} de investimento não caiu em nenhuma campanha desta lista</b> —
                          por isso a soma da coluna &quot;Gasto no período&quot; fica menor que o Investimento do topo ({fmtBRL(t.cost)}).
                          {gastoOrfao > 0 && <> {fmtBRL(gastoOrfao)} são de anúncios com campanha que o ML não devolveu
                            na lista{campanhasOrfas.length > 0 ? ` (id ${campanhasOrfas.join(", ")})` : ""}.</>}
                          {gastoSemVinculo > 0 && <> {fmtBRL(gastoSemVinculo)} são de anúncios sem nenhuma campanha resolvida.</>}
                        </div>
                      )}
                    </details>
                  )}
                </div>
              </div>
              )}
            </>
          )}
        </>
      )}

      <AdDetailDrawer linha={linhaDoDrawer} pub={pub} changelog={changelog} onClose={() => setDrawerItemId(null)} onIrParaAlteracoes={irParaAlteracoes} />
    </div>
  );
}
