import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsSpendByItem, probeAds } from "@/lib/ml/ads";
import { completarFretesFaltantes, fetchOrdersLive, loadOrders, readShippingCosts } from "@/lib/ml/orders";
import { getMlAccessToken } from "../token";
import { custoNaData, impostoNaData, type CustoFaixa, type ImpostoFaixa } from "@/lib/domain/types";
import { diaBRDe, recortarPorDiaBR } from "@/lib/domain/periodo-br";
import { classificarVenda, detectarPedidosSubstituidos } from "@/lib/domain/venda-status";
import { ratearFretePorPedido } from "@/lib/domain/frete-pacote";

export const maxDuration = 30;

// Cache curto por lambda quente (evita bater no ML a cada abertura / 15 min)
const metricsCache = new Map<string, { at: number; body: Record<string, unknown> }>();
const CACHE_TTL = 60 * 1000;

type ProdutoData = {
  custo: number;
  custoMedioFaixas?: CustoFaixa[]; // vigência: a venda usa o custo médio da data dela, não o de hoje
  imposto: number; // % sobre a venda — alíquota atual (compat)
  impostoFaixas?: ImpostoFaixa[]; // vigência: a venda usa a alíquota da data dela
  mlb: string;
  name: string;
  sku: string;
};

type OrderItem = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  sale_fee?: number;
  title?: string;
};

type AnuncioResult = {
  item_id: string;
  title: string;
  retorno: number;
  custoProduto: number;
  envioFull: number;
  imposto: number;
  taxaML: number;
  ads: number;
  lucroBruto: number;
  lucro: number;
  margem: number;
  qty: number;
  vendas: number; // nº de pedidos distintos que contêm este anúncio
  semVenda?: boolean;
};

type Aggregates = {
  faturamentoBruto: number;      // TUDO (inclui cancelados e devolvidos)
  vendasCanceladas: number;      // valor dos pedidos cancelados (não venda)
  vendasDevolvidas: number;      // valor dos pedidos devolvidos (venda revertida, 0 a 0)
  totalRetorno: number;
  totalCMV: number;
  totalEnvio: number;
  totalImposto: number;
  totalTaxasML: number;
  totalAds: number;
  adsNaoVinculado: number;
  anuncios: AnuncioResult[];
  pedidosSemVinculo: number;
  ordersCount: number;
  /** Unidades das vendas que valeram — comparável a "Unidades vendidas" do Seller Center. */
  unidadesVendidas: number;
  /** Quantidade de pedidos cancelados (não o valor) — o Seller Center mostra a contagem. */
  canceladasCount: number;
  canceladasDetalhe: { orderId: string; valor: number; dia: string; status: string; origem: string; packId: string }[];
  /** Pedidos que o cache `ml_returns` dizia cancelados mas o ML confirma como venda. */
  resgatadosDoCache: number;
  /** Pedidos cancelados só para virar outros do mesmo pacote (separação de envio). */
  substituidasCount: number;
  substituidasValor: number;
  /** Unidades dos pedidos substituídos — sem isto, a linha de unidades da
   *  Conferência não tinha como bater com o painel, que conta o original. */
  substituidasUnidades: number;
  reconc: { count: number; nosso: number; real: number };
};

function parseDateParam(p: string | null) {
  return p?.trim() || undefined;
}

function normalizeSku(s: string) {
  return s.trim().toLowerCase();
}

/**
 * Devolução concluída? Só reverte a venda quando a disputa fechou. Um claim
 * ainda "opened"/"in_process" pode terminar sem devolução (você ganha a
 * disputa), então segura. Status desconhecido/vazio conta como concluída para
 * não parar de descontar devolução real por causa de um vocabulário novo do ML.
 */
function devolucaoConcluida(r: Record<string, unknown>): boolean {
  const txt = `${String(r.status ?? "")} ${String(r.stage ?? "")}`.toLowerCase();
  const emAberto = /open|process|pending|progress|review|recontact|dispute|in_?mediation/.test(txt);
  return !emAberto;
}

// Remove prefixo "MLB" e retorna apenas o número, em maiúsculas
function normalizeItemId(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

// Dia civil no fuso BR (-03:00), deslocado por offsetDays (ex.: -1 = ontem).
function brDayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function buildRange(from?: string, to?: string, month?: string) {
  if (from && to) {
    return {
      start: `${from}T00:00:00.000Z`,
      end: `${to}T23:59:59.999Z`,
      startBR: `${from}T00:00:00.000-03:00`,
      endBR: `${to}T23:59:59.999-03:00`,
      fromStr: from,
      toStr: to,
    };
  }
  let year: number, mon: number;
  if (month) {
    [year, mon] = month.split("-").map(Number);
  } else {
    const br = new Date(Date.now() - 3 * 3600 * 1000);
    year = br.getUTCFullYear();
    mon = br.getUTCMonth() + 1;
  }
  const mm = String(mon).padStart(2, "0");
  const ld = String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0");
  return {
    start: `${year}-${mm}-01T00:00:00.000Z`,
    end: `${year}-${mm}-${ld}T23:59:59.999Z`,
    startBR: `${year}-${mm}-01T00:00:00.000-03:00`,
    endBR: `${year}-${mm}-${ld}T23:59:59.999-03:00`,
    fromStr: `${year}-${mm}-01`,
    toStr: `${year}-${mm}-${ld}`,
  };
}

/**
 * Agrega pedidos: faturamento, CMV, Full (frete do pedido distribuído por
 * unidade), taxas ML, imposto e ADS por anúncio. Só itens vinculados a um
 * produto entram no cálculo de lucro.
 */
function computeAggregates(
  orders: FirebaseFirestore.DocumentData[],
  porMlb: Map<string, ProdutoData>,
  porSku: Map<string, ProdutoData>,
  adsByItem: Record<string, number>,
  cancelIds: Set<string> = new Set(),
  devolIds: Set<string> = new Set(),
): Aggregates {
  let faturamentoBruto = 0;
  let vendasCanceladas = 0;
  let vendasDevolvidas = 0;
  let totalRetorno = 0;
  let totalCMV = 0;
  let totalEnvio = 0;
  let totalImposto = 0;
  let totalTaxasML = 0;
  let pedidosSemVinculo = 0;
  let unidadesVendidas = 0;
  let canceladasCount = 0;
  /** Cada pedido cancelado, pra conferência item a item contra o Seller Center. */
  const canceladasDetalhe: { orderId: string; valor: number; dia: string; status: string; origem: string; packId: string }[] = [];
  /** Pedidos que o cache dizia cancelados e o ML confirma como venda boa. */
  let resgatadosDoCache = 0;

  /**
   * Conferência contra o dinheiro real do Mercado Pago. Para cada pedido com
   * net_received (líquido que caiu), somamos o que a NOSSA conta diz que o ML
   * repassa: total − taxa de venda − frete. Se o real vier menor, existe um
   * custo do ML que não estamos subtraindo, e a margem está otimista por isso.
   */
  let reconcCount = 0;
  let reconcNosso = 0;   // total − sale_fee − frete (nossa estimativa do repasse)
  let reconcReal = 0;    // net_received_amount (o que o MP de fato liberou)

  /**
   * Pedidos cancelados só para virar outros do MESMO pacote (separação de
   * envio na agência). Ver detectarPedidosSubstituidos: o ML cancela o
   * original e cria unitários, e contar os três inflava bruto e canceladas ao
   * mesmo tempo.
   */
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
  let substituidasCount = 0;
  let substituidasValor = 0;
  let substituidasUnidades = 0;

  /**
   * FRETE POR ENVIO, não por pedido.
   *
   * Uma compra com produtos diferentes vira vários pedidos e UM envio só, e a
   * API repete o custo daquele envio em cada pedido. Somar pedido a pedido
   * contava o mesmo frete 2, 4, 5 vezes — medido: R$ 99,30 somados contra
   * R$ 45,80 reais num único dia, o bastante pra fazer o dia parecer negativo
   * quando era positivo. Ver lib/domain/frete-pacote.ts.
   */
  const rateio = ratearFretePorPedido(
    orders.map((o) => ({
      orderId: String(o.order_id ?? ""),
      packId: o.pack_id as string | null | undefined,
      shippingId: o.shipping_id as string | null | undefined,
      shippingCost: Number(o.shipping_cost ?? 0),
      unidades: ((o.items as OrderItem[]) ?? []).reduce((s, it) => s + Number(it.quantity ?? 1), 0),
    })),
  );

  const anunciosMap = new Map<string, AnuncioResult>();
  // Um pedido pode ter várias unidades do mesmo anúncio: 'vendas' conta o
  // PEDIDO uma vez só, enquanto 'qty' soma as unidades.
  const pedidosPorAnuncio = new Map<string, Set<string>>();
  let ordersCount = 0;

  for (const o of orders) {
    const oid = String(o.order_id ?? "");
    const totalAmt = Number(o.total_amount ?? 0);

    /**
     * Cancelada x devolvida x substituída x válida — ver lib/domain/venda-status.ts.
     * Duas regras vêm de divergências medidas contra o Seller Center:
     *   · o STATUS AO VIVO manda sobre o cache de `ml_returns`;
     *   · pedido cancelado só pra virar outros do mesmo pacote (separação de
     *     envio) não é cancelamento — o valor já está nos pedidos novos.
     */
    const classe = classificarVenda({
      status: o.status,
      noCacheDeCancelados: cancelIds.has(oid),
      temDevolucaoConcluida: devolIds.has(oid),
      substituidoNoPacote: substituidos.has(oid),
    });
    if (classe.resgatadoDoCache) resgatadosDoCache++;

    /**
     * Substituído sai ANTES do faturamento bruto, e é o único que sai.
     * Cancelado e devolvido ficam no bruto de propósito (o bruto é "tudo que
     * passou"), mas o substituído não é uma venda a mais: contá-lo somaria a
     * mesma compra duas vezes, uma no original e outra nos pedidos que o
     * substituíram.
     */
    if (classe.classe === "substituida") {
      substituidasCount++;
      substituidasValor += totalAmt;
      substituidasUnidades += ((o.items as OrderItem[]) ?? []).reduce((s2, it) => s2 + Number(it.quantity ?? 1), 0);
      continue;
    }

    // Faturamento BRUTO inclui tudo (inclusive cancelado/devolvido).
    faturamentoBruto += totalAmt;

    // Cancelado = "não venda" (estoque nem saiu). Fica só no bruto; sai do
    // faturamento líquido e do lucro.
    if (classe.classe === "cancelada") {
      vendasCanceladas += totalAmt;
      canceladasCount++;
      /**
       * A LISTA, não só o total. Quatro rodadas de "o faturamento não bate"
       * se passaram comparando dois totais e deduzindo a causa — o que sempre
       * dependeu de eu supor o que o ML fez com aqueles pedidos. Com os ids na
       * mão, dá pra abrir dois no Seller Center e resolver em uma rodada.
       */
      canceladasDetalhe.push({
        orderId: oid,
        valor: totalAmt,
        dia: diaBRDe(String(o.date_created ?? "")),
        status: String(o.status ?? ""),
        // De onde veio o veredito: status ao vivo do ML ou o cache ml_returns.
        origem: String(o.status ?? "").toLowerCase() === "cancelled" || String(o.status ?? "").toLowerCase() === "invalid"
          ? "status do ML"
          : "histórico (ml_returns)",
        packId: o.pack_id ? String(o.pack_id) : "",
      });
      continue;
    }
    // Devolvido = venda revertida, produto volta ao estoque → 0 a 0. Idem: só no bruto.
    if (classe.classe === "devolvida") { vendasDevolvidas += totalAmt; continue; }

    ordersCount++;
    unidadesVendidas += ((o.items as OrderItem[]) ?? []).reduce((s, it) => s + Number(it.quantity ?? 1), 0);
    // A alíquota é a que valia no dia da venda: mudar o imposto hoje não pode
    // reescrever o lucro de meses já fechados.
    const diaPedido = diaBRDe(String(o.date_created ?? ""));
    const items = (o.items as OrderItem[]) ?? [];

    // Frete Full do pedido distribuído por unidade (envio é por pedido)
    const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
    // Fatia DESTE pedido no envio (já sem a duplicação do pacote).
    const orderShipping = rateio.porPedido.get(oid) ?? 0;
    const envioPerUnit = totalUnits > 0 ? orderShipping / totalUnits : 0;

    // Conferência com o líquido real (independe de o produto estar cadastrado).
    const net = Number(o.net_received ?? 0);
    if (net > 0) {
      const saleFeeOrder = items.reduce((s, it) => s + Number(it.sale_fee ?? 0) * Number(it.quantity ?? 1), 0);
      reconcCount += 1;
      reconcNosso += totalAmt - saleFeeOrder - orderShipping;
      reconcReal += net;
    }

    let vinculado = false;

    for (const item of items) {
      const qty = Number(item.quantity ?? 1);
      const skuRaw = String(item.sku ?? "").trim();
      const itemId = String(item.item_id ?? "").trim();
      const title = String(item.title ?? skuRaw);
      const retorno = Number(item.unit_price ?? 0) * qty;
      const taxaML = Number(item.sale_fee ?? 0) * qty; // sale_fee é por unidade
      const envio = envioPerUnit * qty;

      const mlbNumPedido = normalizeItemId(itemId);
      const produto = porMlb.get(mlbNumPedido) ?? porSku.get(normalizeSku(skuRaw));

      if (produto) {
        vinculado = true;
        const cmv = custoNaData(produto, diaPedido) * qty;
        const imposto = retorno * (impostoNaData(produto, diaPedido) / 100);
        totalRetorno += retorno;
        totalCMV += cmv;
        totalEnvio += envio;
        totalImposto += imposto;
        totalTaxasML += taxaML;

        const chave = mlbNumPedido || skuRaw;
        const setPedidos = pedidosPorAnuncio.get(chave) ?? new Set<string>();
        setPedidos.add(oid);
        pedidosPorAnuncio.set(chave, setPedidos);
        const prev = anunciosMap.get(chave);
        if (prev) {
          prev.retorno += retorno;
          prev.custoProduto += cmv;
          prev.envioFull += envio;
          prev.imposto += imposto;
          prev.taxaML += taxaML;
          prev.qty += qty;
        } else {
          anunciosMap.set(chave, {
            item_id: itemId || skuRaw,
            title: produto.name || title,
            retorno,
            custoProduto: cmv,
            envioFull: envio,
            imposto,
            taxaML,
            ads: 0,
            lucroBruto: 0,
            lucro: 0,
            margem: 0,
            qty,
            vendas: 0,
          });
        }
      }
    }
    if (!vinculado && items.length > 0) pedidosSemVinculo++;
  }

  const usedAdKeys = new Set<string>();
  for (const [chave, a] of anunciosMap) {
    // adsByItem tem chaves em MLB uppercase (ex.: "MLB6577305336")
    const candidates = [chave, `MLB${chave}`, a.item_id.toUpperCase()];
    let ads = 0;
    for (const c of candidates) {
      if (adsByItem[c] != null) { ads = adsByItem[c]; usedAdKeys.add(c); break; }
    }
    a.ads = ads;
    a.lucroBruto = a.retorno - a.custoProduto - a.envioFull;
    a.lucro = a.lucroBruto - a.ads - a.imposto - a.taxaML;
    a.margem = a.retorno > 0 ? (a.lucro / a.retorno) * 100 : 0;
    a.vendas = pedidosPorAnuncio.get(chave)?.size ?? 0;
  }

  // Anúncios com gasto de ADS mas SEM venda no período → viram linhas próprias
  for (const [key, cost] of Object.entries(adsByItem)) {
    if (cost <= 0 || usedAdKeys.has(key)) continue;
    const prod = porMlb.get(normalizeItemId(key));
    anunciosMap.set(`__semvenda_${key}`, {
      item_id: key,
      title: prod?.name || `Anúncio ${key}`,
      retorno: 0, custoProduto: 0, envioFull: 0, imposto: 0, taxaML: 0,
      ads: cost, lucroBruto: 0, lucro: -cost, margem: 0, qty: 0, vendas: 0,
      semVenda: true,
    });
  }

  // ADS total = TODO o investimento do período (agora todo representado em linhas)
  const totalAdsFull = Object.values(adsByItem).reduce((s, v) => s + v, 0);
  const adsNaoVinculado = 0;

  // vendidos primeiro (por retorno), depois os "sem venda" (por ADS)
  const anuncios = Array.from(anunciosMap.values()).sort(
    (a, b) => (b.retorno - a.retorno) || (b.ads - a.ads),
  );

  return {
    faturamentoBruto,
    vendasCanceladas,
    vendasDevolvidas,
    totalRetorno,
    totalCMV,
    totalEnvio,
    totalImposto,
    totalTaxasML,
    totalAds: totalAdsFull,
    adsNaoVinculado,
    anuncios,
    pedidosSemVinculo,
    ordersCount,
    unidadesVendidas,
    canceladasCount,
    canceladasDetalhe: canceladasDetalhe.sort((a, b) => b.valor - a.valor),
    resgatadosDoCache,
    substituidasCount,
    substituidasValor,
    substituidasUnidades,
    reconc: { count: reconcCount, nosso: reconcNosso, real: reconcReal },
  };
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    const month = parseDateParam(url.searchParams.get("month"));
    const { start, end, startBR, endBR, fromStr, toStr } = buildRange(from, to, month);

    // ── Cache curto (bypass com ?fresh=1, usado no "Atualizar ML") ──
    const cacheKey = `${fromStr}|${toStr}`;
    const bust = url.searchParams.get("fresh") === "1";
    if (!bust) {
      const cached = metricsCache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL) {
        return NextResponse.json({ ...cached.body, cached: true });
      }
    }

    const db = getAdminDb();

    // ── 1. Estoque: indexar por MLB (sem prefixo) e por SKU ───
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = {
        // Custo médio (livro de movimentações) tem prioridade; cai pro manual se ainda não houver entradas.
        custo: Number(d.custoMedio ?? d.custo ?? d.cost ?? 0),
        custoMedioFaixas: Array.isArray(d.custoMedioFaixas) ? (d.custoMedioFaixas as CustoFaixa[]) : undefined,
        imposto: Number(d.imposto ?? d.tax ?? 0),
        impostoFaixas: Array.isArray(d.impostoFaixas) ? (d.impostoFaixas as ImpostoFaixa[]) : undefined,
        mlb: String(d.mlb ?? "").trim(),
        name: String(d.name ?? ""),
        sku: String(d.sku ?? "").trim(),
      };
      const mlbList: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : entry.mlb ? [entry.mlb] : [];
      for (const m of mlbList) {
        const n = normalizeItemId(String(m));
        if (n) porMlb.set(n, entry);
      }
      if (entry.sku) porSku.set(normalizeSku(entry.sku), entry);
    }

    // ── 2. Data de hoje (BR) para o breakdown do dia ──────────
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const hj = `${brNow.getUTCFullYear()}-${String(brNow.getUTCMonth() + 1).padStart(2, "0")}-${String(brNow.getUTCDate()).padStart(2, "0")}`;

    // ── 3. ADS por item_id (período + hoje) ───────────────────
    // A API de ADS rejeita datas futuras → limita o fim ao dia de hoje.
    // Chamadas SEQUENCIAIS: a 1ª aquece o cache do advertiser e evita o burst
    // paralelo que causava rate limit (ADS zerado).
    const adsTo = toStr > hj ? hj : toStr;
    // O ML às vezes recusa o período terminando no dia corrente. Tenta até ontem
    // antes de desistir. Se AINDA assim falhar, marca adsFalhou: zerar o ADS em
    // silêncio dava número errado (custo some, margem infla) — a tela precisa
    // avisar em vez de mostrar R$ 0,00 como se fosse verdade.
    const ontem = brDayISO(-1);
    let adsFalhou = false;
    let adsByItem: Record<string, number> = {};
    if (fromStr <= adsTo) {
      try {
        adsByItem = await getAdsSpendByItem(fromStr, adsTo);
      } catch {
        try {
          adsByItem = fromStr <= ontem ? await getAdsSpendByItem(fromStr, ontem) : {};
        } catch {
          adsFalhou = true;
        }
      }
    }
    const adsHoje: Record<string, number> = await getAdsSpendByItem(hj, hj).catch(() => ({}));

    // ── 4. Pedidos do período + de hoje (AO VIVO, com fallback) ─
    const token = await getMlAccessToken();
    const fromISO = `${fromStr}T00:00:00.000-03:00`;
    const toISO = `${toStr}T23:59:59.999-03:00`;
    const hjFromISO = `${hj}T00:00:00.000-03:00`;
    const hjToISO = `${hj}T23:59:59.999-03:00`;

    let orders = token ? await fetchOrdersLive(token, fromISO, toISO) : null;
    let ordersHoje = token ? await fetchOrdersLive(token, hjFromISO, hjToISO) : null;

    // fallback para o Firestore se o fetch ao vivo falhar
    if (!orders) orders = await loadOrders(db, start, end, startBR, endBR);
    if (!ordersHoje) ordersHoje = await loadOrders(db, `${hj}T00:00:00.000Z`, `${hj}T23:59:59.999Z`, hjFromISO, hjToISO);

    /**
     * Recorte final pelo dia BR — ver recortarPorDiaBR. É o que faz o
     * faturamento do app fechar com o "Vendas brutas" do Seller Center em vez
     * de vir alguns reais acima por causa das vendas da borda.
     */
    const recorte = recortarPorDiaBR(orders, fromStr, toStr);
    orders = recorte.dentro;
    ordersHoje = recortarPorDiaBR(ordersHoje, hj, hj).dentro;

    // enriquece o frete (shipping_cost) a partir do cache do Firestore
    const allIds = [...orders, ...ordersHoje].map((o) => String(o.order_id ?? "")).filter(Boolean);
    const shipMap = await readShippingCosts(db, allIds);
    /**
     * "Não sei" NÃO pode virar "zero".
     *
     * O custo de frete do vendedor só existe depois que o sync consulta
     * /shipments/{id}/costs e grava. Pedido que ainda não passou por ali não
     * está em `shipMap` — e o `?? 0` transformava essa ausência em frete
     * grátis, inflando a margem em silêncio. É o mesmo padrão que já mordeu
     * aqui em cancelamento e em estoque: falta de dado virando o número
     * favorável.
     *
     * O valor segue 0 (não dá pra somar um custo que não conhecemos), mas
     * agora contamos quantos pedidos estão nessa situação e o quanto eles
     * representam, pra tela poder dizer que a margem é um TETO.
     */
    // 1) O que o cache já tem.
    for (const o of orders) if (o.shipping_cost == null) { const v = shipMap.get(String(o.order_id)); if (v != null) o.shipping_cost = v; }
    for (const o of ordersHoje) if (o.shipping_cost == null) { const v = shipMap.get(String(o.order_id)); if (v != null) o.shipping_cost = v; }

    /**
     * 2) O que falta, BUSCA no ML — não assume zero.
     *
     * Antes o que faltava caía direto num `?? 0`, e a margem daquele pedido
     * saía como se o frete fosse grátis. Agora o custo é consultado de fato
     * (ver completarFretesFaltantes), priorizando os pedidos de maior valor,
     * que são os que mais distorcem a margem. Best-effort e com teto: é uma
     * requisição por pedido, e o mês inteiro sem sync estouraria o tempo.
     */
    let pedidosSemFrete = 0;
    let valorSemFrete = 0;
    if (token) {
      await completarFretesFaltantes(token, orders).catch(() => ({ buscados: 0, aindaSemFrete: 0 }));
      await completarFretesFaltantes(token, ordersHoje, 20).catch(() => ({ buscados: 0, aindaSemFrete: 0 }));
    }

    // 3) O que AINDA falta entra como 0 — não dá pra somar o que não se sabe —
    //    mas é contado, pra tela poder dizer que a margem é um teto.
    const zerarDesconhecido = (o: FirebaseFirestore.DocumentData, contar: boolean) => {
      if (o.shipping_cost != null) return;
      if (contar) { pedidosSemFrete++; valorSemFrete += Number(o.total_amount ?? 0); }
      o.shipping_cost = 0;
      o.frete_desconhecido = true;
    };
    for (const o of orders) zerarDesconhecido(o, true);
    for (const o of ordersHoje) zerarDesconhecido(o, false);

    // ── Devoluções + cancelamentos: separa por tipo ───────────
    // Cancelamento = venda que não aconteceu (estoque não saiu/voltou).
    // Devolução = venda revertida, produto volta ao estoque → 0 a 0.
    // Os dois entram no faturamento BRUTO, mas saem do líquido e do lucro.
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    /**
     * A consulta acima UNE uma janela UTC com uma janela BR — união que
     * arrasta as 3 últimas horas do dia ANTERIOR ao período (ver
     * recortarPorDiaBR). Para os Ids de cancelamento isso é inofensivo (um
     * pedido de fora não está em `orders`), mas o total de Devoluções somava
     * essa sobra e aparecia no KPI como devolução do período. Mesmo recorte
     * por dia BR aqui, pelo mesmo motivo.
     */
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR]) {
      for (const doc of snap.docs) {
        const dia = diaBRDe(String(doc.data()?.date_created ?? ""));
        if (dia >= fromStr && dia <= toStr) retMap.set(doc.id, doc.data());
      }
    }
    const cancelIds = new Set<string>();
    const devolIds = new Set<string>();
    const emAndamentoIds = new Set<string>();
    for (const [id, r] of retMap) {
      if (String(r.tipo ?? "") === "devolucao") {
        // Só reverte a venda quando a devolução foi concluída. Enquanto está em
        // disputa, o dinheiro/produto ainda pode ficar com você, então a venda
        // continua contando — descontar antes da hora mostraria lucro errado.
        if (devolucaoConcluida(r)) devolIds.add(id);
        else emAndamentoIds.add(id);
      } else {
        cancelIds.add(id); // cancelamento (ou sem tipo definido) já é final
      }
    }

    const agg = computeAggregates(orders, porMlb, porSku, adsByItem, cancelIds, devolIds);
    const aggHoje = computeAggregates(ordersHoje, porMlb, porSku, adsHoje, cancelIds, devolIds);

    // Série diária de faturamento líquido (para o gráfico de metas): sem
    // cancelados/devolvidos, pois representa a venda que de fato valeu.
    // Mesmo conjunto que o agregado usa — recalculado aqui porque a detecção
    // é do escopo da LISTA de pedidos, não de um pedido isolado.
    const substituidosSerie = detectarPedidosSubstituidos(
      orders.map((o) => ({
        orderId: String(o.order_id ?? ""),
        packId: o.pack_id as string | null | undefined,
        status: o.status,
      })),
    );
    const serieMap = new Map<string, number>();
    for (const o of orders) {
      const oid = String(o.order_id ?? "");
      // MESMA regra do agregado (classificarVenda) — duplicar a condição aqui
      // era o que fazia o gráfico e os KPIs discordarem quando uma delas mudava.
      if (classificarVenda({
        status: o.status,
        noCacheDeCancelados: cancelIds.has(oid),
        temDevolucaoConcluida: devolIds.has(oid),
        substituidoNoPacote: substituidosSerie.has(oid),
      }).classe !== "valida") continue;
      const dia = diaBRDe(String(o.date_created ?? ""));
      if (dia) serieMap.set(dia, (serieMap.get(dia) ?? 0) + Number(o.total_amount ?? 0));
    }
    const serieDiaria = Array.from(serieMap.entries())
      .map(([data, faturamento]) => ({ data, faturamento }))
      .sort((a, b) => a.data.localeCompare(b.data));

    // Diagnóstico de ADS quando o total do período vem 0 (identifica a causa)
    const adsDiag = agg.totalAds === 0 && fromStr <= adsTo ? await probeAds(fromStr, adsTo) : null;

    // ── 5. Devoluções ──
    // Só as concluídas (e os cancelamentos) foram excluídas do lucro acima. As
    // em andamento seguem contando como venda até a disputa fechar.
    const devolucoes = Array.from(retMap.entries())
      .filter(([id]) => !emAndamentoIds.has(id))
      .reduce((s, [, r]) => s + Number(r.total_amount ?? 0), 0);
    const devolucoesEmAndamento = Array.from(retMap.entries())
      .filter(([id]) => emAndamentoIds.has(id))
      .reduce((s, [, r]) => s + Number(r.total_amount ?? 0), 0);
    const devolucoesDetalhe = Array.from(retMap.entries())
      .map(([id, r]) => ({
        order_id: String(r.order_id ?? ""),
        valor: Number(r.total_amount ?? 0),
        data: diaBRDe(String(r.date_created ?? "")),
        motivo: String(r.reason ?? r.motivo ?? ""),
        produto: String(r.produto ?? r.title ?? ""),
        tipo: String(r.tipo ?? r.status ?? ""),
        // status cru + se está em andamento, para conferência na tela.
        status: `${String(r.status ?? "")}${r.stage ? ` · ${r.stage}` : ""}`.trim(),
        emAndamento: emAndamentoIds.has(id),
      }))
      .sort((a, b) => b.valor - a.valor);

    // ── 6. Custos operacionais ────────────────────────────────
    // Dias e meses cobertos pelo período selecionado
    const dFrom = new Date(`${fromStr}T00:00:00Z`).getTime();
    const dTo = new Date(`${toStr}T00:00:00Z`).getTime();
    const daysInPeriod = Math.max(1, Math.round((dTo - dFrom) / 86400000) + 1);
    const [fy, fm, fd] = fromStr.split("-").map(Number);
    const [ty, tm, td] = toStr.split("-").map(Number);
    // Custo MENSAL só entra em períodos que cobrem mês(es) completo(s).
    // Assim ele NÃO polui o lucro de "Hoje"/dias avulsos (é um custo do mês).
    const lastDayFrom = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
    const isFullMonth = fy === ty && fm === tm && fd === 1 && td === lastDayFrom;
    const monthsInPeriod = Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);

    const custosSnap = await db.collection("custos").get();
    let custosOp = 0;
    // Custo marcado como "dre" fica fora do lucro do Dashboard de propósito:
    // é despesa da empresa (pró-labore, contador), não da operação de venda.
    let custosDre = 0;
    const custosDreDetalhe: { nome: string; valor: number; freq: string }[] = [];
    for (const doc of custosSnap.docs) {
      const d = doc.data();
      // Arquivado (ativo:false) para de contar — é o ponto de "Arquivar" em
      // vez de excluir: sai do cálculo sem apagar o registro histórico.
      if (d.ativo === false) continue;
      const valor = Number(d.valor ?? d.amount ?? 0);
      const data = String(d.data ?? d.date ?? "");
      const freq = String(d.freq ?? d.frequency ?? "avulso");
      const soDre = String(d.escopo ?? "dash") === "dre";

      let noPeriodo = 0;
      if (freq === "diario" || freq === "daily") {
        noPeriodo = valor * daysInPeriod;                     // desconta todo dia
      } else if (freq === "mensal" || freq === "monthly") {
        if (isFullMonth) noPeriodo = valor * monthsInPeriod;  // só no mês completo
      } else if (data >= fromStr && data <= toStr) {
        noPeriodo = valor;                                    // avulso: só na data
      }
      if (noPeriodo === 0) continue;

      if (soDre) {
        custosDre += noPeriodo;
        custosDreDetalhe.push({ nome: String(d.nome ?? "—"), valor: noPeriodo, freq });
      } else {
        custosOp += noPeriodo;
      }
    }
    custosDreDetalhe.sort((a, b) => b.valor - a.valor);

    // ── 7. Lucro líquido do dia (retorno − cmv − full − ads − taxas − imposto) ──
    const lucroLiquidoHoje =
      aggHoje.totalRetorno - aggHoje.totalCMV - aggHoje.totalEnvio - aggHoje.totalAds - aggHoje.totalTaxasML - aggHoje.totalImposto;

    // ── 8. Totais finais do período ───────────────────────────
    // Devoluções/cancelamentos NÃO entram aqui: o pedido já foi removido do
    // faturamento e dos custos no agregado, resultando em 0 a 0 (não é descontado cheio).
    const lucroSemCustos =
      agg.totalRetorno - agg.totalCMV - agg.totalEnvio - agg.totalAds - agg.totalImposto - agg.totalTaxasML;
    const lucroComCustos = lucroSemCustos - custosOp;
    const margemSemCustos = agg.totalRetorno > 0 ? (lucroSemCustos / agg.totalRetorno) * 100 : 0;
    const margemComCustos = agg.totalRetorno > 0 ? (lucroComCustos / agg.totalRetorno) * 100 : 0;

    // Faturamento líquido = bruto − vendas canceladas − vendas devolvidas.
    const faturamentoLiquido = agg.faturamentoBruto - agg.vendasCanceladas - agg.vendasDevolvidas;
    const faturamentoLiquidoHoje = aggHoje.faturamentoBruto - aggHoje.vendasCanceladas - aggHoje.vendasDevolvidas;

    const responseBody: Record<string, unknown> = {
      faturamentoBruto: agg.faturamentoBruto,
      faturamentoLiquido,
      vendasCanceladas: agg.vendasCanceladas,
      vendasDevolvidas: agg.vendasDevolvidas,
      totalRetorno: agg.totalRetorno,
      faturamentoHoje: faturamentoLiquidoHoje,
      pedidosHoje: aggHoje.ordersCount,
      ordersCount: agg.ordersCount,
      devolucoes,
      devolucoesEmAndamento,
      devolucoesDetalhe,
      totalCMV: agg.totalCMV,
      totalAds: agg.totalAds,
      adsNaoVinculado: agg.adsNaoVinculado,
      totalEnvio: agg.totalEnvio,
      totalImposto: agg.totalImposto,
      totalTaxasML: agg.totalTaxasML,
      custosOperacionais: custosOp,
      // Só a DRE usa: o Dashboard ignora para não mudar o número do dia a dia.
      custosDre,
      custosDreDetalhe,
      lucroSemCustos,
      lucroComCustos,
      margemSemCustos,
      margemComCustos,
      anuncios: agg.anuncios,
      pedidosSemVinculo: agg.pedidosSemVinculo,
      // Conferência da margem contra o líquido real do Mercado Pago.
      reconc: agg.reconc,
      // Breakdown do dia para o card "Vendas do Dia"
      hoje: {
        faturamentoBruto: aggHoje.faturamentoBruto,
        faturamentoLiquido: faturamentoLiquidoHoje,
        vendasCanceladas: aggHoje.vendasCanceladas,
        vendasDevolvidas: aggHoje.vendasDevolvidas,
        totalCMV: aggHoje.totalCMV,
        totalAds: aggHoje.totalAds,
        totalEnvio: aggHoje.totalEnvio,
        totalTaxasML: aggHoje.totalTaxasML,
        totalImposto: aggHoje.totalImposto,
        lucroLiquido: lucroLiquidoHoje,
        pedidos: aggHoje.ordersCount,
      },
      /**
       * ── Conciliação com o Seller Center ──
       *
       * As MESMAS quatro métricas do painel "Resumo de desempenho" do Mercado
       * Livre, calculadas pelo nosso lado. Existe porque "o número não bate"
       * é impossível de investigar comparando um total contra outro: sem
       * separar venda, unidade e cancelamento, qualquer divergência vira
       * chute.
       *
       * A diferença de DEFINIÇÃO que mais confunde: o "Vendas brutas" do
       * Seller Center NÃO inclui os pedidos cancelados, enquanto o
       * "Faturamento bruto" daqui inclui de propósito (para o cancelamento
       * aparecer como linha própria). O campo comparável ao ML é
       * `vendasBrutas` abaixo — igual ao faturamento líquido.
       */
      conciliacao: {
        // Compare com "Vendas brutas" do Seller Center.
        vendasBrutas: faturamentoLiquido,
        // Compare com "Quantidade de vendas".
        quantidadeVendas: agg.ordersCount,
        // Compare com "Unidades vendidas".
        unidadesVendidas: agg.unidadesVendidas,
        // Compare com "Preço médio por venda" / "Preço médio por unidade".
        precoMedioPorVenda: agg.ordersCount > 0 ? faturamentoLiquido / agg.ordersCount : 0,
        precoMedioPorUnidade: agg.unidadesVendidas > 0 ? faturamentoLiquido / agg.unidadesVendidas : 0,
        // Compare com "Quantidade de vendas canceladas".
        canceladasQuantidade: agg.canceladasCount,
        canceladasValor: agg.vendasCanceladas,
        /** Os pedidos, um a um — pra conferir no Seller Center em vez de deduzir. */
        canceladasDetalhe: agg.canceladasDetalhe.slice(0, 40),
        /**
         * Pedidos cujo custo de frete do vendedor ainda não foi confirmado
         * pelo ML. Entram no lucro com frete 0 porque não há como somar o que
         * não se conhece — então o lucro e a margem são um TETO enquanto isso.
         */
        pedidosSemFrete,
        valorSemFrete,
        /**
         * Pedidos que o ML devolveu mas cujo dia BR cai FORA do período — já
         * descartados do cálculo (ver recortarPorDiaBR). Se vier > 0, é a
         * borda de fuso agindo: sem o recorte eles inflariam o faturamento.
         */
        descartadosForaDaJanela: recorte.foraDaJanela,
        /**
         * Pedidos que a coleção `ml_returns` dava como cancelados mas o ML
         * confirma como venda boa — cancelamento revertido que ficou gravado,
         * já que aquele sync só escreve e nunca remove. Antes eram descontados
         * pra sempre; agora contam como venda e aparecem aqui, pra a correção
         * ser visível em vez de silenciosa.
         */
        resgatadosDoCache: agg.resgatadosDoCache,
        /**
         * Pedidos cancelados só para virar outros do mesmo pacote — separação
         * de envio na agência. Não entram em lugar nenhum (nem bruto, nem
         * canceladas), porque o valor já está nos pedidos que os
         * substituíram. Exposto pra correção ser visível.
         */
        substituidasQuantidade: agg.substituidasCount,
        substituidasValor: agg.substituidasValor,
        substituidasUnidades: agg.substituidasUnidades,
      },
      serieDiaria,
      adsDiag,
      adsFalhou, // true = não consegui o gasto de ADS; a tela NÃO deve mostrar 0
      from: fromStr,
      to: toStr,
    };
    metricsCache.set(cacheKey, { at: Date.now(), body: responseBody });
    return NextResponse.json(responseBody);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}
