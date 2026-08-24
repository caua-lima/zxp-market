import "server-only";
import { getValidMlAccessToken } from "@/lib/ml/getToken";

const ML_API = "https://api.mercadolibre.com";

type Advertiser = { advertiser_id?: number | string; site_id?: string; account_name?: string };
type Adv = { id: string; siteId: string };

// Cache do anunciante por lambda quente (evita resolver a cada chamada)
let advCache: { adv: Adv | null; at: number } | null = null;
const ADV_TTL = 10 * 60 * 1000;

/**
 * Resolve o anunciante da conta (NÃO é o seller_id) e o site dele.
 * O site entra na URL dos recursos de Product Ads, por isso vem junto.
 */
async function getAdvertiser(token: string): Promise<Adv | null> {
  if (advCache && Date.now() - advCache.at < ADV_TTL) return advCache.adv;

  const res = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
    headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
    cache: "no-store",
  });
  if (!res.ok) return advCache?.adv ?? null; // mantém cache anterior em falha transitória
  const j = (await res.json()) as { advertisers?: Advertiser[] };
  const list = Array.isArray(j?.advertisers) ? j.advertisers : [];
  const chosen = list.find((a) => String(a.site_id ?? "").toUpperCase() === "MLB") ?? list[0];
  if (chosen?.advertiser_id == null) return null;
  const adv: Adv = { id: String(chosen.advertiser_id), siteId: String(chosen.site_id ?? "MLB").toUpperCase() };
  advCache = { adv, at: Date.now() }; // NÃO cacheia null (evita travar em 0)
  return adv;
}

/**
 * TODOS os anunciantes da conta, não só o primeiro. Uma conta pode ter mais de
 * um anunciante (ex.: uma marca por anunciante) e as campanhas de cada um só
 * aparecem na URL do respectivo advertiser_id — pegando só o primeiro, os
 * anúncios dos outros ficavam eternamente "sem campanha" mesmo gastando de
 * verdade, e o gasto deles não batia com nenhuma campanha da lista.
 */
async function getAdvertisersAll(token: string): Promise<Adv[]> {
  const res = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
    headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { advertisers?: Advertiser[] };
  const list = Array.isArray(j?.advertisers) ? j.advertisers : [];
  return list
    .filter((a) => a?.advertiser_id != null)
    .map((a) => ({ id: String(a.advertiser_id), siteId: String(a.site_id ?? "MLB").toUpperCase() }));
}

/** GET com retry em 429/5xx, tentando Api-Version 2 e caindo pra 1. */
async function get(url: string, token: string): Promise<Response> {
  const call = async (v: string) => {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Api-Version": v }, cache: "no-store" });
    for (let i = 1; i < 3 && (res.status === 429 || res.status >= 500); i++) {
      await new Promise((r) => setTimeout(r, 400 * i));
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Api-Version": v }, cache: "no-store" });
    }
    return res;
  };
  const v2 = await call("2");
  if (v2.status !== 404) return v2;
  const v1 = await call("1");
  return v1.status === 404 ? v2 : v1;
}

/**
 * Extrai as linhas da resposta sem depender de um nome de campo fixo. O ML mudou
 * o formato ao migrar o recurso; ler só `results` fazia a lista vir vazia e o
 * gasto virar R$ 0,00 silenciosamente.
 */
function extrairLinhas(j: unknown): Record<string, unknown>[] {
  if (!j || typeof j !== "object") return [];
  const o = j as Record<string, unknown>;
  for (const k of ["results", "items", "ads", "data", "campaigns"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  for (const v of Object.values(o)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v as Record<string, unknown>[];
  }
  return [];
}

/** Número de uma métrica, esteja ela em row.metrics.X, row.metrics_summary.X ou row.X. */
function metrica(row: Record<string, unknown>, chave: string): number {
  const fontes = [row.metrics, row.metrics_summary, row].filter(
    (f): f is Record<string, unknown> => !!f && typeof f === "object",
  );
  for (const f of fontes) {
    const v = f[chave];
    if (v != null && v !== "") return Number(v) || 0;
  }
  return 0;
}

const CHAVES_ID = ["item_id", "mlb_item_id", "item", "id"] as const;
const texto = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/**
 * MLB do anúncio. Prioriza um valor no formato MLBxxxx: o cruzamento com as
 * vendas é por MLB, e pegar o id da campanha aqui zerava o modo "Geral".
 */
function itemIdDe(row: Record<string, unknown>): string {
  for (const k of CHAVES_ID) {
    const s = texto(row[k]);
    if (/^MLB\d+$/i.test(s)) return s.toUpperCase();
  }
  for (const k of CHAVES_ID) {
    const s = texto(row[k]);
    if (s) return s.toUpperCase();
  }
  return "";
}

const base = (adv: Adv) => `${ML_API}/marketplace/advertising/${adv.siteId}/advertisers/${adv.id}/product_ads`;
const legado = (adv: Adv) => `${ML_API}/advertising/advertisers/${adv.id}/product_ads`;

const ehMlb = (s: string) => /^MLB\d+$/i.test(s);

// Cache do mapa campanha → MLB (o mesmo TTL do anunciante)
let mapaCache: { mapa: Record<string, string>; at: number } | null = null;

/**
 * Mapa campaign_id → MLB, montado perguntando ao ML a qual campanha cada um dos
 * nossos anúncios pertence (/advertising/product_ads/items/{MLB} devolve
 * campaign_id). Serve para traduzir linhas de CAMPANHA em anúncio de verdade —
 * sem isso o cruzamento com as vendas (que é por MLB) não acha nada.
 */
async function mapaCampanhaMlb(token: string, mlbs: string[]): Promise<Record<string, string>> {
  if (mapaCache && Date.now() - mapaCache.at < ADV_TTL) return mapaCache.mapa;
  const mapa: Record<string, string> = {};
  await Promise.all(
    mlbs.map(async (mlb) => {
      try {
        const r = await get(`${ML_API}/advertising/product_ads/items/${mlb}`, token);
        if (!r.ok) return;
        const j = (await r.json()) as Record<string, unknown>;
        const cid = texto(j.campaign_id);
        if (cid) mapa[cid] = mlb.toUpperCase();
      } catch { /* item fora de ads: ignora */ }
    }),
  );
  if (Object.keys(mapa).length > 0) mapaCache = { mapa, at: Date.now() };
  return mapa;
}

/** Troca id de campanha pelo MLB do anúncio quando a linha não veio com MLB. */
async function resolverMlb(
  rows: Record<string, unknown>[], token: string, mlbs: string[],
): Promise<Record<string, unknown>[]> {
  if (mlbs.length === 0 || rows.every((r) => ehMlb(itemIdDe(r)))) return rows;
  const mapa = await mapaCampanhaMlb(token, mlbs);
  if (Object.keys(mapa).length === 0) return rows; // sem mapa: mantém como está
  return rows.map((r) => {
    const id = itemIdDe(r);
    if (ehMlb(id)) return r;
    const mlb = mapa[texto(r.campaign_id) || id];
    return mlb ? { ...r, item_id: mlb } : r;
  });
}

/**
 * Identidade de uma linha, para não contar a mesma duas vezes na paginação.
 *
 * Inclui os campos de data quando existem: se o recurso devolver uma linha por
 * DIA (em vez de um resumo do período), cada dia continua sendo uma linha
 * distinta e nada é descartado. Linha sem nenhum identificador devolve null —
 * aí não dá pra PROVAR que é duplicata, e o certo é manter (perder gasto real
 * é pior do que somar demais).
 */
function chaveLinha(row: Record<string, unknown>): string | null {
  const id =
    texto(row.ad_id) || texto(row.id) || texto(row.item_id) || texto(row.mlb_item_id);
  if (!id) return null;
  return [
    id,
    texto(row.campaign_id) || texto(row.campaignId),
    texto(row.date) || texto(row.day) || texto(row.date_from),
    texto(row.date_to),
  ].join("|");
}

// Trava de segurança: com o offset sendo ignorado pelo recurso, o laço só
// termina pela contagem de linhas novas — este teto evita qualquer chance de
// laço infinito consumindo a duração da função.
const MAX_PAGINAS = 40;

/** Busca paginada de um recurso, tentando as URLs candidatas em ordem. */
async function buscar(urls: (offset: number) => string[], token: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const vistos = new Set<string>();
  let offset = 0;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    let linhas: Record<string, unknown>[] | null = null;
    let total = 0;
    for (const url of urls(offset)) {
      const res = await get(url, token);
      if (res.status === 404) continue; // rota não existe → tenta a próxima
      if (!res.ok) throw new Error(`ml_ads_http_${res.status}: ${(await res.text()).slice(0, 160)}`);
      const j = await res.json().catch(() => null);
      linhas = extrairLinhas(j);
      total = Number((j as { paging?: { total?: number } })?.paging?.total ?? linhas.length);
      break;
    }
    if (linhas === null) return out; // nenhuma URL respondeu → deixa o chamador decidir

    /**
     * A MESMA linha voltando em duas páginas era somada duas vezes lá na
     * frente (getAdsFullByItem agrupa por item e SOMA as métricas), dobrando
     * impressões, cliques, investimento e receita atribuída do anúncio — o
     * ACOS/ROAS continuavam certos porque numerador e denominador dobravam
     * juntos, então o erro passava despercebido.
     *
     * Isso acontece quando o recurso ignora o `offset` ou quando a ordenação
     * não é estável entre as chamadas: as páginas se sobrepõem e alguns
     * anúncios aparecem duas vezes (e outros, nenhuma). Descartar por
     * identidade resolve os dois casos — e NÃO atrapalha o anúncio que está
     * de verdade em duas campanhas, porque aí o campaign_id difere e as duas
     * linhas continuam contando.
     */
    let novas = 0;
    for (const linha of linhas) {
      const chave = chaveLinha(linha);
      if (chave !== null) {
        if (vistos.has(chave)) continue;
        vistos.add(chave);
      }
      out.push(linha);
      novas++;
    }

    offset += linhas.length;
    // `novas === 0`: a página inteira já tinha sido lida — sinal de que o
    // offset não está sendo respeitado. Continuar só repetiria o mesmo lote.
    if (linhas.length === 0 || novas === 0 || offset >= total) break;
  }
  return out;
}

/** Linhas de item com métricas, tentando o recurso novo e, se preciso, por campanha. */
async function adItemRows(from: string, to: string, metrics: string): Promise<Record<string, unknown>[]> {
  const token = await getValidMlAccessToken();
  const adv = await getAdvertiser(token);
  if (!adv) throw new Error("ml_ads_sem_anunciante");

  const q = (offset: number) => `date_from=${from}&date_to=${to}&metrics=${metrics}&limit=50&offset=${offset}`;

  // 1) Anúncios direto. "ads" é o recurso que traz o MLB do item — "items" vinha
  //    vazio e nos jogava no fallback de campanha (sem MLB, o "Geral" zerava).
  const direto = await buscar(
    (o) => [`${base(adv)}/ads/search?${q(o)}`, `${base(adv)}/items/search?${q(o)}`, `${legado(adv)}/items?${q(o)}`],
    token,
  );
  if (direto.length > 0) return direto;

  // 2) Sem itens: pega as campanhas e busca os itens de cada uma
  const camps = await buscar(
    (o) => [`${base(adv)}/campaigns/search?${q(o)}`, `${legado(adv)}/campaigns?${q(o)}`],
    token,
  );
  const ids = camps.map((c) => String(c.id ?? c.campaign_id ?? "")).filter(Boolean);
  if (ids.length === 0) throw new Error("ml_ads_sem_dados: nenhum item e nenhuma campanha retornados");

  /**
   * A deduplicação de buscar() é por chamada, então ela NÃO enxerga repetição
   * entre campanhas: cada volta do laço é uma busca nova, com o próprio
   * histórico. Se o candidato que responde ignorar o `filters[campaign_id]`
   * (aceita o parâmetro e devolve a conta inteira), cada campanha traria todos
   * os anúncios de novo e o gasto sairia multiplicado pelo número de
   * campanhas — o mesmo erro de métrica dobrada, só que pior. O histórico
   * compartilhado aqui garante que cada anúncio entra uma vez só.
   */
  const out: Record<string, unknown>[] = [];
  const vistosGeral = new Set<string>();
  for (const cid of ids) {
    const qc = (offset: number) => `${q(offset)}&filters[campaign_id]=${encodeURIComponent(cid)}`;
    const rows = await buscar(
      (o) => [
        `${base(adv)}/ads/search?${qc(o)}`,
        `${base(adv)}/campaigns/${cid}/ads/search?${q(o)}`,
        `${base(adv)}/campaigns/${cid}/items/search?${q(o)}`,
        `${base(adv)}/items/search?${qc(o)}`,
        `${legado(adv)}/items?${qc(o)}`,
      ],
      token,
    );
    // Sem item: usa a própria campanha como linha (cada campanha aqui tem 1 anúncio)
    const doCiclo = rows.length ? rows : camps.filter((c) => String(c.id ?? c.campaign_id ?? "") === cid);
    for (const linha of doCiclo) {
      const chave = chaveLinha(linha);
      if (chave !== null) {
        if (vistosGeral.has(chave)) continue;
        vistosGeral.add(chave);
      }
      out.push(linha);
    }
  }
  if (out.length === 0) throw new Error("ml_ads_sem_dados: campanhas existem mas nenhum item retornou");
  return out;
}

/**
 * Gasto de ADS (Product Ads) por item_id (MLB) no período.
 * Chave do mapa = item_id em UPPERCASE (ex.: "MLB1234567890").
 * Lança em falha — quem chama decide o que mostrar (nunca 0 como se fosse real).
 */
export async function getAdsSpendByItem(
  from: string, to: string, mlbs: string[] = [],
): Promise<Record<string, number>> {
  const { gastoPorItem } = await getAdsGastoEDireto(from, to, mlbs);
  return gastoPorItem;
}

/**
 * Gasto E receita de venda DIRETA de Ads no período, na mesma chamada.
 *
 * `direct_amount` viaja de graça junto do `cost` — a API cobra por
 * requisição, não por métrica pedida. Buscar as duas aqui evita uma segunda
 * ida ao Mercado Ads só pra saber quanto a publicidade vendeu direto.
 *
 * "Direta" é a leitura conservadora: o comprador clicou no anúncio pago e
 * comprou. Não inclui venda assistida (viu o anúncio, comprou depois por
 * outro caminho), que o painel do ML soma em "vendas atribuídas".
 */
export async function getAdsGastoEDireto(
  from: string, to: string, mlbs: string[] = [],
): Promise<{ gastoPorItem: Record<string, number>; gastoTotal: number; vendaDiretaTotal: number }> {
  const token = await getValidMlAccessToken();
  const rows = await resolverMlb(await adItemRows(from, to, "cost,direct_amount"), token, mlbs);
  const gastoPorItem: Record<string, number> = {};
  let gastoTotal = 0;
  let vendaDiretaTotal = 0;
  for (const row of rows) {
    const custo = metrica(row, "cost");
    gastoTotal += custo;
    vendaDiretaTotal += metrica(row, "direct_amount");
    const itemId = itemIdDe(row);
    if (itemId) gastoPorItem[itemId] = (gastoPorItem[itemId] ?? 0) + custo;
  }
  return { gastoPorItem, gastoTotal, vendaDiretaTotal };
}

export type AdItemFull = {
  itemId: string;
  title: string;
  status: string;
  clicks: number;
  prints: number;      // impressões
  ctr: number;         // %
  cost: number;        // investimento R$
  cpc: number;         // custo por clique
  acos: number;        // % (custo / receita atribuída)
  cvr: number;         // % (conversão)
  sales: number;       // receita atribuída total (direto + indireto)
  units: number;       // unidades atribuídas
  directSales: number; // receita das vendas DIRETAS do anúncio
  directUnits: number; // unidades diretas
  indirectSales: number;
  /** Unidades de venda ASSISTIDA. direct + indirect = "Vendas atribuidas" do painel do ML. */
  indirectUnits: number;
  /** campaign_id, quando a própria linha de métricas já trouxe — evita uma
   *  chamada extra por item em getAdsSettingsByItem. */
  campaignId: string;
  /**
   * O MESMO gasto, quebrado por campanha.
   *
   * O total acima responde "quanto este ANÚNCIO custou"; isto responde
   * "quanto cada CAMPANHA gastou nele" — e só o segundo bate com o painel do
   * Mercado Ads, que é organizado por campanha.
   *
   * Existe por causa de um erro real: um anúncio que rodou em duas campanhas
   * (a antiga foi excluída no meio do período) tinha o gasto das duas somado
   * numa linha só, e a linha inteira era carimbada com a PRIMEIRA campanha
   * vista. A campanha sobrevivente aparecia com o dobro do que o ML mostrava
   * — 206 cliques e R$ 47,59 contra 104 cliques e R$ 16,91 reais.
   */
  campanhas: AdItemCampanha[];
};

/** Fatia do investimento de um anúncio dentro de UMA campanha. */
export type AdItemCampanha = {
  campaignId: string;
  clicks: number;
  prints: number;
  cost: number;
  sales: number;
  units: number;
  directSales: number;
  directUnits: number;
  /** Unidades de venda ASSISTIDA. direta + assistida = "Vendas atribuidas" do ML. */
  indirectUnits: number;
};

/**
 * `indirect_items_quantity` entrou depois e e a correcao de um numero errado:
 * a coluna "Vendas atribuidas" do painel do ML e direct + indirect, nao
 * `advertising_items_quantity` (que e outra metrica, menor). Medido em 5
 * campanhas da conta — onde a venda indireta era zero os dois batiam, e onde
 * nao era o app mostrava 6 contra 14 do ML.
 */
const AD_METRICS = "clicks,prints,ctr,cost,cpc,acos,cvr,total_amount,direct_amount,indirect_amount,direct_items_quantity,indirect_items_quantity,advertising_items_quantity";

/** Métricas COMPLETAS de Product Ads por item no período (pra aba de análise). */
export async function getAdsFullByItem(
  from: string, to: string, mlbs: string[] = [],
): Promise<AdItemFull[]> {
  const token = await getValidMlAccessToken();
  let rows: Record<string, unknown>[];
  try {
    rows = await adItemRows(from, to, AD_METRICS);
  } catch (e) {
    // Uma métrica inválida derruba a busca inteira → tenta o conjunto essencial.
    if (String(e).includes("ml_ads_http_4")) rows = await adItemRows(from, to, "clicks,prints,ctr,cost,cpc,acos");
    else throw e;
  }
  rows = await resolverMlb(rows, token, mlbs);

  /**
   * Um MLB pode vir em mais de uma linha (anunciado em duas campanhas, ou
   * paginação duplicando o mesmo anúncio) — sem agrupar, a tabela mostrava o
   * mesmo produto duas vezes com o investimento partido entre as linhas.
   * Agrupamos por item e SOMAMOS as métricas de base; as taxas (CTR/CPC/ACOS/
   * CVR) são recalculadas a partir da soma — nunca a média das taxas prontas,
   * que dá número errado quando os volumes das linhas são diferentes.
   */
  type Acc = {
    itemId: string; title: string; status: string; campaignId: string;
    clicks: number; prints: number; cost: number; sales: number; units: number;
    directSales: number; directUnits: number; indirectSales: number; indirectUnits: number;
    /** Mesmas métricas fatiadas por campanha — ver AdItemFull.campanhas. */
    porCampanha: Map<string, AdItemCampanha>;
  };
  const porItem = new Map<string, Acc>();
  for (const row of rows) {
    const itemId = itemIdDe(row);
    if (!itemId) continue;
    const cur = porItem.get(itemId) ?? {
      itemId, title: "", status: "", campaignId: "",
      clicks: 0, prints: 0, cost: 0, sales: 0, units: 0,
      directSales: 0, directUnits: 0, indirectSales: 0, indirectUnits: 0,
      porCampanha: new Map<string, AdItemCampanha>(),
    };
    if (!cur.title) cur.title = String(row.title ?? row.name ?? row.campaign_name ?? "");
    if (!cur.status) cur.status = String(row.status ?? "");

    const linhaCampanha = String(row.campaign_id ?? row.campaignId ?? "");
    const custoLinha = metrica(row, "cost");
    /**
     * A campanha "principal" do anúncio é a que MAIS gastou no período, não a
     * primeira linha que apareceu. Com duas campanhas no mesmo anúncio, a
     * ordem das linhas é do ML e não significa nada — carimbar pela primeira
     * atribuía o total à campanha errada com frequência.
     */
    if (linhaCampanha && custoLinha > (cur.porCampanha.get(cur.campaignId)?.cost ?? -1)) {
      cur.campaignId = linhaCampanha;
    }

    cur.clicks += metrica(row, "clicks");
    cur.prints += metrica(row, "prints");
    cur.cost += custoLinha;
    cur.sales += metrica(row, "total_amount");
    cur.units += metrica(row, "advertising_items_quantity");
    cur.directSales += metrica(row, "direct_amount");
    cur.directUnits += metrica(row, "direct_items_quantity");
    cur.indirectSales += metrica(row, "indirect_amount");
    cur.indirectUnits += metrica(row, "indirect_items_quantity");

    const fatia: AdItemCampanha = cur.porCampanha.get(linhaCampanha) ?? {
      campaignId: linhaCampanha,
      clicks: 0, prints: 0, cost: 0, sales: 0, units: 0, directSales: 0, directUnits: 0, indirectUnits: 0,
    };
    fatia.clicks += metrica(row, "clicks");
    fatia.prints += metrica(row, "prints");
    fatia.cost += custoLinha;
    fatia.sales += metrica(row, "total_amount");
    fatia.units += metrica(row, "advertising_items_quantity");
    fatia.directSales += metrica(row, "direct_amount");
    fatia.directUnits += metrica(row, "direct_items_quantity");
    fatia.indirectUnits += metrica(row, "indirect_items_quantity");
    cur.porCampanha.set(linhaCampanha, fatia);

    porItem.set(itemId, cur);
  }

  return Array.from(porItem.values()).map((a) => ({
    itemId: a.itemId,
    title: a.title,
    status: a.status,
    campaignId: a.campaignId,
    clicks: a.clicks,
    prints: a.prints,
    ctr: a.prints > 0 ? (a.clicks / a.prints) * 100 : 0,
    cost: a.cost,
    cpc: a.clicks > 0 ? a.cost / a.clicks : 0,
    acos: a.sales > 0 ? (a.cost / a.sales) * 100 : 0,
    cvr: a.clicks > 0 ? (a.units / a.clicks) * 100 : 0,
    sales: a.sales,
    units: a.units,
    directSales: a.directSales,
    directUnits: a.directUnits,
    indirectSales: a.indirectSales,
    indirectUnits: a.indirectUnits,
    campanhas: Array.from(a.porCampanha.values()).sort((x, y) => y.cost - x.cost),
  }));
}

/**
 * Status real do anúncio no Mercado Livre (do catálogo, não da campanha de
 * ads) — "active"/"paused"/"closed"/etc. Serve para as etiquetas Ativo/
 * Pausado/Excluído na aba de Ads: o status dentro do Product Ads pode não
 * refletir que o anúncio foi encerrado no catálogo.
 */
export async function getItemStatusByItem(mlbs: string[]): Promise<Record<string, string>> {
  const token = await getValidMlAccessToken();
  const out: Record<string, string> = {};
  const uniq = Array.from(new Set(mlbs.map((m) => m.toUpperCase()))).filter((m) => /^MLB\d+$/.test(m));
  for (let i = 0; i < uniq.length; i += 20) {
    const chunk = uniq.slice(i, i + 20);
    try {
      const res = await fetch(`${ML_API}/items?ids=${chunk.join(",")}&attributes=id,status`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const rows = (await res.json()) as { code?: number; body?: { id?: string; status?: string } }[];
      for (const row of rows) {
        const id = String(row.body?.id ?? "").toUpperCase();
        if (id) out[id] = String(row.body?.status ?? "");
      }
    } catch { /* item sem resposta: fica sem status, tratado como excluído no chamador */ }
  }
  return out;
}

export type AdSettings = {
  itemId: string;
  campaignId: string;    // "" quando não achamos a campanha do anúncio
  campaignName: string;
  dailyBudget: number;   // orçamento diário da campanha (R$); 0 = não informado
  acosTarget: number;    // meta de ACOS (%); 0 = não informado
  roasTarget: number;    // meta de ROAS (direta do ML ou derivada de ACOS); 0 = não informado
  strategy: string;      // estratégia da campanha (texto do ML)
  status: string;        // status da CAMPANHA (active/paused/...), não do anúncio
};

// número tolerante: aceita 12, "12", "12.5" e objetos { amount } / { value }.
function numTolerante(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return numTolerante(o.amount ?? o.value ?? o.daily ?? o.target);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function primeiro(o: Record<string, unknown>, chaves: string[]): unknown {
  for (const k of chaves) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
}

/** Campanha crua do ML → AdSettings, tolerando os nomes de campo que o ML já usou. */
function campanhaDe(id: string, c: Record<string, unknown>): AdSettings {
  const acos = numTolerante(primeiro(c, ["acos_target", "target_acos", "acos_objective", "acos"]));
  const roasDireto = numTolerante(primeiro(c, ["roas_target", "target_roas"]));
  return {
    itemId: "", campaignId: id,
    campaignName: texto(primeiro(c, ["name", "campaign_name"])),
    dailyBudget: numTolerante(primeiro(c, ["budget", "daily_budget", "budget_amount", "daily_budget_amount"])),
    acosTarget: acos > 0 ? acos : (roasDireto > 0 ? 100 / roasDireto : 0),
    roasTarget: roasDireto > 0 ? roasDireto : (acos > 0 ? 100 / acos : 0),
    strategy: texto(primeiro(c, ["strategy", "campaign_strategy", "goal"])),
    status: texto(primeiro(c, ["status"])),
  };
}

/**
 * Configuração de cada anúncio vem da CAMPANHA à qual ele pertence: orçamento
 * diário, meta de ACOS/ROAS, status (ativa/pausada) e última alteração — não
 * do anúncio em si. A versão anterior buscava isso por um GET de item único
 * (`/advertising/product_ads/items/{id}` e variantes novas por id), que nunca
 * respondeu nesta conta: ficou tudo vazio duas vezes seguidas.
 *
 * Agora usamos só recursos de BUSCA (mesma família do `/ads/search` que já
 * funciona para a tabela principal), nunca GET por id isolado:
 *   1. `/campaigns/search` — lista TODAS as campanhas de uma vez (1 chamada),
 *      com status/orçamento/meta próprios. Não depende de saber o campaign_id
 *      de nenhum item antes.
 *   2. Para achar A QUAL campanha cada anúncio pertence: usa o campaign_id que
 *      já veio junto das métricas (getAdsFullByItem) quando disponível; para
 *      o resto, busca os anúncios DE CADA campanha (`/campaigns/{id}/ads/search`
 *      — a mesma busca, só filtrada por campanha).
 * Anúncio sem campanha resolvida fica com campaignId="" (o chamador rotula
 * como "sem campanha", não como erro).
 */
export async function getAdsSettingsByItem(
  mlbs: string[],
  campaignIdByItem: Record<string, string> = {},
  costByItem: Record<string, number> = {},
): Promise<{
  porItem: Record<string, AdSettings>;
  amostraCampanha: unknown;
  tentativas: { url: string; status: number }[];
  campanhasEncontradas: number;
  campanhasTotal: number;
  campanhasResumo: { id: string; name: string; status: string; gasto: number; totalAds: number }[];
  anunciosTotal: number;
  anunciosNoPeriodo: number;
  anunciosContagemFalhou: boolean;
  /** campaign_ids que os anúncios declararam mas que não vieram na lista de campanhas. */
  campanhasOrfas: string[];
  /** R$ do período gastos por anúncios cuja campanha não está na lista. */
  gastoOrfao: number;
  /** R$ do período gastos por anúncios sem nenhuma campanha resolvida. */
  gastoSemVinculo: number;
  /** Objeto cru da 1ª campanha órfã recuperada — mostra por que ela faltava na lista. */
  amostraCampanhaOrfa: unknown;
}> {
  const token = await getValidMlAccessToken();
  const adv = await getAdvertiser(token);
  const porItem: Record<string, AdSettings> = {};
  const tentativas: { url: string; status: number }[] = [];
  if (!adv || mlbs.length === 0) return {
    porItem, amostraCampanha: null, tentativas,
    campanhasEncontradas: 0, campanhasTotal: 0, campanhasResumo: [],
    anunciosTotal: 0, anunciosNoPeriodo: 0, anunciosContagemFalhou: false,
    campanhasOrfas: [], gastoOrfao: 0, gastoSemVinculo: 0, amostraCampanhaOrfa: null,
  };
  const advOk: Adv = adv;

  // Diagnóstico honesto: testa as duas URLs candidatas isoladamente (1 item
  // só, rápido) ANTES de pedir a lista completa — se nenhuma vier 200, o
  // problema é o endpoint, e isso fica visível na tela sem precisar chutar de novo.
  for (const url of [`${base(advOk)}/campaigns/search?limit=1`, `${legado(advOk)}/campaigns?limit=1`]) {
    try {
      const r = await get(url, token);
      tentativas.push({ url: url.replace(ML_API, ""), status: r.status });
    } catch {
      tentativas.push({ url: url.replace(ML_API, ""), status: -1 });
    }
  }

  /**
   * Campanhas de TODOS os anunciantes da conta. Antes só o primeiro era
   * consultado: se a conta tem mais de um anunciante, os anúncios dos outros
   * gastavam de verdade mas nunca achavam campanha ("sem campanha"), e o gasto
   * deles não batia com nenhuma linha da lista de campanhas.
   */
  const anunciantes = await getAdvertisersAll(token).catch(() => []);
  const todosAdvs = anunciantes.length > 0 ? anunciantes : [advOk];
  // Guarda de qual anunciante veio cada campanha — a busca dos anúncios dela
  // precisa ser feita na URL do anunciante certo.
  const advDaCampanha = new Map<string, Adv>();
  const camposCrus: Record<string, unknown>[] = [];
  for (const a of todosAdvs) {
    const linhas = await buscar(
      (o) => [`${base(a)}/campaigns/search?limit=50&offset=${o}`, `${legado(a)}/campaigns?limit=50&offset=${o}`],
      token,
    ).catch(() => []);
    for (const c of linhas) {
      const id = texto(primeiro(c, ["id", "campaign_id"]));
      if (id) advDaCampanha.set(id, a);
    }
    camposCrus.push(...linhas);
  }
  if (todosAdvs.length > 1) {
    tentativas.push({ url: `[anunciantes] ${todosAdvs.map((a) => a.id).join(", ")}`, status: 200 });
  }
  const amostraCampanha = camposCrus[0] ?? null;

  const campanhas = new Map<string, AdSettings>();
  for (const c of camposCrus) {
    const id = texto(primeiro(c, ["id", "campaign_id"]));
    if (!id) continue;
    campanhas.set(id, campanhaDe(id, c));
  }

  // itemId (MLB) → campaignId, em ordem de confiança:
  const mlbsUpper = Array.from(new Set(mlbs.map((m) => m.toUpperCase())));
  const itemToCampaign: Record<string, string> = { ...campaignIdByItem }; // 1) já veio das métricas

  /**
   * 2) Fonte PRINCIPAL: pergunta a cada campanha quais anúncios são dela.
   *
   * O diagnóstico em produção resolveu a dúvida de qual rota confiar:
   * `/campaigns/{id}/ads/search` responde 404, mas o candidato seguinte
   * (`/ads/search?filters[campaign_id]=`) responde E respeita o filtro — a
   * contagem por campanha bateu exatamente com o painel do Mercado Ads
   * (2/2/2/2/1/1/1/1/1/1 = 14 anúncios). Como isso dá a relação anúncio↔
   * campanha direto da fonte, vale mais do que deduzir item a item, e a mesma
   * varredura já serve pra contar os anúncios cadastrados de cada campanha.
   */
  const adsPorCampanha = new Map<string, number>();
  let diagRegistrado = 0;
  await Promise.all(Array.from(campanhas.keys()).map(async (cid) => {
    const advC = advDaCampanha.get(cid) ?? advOk; // campanha do anunciante certo
    const urls = (o: number) => [
      `${base(advC)}/campaigns/${cid}/ads/search?limit=50&offset=${o}`,
      `${base(advC)}/ads/search?filters[campaign_id]=${cid}&limit=50&offset=${o}`,
      `${base(advC)}/campaigns/${cid}/items/search?limit=50&offset=${o}`,
      `${legado(advC)}/items?filters[campaign_id]=${cid}&limit=50&offset=${o}`,
    ];
    // Registra o status do candidato que de fato funciona — sem isso, "o item
    // continua sem campanha" fica sem explicação nenhuma na tela.
    if (diagRegistrado < 2) {
      diagRegistrado += 1;
      try {
        const r = await get(urls(0)[1], token);
        tentativas.push({ url: `[anuncios] ${urls(0)[1].replace(ML_API, "")}`, status: r.status });
      } catch { /* segue pro buscar() abaixo mesmo assim */ }
    }
    const rows = await buscar(urls, token).catch(() => []);
    /**
     * Salvaguarda: se o candidato que respondeu ignorar o `filters[campaign_id]`
     * (aceita o parâmetro e devolve a conta inteira), o lote parece válido mas
     * atribuiria orçamento/ROAS de uma campanha aos anúncios de outra — foi
     * exatamente esse o bug de cruzamento cruzado de antes. Se qualquer linha
     * declarar um campaign_id diferente do pedido, o filtro mentiu e o lote
     * inteiro é descartado (em vez de assumir as primeiras linhas como certas).
     */
    for (const row of rows) {
      const cidNaLinha = texto(primeiro(row, ["campaign_id", "campaignId"]));
      if (cidNaLinha && cidNaLinha !== cid) return;
    }
    adsPorCampanha.set(cid, rows.length);
    for (const row of rows) {
      const mlb = itemIdDe(row);
      if (ehMlb(mlb)) itemToCampaign[mlb] = cid; // fonte direta vence o palpite das métricas
    }
  }));

  /**
   * 3) Sobrou anúncio sem campanha? Tenta o detalhe do anúncio isolado. Só
   * chega aqui quem a varredura por campanha não cobriu.
   */
  const faltam = new Set(mlbsUpper.filter((m) => !itemToCampaign[m]));
  if (faltam.size > 0) {
    let diagItemRegistrado = 0;
    await Promise.all(Array.from(faltam).map(async (mlb) => {
      for (const url of [
        ...todosAdvs.flatMap((a) => [`${base(a)}/ads/${mlb}`, `${base(a)}/items/${mlb}`, `${legado(a)}/items/${mlb}`]),
        `${ML_API}/advertising/product_ads/items/${mlb}`,
      ]) {
        try {
          const r = await get(url, token);
          if (diagItemRegistrado < 3) {
            diagItemRegistrado += 1;
            tentativas.push({ url: `[anuncio-solto] ${url.replace(ML_API, "")}`, status: r.status });
          }
          if (!r.ok) continue;
          const item = (await r.json()) as Record<string, unknown>;
          // Confere que a resposta é mesmo do item pedido, se ela disser quem é.
          const idNaResposta = texto(primeiro(item, ["item_id", "id"]));
          if (idNaResposta && idNaResposta.toUpperCase() !== mlb) continue;
          const cid = texto(primeiro(item, ["campaign_id", "campaignId"]) ?? (item.campaign as Record<string, unknown> | undefined)?.id);
          if (cid) { itemToCampaign[mlb] = cid; return; }
        } catch { /* tenta a próxima */ }
      }
    }));
  }

  /**
   * 4) Campanha órfã: o anúncio DECLARA um campaign_id, mas esse id não veio na
   * lista do `/campaigns/search`. Aconteceu de verdade — 3 anúncios gastando
   * R$ 86,44 apontavam pra campanha 352947089, ausente da lista de 10, no mesmo
   * anunciante. Rotular isso como "sem campanha" é falso: o anúncio tem
   * campanha, nós é que não a carregamos. Aqui buscamos cada órfã pelo id; se
   * vier, entra na lista como qualquer outra. O objeto cru da primeira
   * recuperada vai pro diagnóstico — comparando com uma campanha normal fica
   * visível qual campo (status, channel, etc.) explica a ausência na busca.
   */
  const orfasIniciais = Array.from(new Set(
    mlbsUpper.map((m) => itemToCampaign[m]).filter((cid): cid is string => !!cid && !campanhas.has(cid)),
  ));
  let amostraCampanhaOrfa: unknown = null;
  for (const cid of orfasIniciais) {
    for (const url of [
      `${base(advOk)}/campaigns/search?filters[campaign_id]=${cid}&limit=10&offset=0`,
      `${base(advOk)}/campaigns/${cid}`,
      `${legado(advOk)}/campaigns/${cid}`,
    ]) {
      try {
        const r = await get(url, token);
        tentativas.push({ url: `[campanha-orfa] ${url.replace(ML_API, "")}`, status: r.status });
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
        if (!j || typeof j !== "object") continue;
        // Aceita tanto lista quanto objeto solto, mas só se o id bater — uma
        // busca que ignora o filtro devolveria a campanha errada.
        const obj = j as Record<string, unknown>;
        const bruto = extrairLinhas(j).find((l) => texto(primeiro(l, ["id", "campaign_id"])) === cid)
          ?? (texto(primeiro(obj, ["id", "campaign_id"])) === cid ? obj : null);
        if (!bruto) continue;
        if (!amostraCampanhaOrfa) amostraCampanhaOrfa = bruto;
        campanhas.set(cid, campanhaDe(cid, bruto));
        advDaCampanha.set(cid, advOk);
        break;
      } catch { /* tenta a próxima */ }
    }
  }

  /**
   * Só interessam campanhas que gastaram algo no período — o resto é ruído
   * (a conta pode ter dezenas de campanhas antigas/pausadas sem relação com
   * o que está rodando agora). Uma campanha só tem gasto>0 aqui se pelo menos
   * um dos NOSSOS anúncios nela também tiver, então isso nunca esconde um
   * anúncio que realmente gastou — só reclassifica como "sem campanha" quem
   * está numa campanha 100% zerada no período.
   */
  const gastoPorCampanha = new Map<string, number>();
  for (const mlb of mlbsUpper) {
    const cid = itemToCampaign[mlb];
    if (!cid) continue;
    gastoPorCampanha.set(cid, (gastoPorCampanha.get(cid) ?? 0) + (costByItem[mlb] ?? 0));
  }
  const campanhasComGasto = new Set(Array.from(gastoPorCampanha.entries()).filter(([, v]) => v > 0).map(([k]) => k));

  for (const mlb of mlbsUpper) {
    const cid = itemToCampaign[mlb] ?? "";
    const info = cid && campanhasComGasto.has(cid) ? campanhas.get(cid) : undefined;
    porItem[mlb] = info
      ? { ...info, itemId: mlb }
      : {
          itemId: mlb,
          // Guarda o id quando SABEMOS a campanha mas não conseguimos carregar a
          // config dela — dizer "sem campanha" nesse caso seria mentira. Campanha
          // conhecida porém zerada no período continua caindo em "" (é o filtro
          // de ruído de propósito).
          campaignId: cid && !campanhas.has(cid) ? cid : "",
          campaignName: "",
          dailyBudget: 0, acosTarget: 0, roasTarget: 0, strategy: "", status: "",
        };
  }

  // A varredura do passo 2 já contou os anúncios cadastrados de cada campanha
  // (sem filtro de data) — a tabela principal só enxerga quem teve atividade no
  // período, então esse total é o que responde "cadê os outros anúncios".
  const anunciosTotal = Array.from(adsPorCampanha.values()).reduce((s, n) => s + n, 0);
  // Se a conta tem campanha mas a contagem deu zero em tudo, o número não é
  // confiável (nenhuma URL candidata respondeu) — melhor avisar isso do que
  // mostrar "0 anúncios" como se fosse fato.
  const anunciosContagemFalhou = campanhas.size > 0 && anunciosTotal === 0;

  /**
   * Prestação de contas do investimento: todo real gasto no período tem que
   * cair em alguma campanha conhecida. O que não cai fica explícito aqui em vez
   * de sumir — foi assim que apareceu R$ 86,44 rotulado "sem campanha" enquanto
   * a soma das campanhas dava menos que o investimento total da tela.
   *
   * Dois casos diferentes, e a distinção importa:
   *  - órfão: o anúncio TEM campaign_id, mas essa campanha não veio na lista de
   *    campanhas do anunciante (lista incompleta, ou campanha de outro
   *    anunciante da mesma conta) → problema de cobertura da nossa busca;
   *  - sem vínculo: não achamos campanha nenhuma pro anúncio.
   */
  const campanhasOrfas = new Set<string>();
  let gastoOrfao = 0;
  let gastoSemVinculo = 0;
  for (const mlb of mlbsUpper) {
    const custo = costByItem[mlb] ?? 0;
    if (custo <= 0) continue;
    const cid = itemToCampaign[mlb];
    if (!cid) { gastoSemVinculo += custo; continue; }
    if (!campanhas.has(cid)) { campanhasOrfas.add(cid); gastoOrfao += custo; }
  }

  // Lista completa das campanhas da conta (mesmo as sem gasto), pra dar pra
  // conferir que nenhuma sumiu — a tabela principal continua só com quem
  // gastou, mas essa cobertura fica visível em algum lugar da tela.
  const campanhasResumo = Array.from(campanhas.values())
    .map((c) => ({
      id: c.campaignId, name: c.campaignName || c.campaignId,
      status: c.status, gasto: gastoPorCampanha.get(c.campaignId) ?? 0,
      totalAds: adsPorCampanha.get(c.campaignId) ?? 0,
    }))
    .sort((a, b) => b.gasto - a.gasto || a.name.localeCompare(b.name));

  return {
    porItem, amostraCampanha, tentativas,
    campanhasEncontradas: campanhasComGasto.size,
    campanhasTotal: campanhas.size,
    campanhasResumo,
    anunciosTotal,
    anunciosNoPeriodo: mlbsUpper.length,
    anunciosContagemFalhou,
    campanhasOrfas: Array.from(campanhasOrfas),
    gastoOrfao,
    gastoSemVinculo,
    amostraCampanhaOrfa,
  };
}

/** Diagnóstico: mostra o que cada rota respondeu, com um trecho do corpo. */
export async function probeAds(from: string, to: string): Promise<Record<string, unknown>> {
  try {
    const token = await getValidMlAccessToken();
    const advRes = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
      headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
      cache: "no-store",
    });
    const advBody = await advRes.json().catch(() => null);
    const advertisers = (advBody as { advertisers?: Advertiser[] })?.advertisers ?? [];
    const chosen = advertisers.find((a) => String(a?.site_id ?? "").toUpperCase() === "MLB") ?? advertisers[0];
    const advertiserId = chosen?.advertiser_id ?? null;
    const site = String(chosen?.site_id ?? "MLB").toUpperCase();

    const tentativas: Record<string, unknown>[] = [];
    if (advertiserId != null) {
      const adv: Adv = { id: String(advertiserId), siteId: site };
      const q = `date_from=${from}&date_to=${to}&metrics=cost&limit=3`;
      const alvos: { nome: string; url: string }[] = [
        { nome: "NOVO ads/search", url: `${base(adv)}/ads/search?${q}` },
        { nome: "NOVO items/search", url: `${base(adv)}/items/search?${q}` },
        { nome: "NOVO campaigns/search", url: `${base(adv)}/campaigns/search?${q}` },
        { nome: "antigo items", url: `${legado(adv)}/items?${q}` },
      ];
      for (const a of alvos) {
        try {
          const r = await get(a.url, token);
          tentativas.push({ tentativa: a.nome, status: r.status, body: (await r.text().catch(() => "")).slice(0, 220) });
        } catch (e) {
          tentativas.push({ tentativa: a.nome, erro: String(e).slice(0, 120) });
        }
      }
    }

    return {
      periodo: { from, to },
      advertisersStatus: advRes.status,
      advertisersCount: advertisers.length,
      advertiserId,
      advertiserSite: site,
      itemsStatus: (tentativas[0]?.status as number) ?? null,
      tentativas,
    };
  } catch (e) {
    return { error: String(e) };
  }
}
