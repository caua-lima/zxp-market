import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsFullByItem, getAdsSettingsByItem, getItemStatusByItem, probeAds, type AdSettings } from "@/lib/ml/ads";

/**
 * Etiqueta é sobre a CAMPANHA (o que o vendedor pediu), não o anúncio no
 * catálogo — uma campanha pausada não gasta nem gira, mesmo com o anúncio
 * "active" no catálogo. Sem campaignId resolvido = "sem_campanha" (não é erro,
 * é um anúncio que nunca foi posto em nenhuma campanha, ou a campanha não foi
 * encontrada na busca).
 */
function statusLabel(campaignId: string, campaignStatus: string): "ativo" | "pausado" | "sem_campanha" | "config_indisponivel" {
  if (!campaignId) return "sem_campanha";
  const s = campaignStatus.toLowerCase();
  if (s === "active") return "ativo";
  if (s === "paused") return "pausado";
  // Tem campanha (sabemos o id), mas não conseguimos carregar a config dela —
  // "sem campanha" aqui seria falso.
  return "config_indisponivel";
}
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { fetchOrdersLive, loadOrders, readShippingCosts } from "@/lib/ml/orders";
import { classificarVenda, detectarPedidosSubstituidos } from "@/lib/domain/venda-status";
import { diaBRDe } from "@/lib/domain/periodo-br";
import { ratearFretePorPedido } from "@/lib/domain/frete-pacote";

export const maxDuration = 30;

type ProdutoData = { custo: number; imposto: number };
type OrderItem = { sku?: string; item_id?: string; quantity?: number; unit_price?: number; sale_fee?: number };

function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const normSku = (s: string) => s.trim().toLowerCase();
const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");

type VendaItem = { receita: number; unidades: number; cmv: number; imposto: number; taxaML: number; envio: number };

/**
 * Vendas + lucro (antes de ads) por item MLB, a partir dos MESMOS pedidos que o
 * dashboard usa (ao vivo do ML). Exclui cancelados e devolvidos, igual ao lucro
 * do dashboard — assim "vendas totais" e "lucro" batem com a tela principal.
 */
function vendasPorItem(
  orders: FirebaseFirestore.DocumentData[],
  porMlb: Map<string, ProdutoData>, porSku: Map<string, ProdutoData>,
  cancelIds: Set<string>, devolIds: Set<string>,
): Map<string, VendaItem> {
  const map = new Map<string, VendaItem>();
  // Separação de envio: o ML cancela o pedido e cria outros no mesmo pacote.
  // Sem isto o item apareceria com a receita contada duas vezes aqui.
  const substituidos = detectarPedidosSubstituidos(
    orders.map((o) => ({
      orderId: String(o.order_id ?? ""),
      packId: o.pack_id as string | null | undefined,
      status: o.status,
      // Comprador + dia + itens: a 2ª regra de detectarPedidosSubstituidos,
      // que pega a separação de envio quando o ML não reaproveita o pack_id.
      buyerId: (o.buyer_id as string | null | undefined) ?? null,
      dia: diaBRDe(String(o.date_created ?? "")),
      itens: ((o.items as OrderItem[]) ?? []).map((it) => ({
        itemId: String(it.item_id ?? ""),
        qty: Number(it.quantity ?? 1),
      })),
    })),
  );
  // Mesmo rateio do Dashboard: o frete e do ENVIO, e um pacote tem um envio
  // so — sem isto o custo do anuncio saia inflado e o ROAS, pessimista.
  const rateio = ratearFretePorPedido(
    orders.map((o) => ({
      orderId: String(o.order_id ?? ""),
      packId: o.pack_id as string | null | undefined,
      shippingId: o.shipping_id as string | null | undefined,
      shippingCost: Number(o.shipping_cost ?? 0),
      unidades: ((o.items as OrderItem[]) ?? []).reduce((s, it) => s + Number(it.quantity ?? 1), 0),
    })),
  );

  for (const o of orders) {
    const oid = String(o.order_id ?? "");
    /**
     * MESMA regra do Dashboard (lib/domain/venda-status.ts): o status ao vivo
     * manda sobre o cache de `ml_returns`. Antes esta rota repetia a condição
     * à mão, então uma venda "resgatada" contava no Dashboard e continuava
     * fora daqui — e o ROAS saía calculado sobre uma receita menor.
     */
    if (classificarVenda({
      status: o.status,
      noCacheDeCancelados: cancelIds.has(oid),
      temDevolucaoConcluida: devolIds.has(oid),
      substituidoNoPacote: substituidos.has(oid),
    }).classe !== "valida") continue;
    const items = (o.items as OrderItem[]) ?? [];
    const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
    const envioPerUnit = totalUnits > 0 ? (rateio.porPedido.get(oid) ?? 0) / totalUnits : 0;
    for (const it of items) {
      const id = String(it.item_id ?? "").trim().toUpperCase();
      if (!id) continue;
      const qty = Number(it.quantity ?? 1);
      const receita = Number(it.unit_price ?? 0) * qty;
      const prod = porMlb.get(normId(id)) ?? porSku.get(normSku(String(it.sku ?? "")));
      const cur = map.get(id) ?? { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
      cur.receita += receita;
      cur.unidades += qty;
      cur.taxaML += Number(it.sale_fee ?? 0) * qty;
      cur.envio += envioPerUnit * qty;
      cur.cmv += (prod?.custo ?? 0) * qty;
      cur.imposto += receita * ((prod?.imposto ?? 0) / 100);
      map.set(id, cur);
    }
  }
  return map;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || todayISO(29);
    const to = url.searchParams.get("to") || todayISO(0);

    // A API de ADS do ML rejeita datas futuras (404) → limita o fim ao dia de
    // hoje no fuso BR. Mesma trava que o dashboard já usa.
    const hj = todayISO(0);
    const adsTo = to > hj ? hj : to;

    let ads;
    try {
      ads = from <= adsTo ? await getAdsFullByItem(from, adsTo) : [];
    } catch {
      // Pode ser o período terminando no dia corrente (dados de hoje ainda não
      // fecharam do lado do ML). Tenta de novo terminando ontem.
      const ontem = todayISO(1);
      try {
        ads = from <= ontem ? await getAdsFullByItem(from, ontem) : [];
      } catch (e2) {
        const diag = await probeAds(from, adsTo);
        return NextResponse.json({ error: "ads_failed", details: String(e2).slice(0, 200), diag, from, to: adsTo, items: [] });
      }
    }

    // Só o que teve investimento no período — anúncio parado é poluição
    // visual aqui, e cortar cedo também poupa chamada de config (campanha)
    // pra quem nem entraria na tela.
    const totalAntesDoFiltro = ads.length;
    ads = ads.filter((a) => a.cost > 0);
    const semGastoNoPeriodo = totalAntesDoFiltro - ads.length;

    const db = getAdminDb();

    // ── Produtos (custo médio + imposto) indexados por MLB e SKU ──
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = { custo: Number(d.custoMedio ?? d.custo ?? 0), imposto: Number(d.imposto ?? 0) };
      const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of mlbs) { const n = normId(String(m)); if (n) porMlb.set(n, entry); }
      const sku = String(d.sku ?? "").trim();
      if (sku) porSku.set(normSku(sku), entry);
    }

    // ── Pedidos AO VIVO (mesma fonte do dashboard) com fallback ao Firestore ──
    const fromISO = `${from}T00:00:00.000-03:00`;
    const toISO = `${to}T23:59:59.999-03:00`;
    const start = `${from}T00:00:00.000Z`, end = `${to}T23:59:59.999Z`;
    const token = await getValidMlAccessToken().catch(() => "");
    let orders = token ? await fetchOrdersLive(token, fromISO, toISO) : null;
    if (!orders) orders = await loadOrders(db, start, end, fromISO, toISO);

    // enriquece frete do cache do Firestore
    const ids = orders.map((o) => String(o.order_id ?? "")).filter(Boolean);
    const shipMap = await readShippingCosts(db, ids);
    for (const o of orders) if (o.shipping_cost == null) o.shipping_cost = shipMap.get(String(o.order_id)) ?? 0;

    // ── Devoluções + cancelamentos (excluídos do lucro, igual ao dashboard) ──
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", fromISO).where("date_created", "<=", toISO).get(),
    ]);
    const cancelIds = new Set<string>();
    const devolIds = new Set<string>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) {
      const r = doc.data();
      if (String(r.tipo ?? "") === "devolucao") devolIds.add(doc.id);
      else cancelIds.add(doc.id);
    }

    const vendas = vendasPorItem(orders, porMlb, porSku, cancelIds, devolIds);

    // Configuração de cada anúncio (orçamento, meta de ROAS, última alteração).
    // Best-effort: se falhar, os anúncios ainda saem, só sem esses campos.
    // O campaign_id que já veio junto das métricas poupa uma chamada por item.
    const mlbsAds = ads.map((a) => a.itemId).filter((s) => /^MLB\d+$/i.test(s));
    const campaignIdByItem: Record<string, string> = {};
    const costByItem: Record<string, number> = {};
    for (const a of ads) {
      const id = a.itemId.toUpperCase();
      if (a.campaignId) campaignIdByItem[id] = a.campaignId;
      costByItem[id] = a.cost;
    }
    const cfg = await getAdsSettingsByItem(mlbsAds, campaignIdByItem, costByItem).catch(
      () => ({
        porItem: {} as Record<string, AdSettings>, amostraCampanha: null,
        tentativas: [] as { url: string; status: number }[], campanhasEncontradas: 0,
        campanhasTotal: 0,
        campanhasResumo: [] as { id: string; name: string; status: string; gasto: number; totalAds: number }[],
        anunciosTotal: 0, anunciosNoPeriodo: 0, anunciosContagemFalhou: false,
        campanhasOrfas: [] as string[], gastoOrfao: 0, gastoSemVinculo: 0,
        amostraCampanhaOrfa: null,
      }),
    );
    // Status do catálogo (se o anúncio em si está ativo/pausado/encerrado) —
    // vira só um dado extra no tooltip agora; a etiqueta principal é da campanha.
    const statusPorItem = await getItemStatusByItem(mlbsAds).catch(() => ({} as Record<string, string>));

    // id → nome de TODAS as campanhas da conta, pra nomear também as fatias de
    // campanhas que não são a principal do anúncio.
    const nomePorCampanha = new Map<string, string>();
    for (const c of cfg.campanhasResumo) if (c.id) nomePorCampanha.set(String(c.id), c.name);

    const items = ads.map((a) => {
      const v = vendas.get(a.itemId) ?? { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
      const lucroAntesAds = v.receita - v.cmv - v.imposto - v.taxaML - v.envio;
      const lucroLiquido = lucroAntesAds - a.cost; // GERAL: todas as vendas − ads

      /**
       * Lucro considerando SÓ as vendas diretas do anúncio. Aplica a margem do
       * produto (lucro/receita) sobre a receita direta — não temos CMV/taxa
       * separados por venda direta, então a proporção é a melhor aproximação.
       * Responde: o ad se paga só com o que ele converte na hora?
       *
       * Sem v.receita (produto não vinculado no Estoque, ou nenhuma venda
       * nossa achada no período — acontece mesmo o ML atribuindo venda direta
       * ao clique), a margem cai pra 0 e o cálculo virava "0 de lucro − custo
       * do ad inteiro" = -100%, puxando a soma geral pra negativo mesmo com
       * ROAS bom. Isso não é um prejuízo real, é falta de dado — marcamos
       * como indisponível em vez de inventar perda.
       */
      const diretoDisponivel = v.receita > 0;
      const margemItem = diretoDisponivel ? lucroAntesAds / v.receita : 0;
      const lucroDiretoAntesAds = a.directSales * margemItem;
      const lucroDiretoLiquido = diretoDisponivel ? lucroDiretoAntesAds - a.cost : 0;

      const c = cfg.porItem[a.itemId.toUpperCase()];
      const mlStatus = statusPorItem[a.itemId.toUpperCase()] ?? ""; // status do catálogo — só informativo

      /**
       * Nome de CADA campanha em que este anúncio rodou. `cfg.porItem` só
       * conhece a campanha principal, então as demais (ex.: uma campanha
       * antiga que gastou no começo do período) sairiam sem nome. O resumo de
       * campanhas da conta cobre esse caso.
       */
      const campanhas = a.campanhas.map((f) => ({
        ...f,
        // Nome resolvido abaixo; `sales`/`units` já vêm da fatia e são a base
        // do ROAS que o painel do Mercado Ads mostra.
        campaignName:
          nomePorCampanha.get(f.campaignId)
          ?? (f.campaignId === (c?.campaignId ?? "") ? c?.campaignName ?? "" : "")
          ?? "",
      }));

      return {
        itemId: a.itemId, title: a.title,
        status: statusLabel(c?.campaignId ?? "", c?.status ?? ""),
        campaignId: c?.campaignId ?? "", campaignName: c?.campaignName ?? "", mlStatus,
        clicks: a.clicks, prints: a.prints, cost: a.cost,
        directSales: a.directSales, directUnits: a.directUnits,
        adSales: a.sales, adUnits: a.units,
        /**
         * "Vendas atribuidas" como o painel do Mercado Ads conta: direta +
         * assistida. NAO e `advertising_items_quantity` (o antigo adUnits) —
         * medido em 5 campanhas da conta, os dois so batem quando a venda
         * assistida e zero; no resto o app mostrava 6 contra 14 do ML.
         */
        adUnitsAtribuidas: a.directUnits + a.indirectUnits,
        indirectUnits: a.indirectUnits,
        totalSales: v.receita, totalUnits: v.unidades,
        lucroAntesAds, lucroLiquido,
        lucroDiretoAntesAds, lucroDiretoLiquido, diretoDisponivel,
        // Configuração da campanha do anúncio (0/"" quando não achamos a campanha).
        dailyBudget: c?.dailyBudget ?? 0,
        roasTarget: c?.roasTarget ?? 0,
        acosTarget: c?.acosTarget ?? 0,
        campanhas,
      };
      // Sem campanha vai pro fim da lista, não importa o investimento — é
      // ruído pra quem quer olhar o que está rodando de verdade primeiro.
    }).sort((x, y) => {
      const semA = x.status === "sem_campanha" ? 1 : 0;
      const semB = y.status === "sem_campanha" ? 1 : 0;
      if (semA !== semB) return semA - semB;
      return y.cost - x.cost;
    });

    /**
     * Reconciliação com o dashboard. A tabela cobre SÓ os itens anunciados, mas
     * o rótulo "Geral (todas as vendas)" dava a entender que o total era o
     * faturamento inteiro do período — e não é: R$ 9.465 dos itens anunciados
     * contra R$ 12.040 de faturamento líquido do dashboard. Os dois estão
     * certos e medem coisas diferentes; devolvendo o total da conta, a tela
     * consegue dizer quanto do faturamento esses anúncios representam em vez de
     * deixar o vendedor achar que um dos números está quebrado.
     */
    let receitaConta = 0, unidadesConta = 0, lucroContaAntesAds = 0;
    for (const v of vendas.values()) {
      receitaConta += v.receita;
      unidadesConta += v.unidades;
      lucroContaAntesAds += v.receita - v.cmv - v.imposto - v.taxaML - v.envio;
    }

    // amostraCampanha: primeira campanha crua devolvida pelo ML — se
    // orçamento/ROAS vierem 0, mostra o objeto para achar o campo certo sem
    // chutar. cfgDiag: status HTTP das URLs de campanhas tentadas — se
    // nenhuma respondeu 200, o problema é o endpoint, não o nome do campo.
    return NextResponse.json({
      items, from, to,
      semGastoNoPeriodo, // quantos anúncios ficaram de fora por não ter investido
      cfgAmostra: { campanha: cfg.amostraCampanha, campanhaOrfa: cfg.amostraCampanhaOrfa },
      cfgDiag: cfg.tentativas,
      campanhasEncontradas: cfg.campanhasEncontradas,
      campanhasTotal: cfg.campanhasTotal,
      campanhasResumo: cfg.campanhasResumo,
      anunciosTotal: cfg.anunciosTotal,
      anunciosNoPeriodo: cfg.anunciosNoPeriodo,
      anunciosContagemFalhou: cfg.anunciosContagemFalhou,
      campanhasOrfas: cfg.campanhasOrfas,
      gastoOrfao: cfg.gastoOrfao,
      gastoSemVinculo: cfg.gastoSemVinculo,
      conta: {
        receita: receitaConta, unidades: unidadesConta,
        lucroAntesAds: lucroContaAntesAds, itens: vendas.size,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "unexpected", details: msg, items: [] }, { status: 500 });
  }
}
