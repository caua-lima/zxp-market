import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { readShippingCosts } from "@/lib/ml/orders";

const ML_API = "https://api.mercadolibre.com";
const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

export const maxDuration = 30;

// cache curto por lambda quente (evita bater no ML a cada abertura da aba)
let cache: { at: number; dias: number; body: Record<string, unknown> } | null = null;
const CACHE_TTL = 60 * 1000;

function normalizeItemId(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}
function normalizeSku(s: string): string {
  return s.trim().toLowerCase();
}

/** Vendas (unidades) por produto nos últimos N dias → média diária p/ previsão. */
export async function GET(req: Request) {
  // Somente leitura, e o resumo diário usa isto pra contar produtos em risco — sem
  // `allowCron` a chamada interna leva 401 e o aviso morre calado.
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const dias = Math.max(1, Math.min(180, Number(url.searchParams.get("dias") ?? 30) || 30));

    if (cache && cache.dias === dias && Date.now() - cache.at < CACHE_TTL) {
      return NextResponse.json({ ...cache.body, cached: true });
    }

    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token", vendas: {}, dias }, { status: 200 });

    const db = getAdminDb();

    // Mapa MLB/SKU → productId
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, string>();
    const porSku = new Map<string, string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const id = String(d.id ?? doc.id);
      const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of mlbs) { const n = normalizeItemId(String(m)); if (n) porMlb.set(n, id); }
      if (d.sku) porSku.set(normalizeSku(String(d.sku)), id);
    }

    // Janela em horário de Brasília
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const to = new Date(Date.UTC(brNow.getUTCFullYear(), brNow.getUTCMonth(), brNow.getUTCDate()));
    const from = new Date(to.getTime() - (dias - 1) * 86400000);
    const iso = (d: Date, end = false) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${end ? "23:59:59.999" : "00:00:00.000"}-03:00`;
    const fromISO = iso(from);
    const toISO = iso(to, true);

    /**
     * ── Taxas REAIS por produto, medidas nas vendas que já aconteceram ──
     *
     * O lucro projetado de um produto parado no estoque precisa de comissão e
     * frete, e nenhum dos dois é dedutível do cadastro: a alíquota do ML muda
     * com o preço e por categoria (medido: 14% a R$78,99 e 11% a R$250 no
     * MESMO anúncio — ver lib/domain/preco-simulacao.ts), e o frete depende de
     * quem paga. Estimar por fórmula erraria justamente onde a decisão pesa.
     *
     * Em vez de consultar listing_prices produto a produto (dezenas de
     * chamadas, e o ML aplica rate limit), medimos o que a conta de fato
     * pagou: `sale_fee` vem em cada order_item e o frete sai do cache que o
     * sync já grava. Produto SEM venda no período fica de fora do mapa — a
     * tela mostra "—", nunca um lucro inventado.
     */
    const financeiro: Record<string, { receita: number; taxaML: number; frete: number; unidades: number }> = {};
    const acumular = (pid: string, campo: "receita" | "taxaML" | "frete" | "unidades", v: number) => {
      const atual = financeiro[pid] ?? { receita: 0, taxaML: 0, frete: 0, unidades: 0 };
      atual[campo] += v;
      financeiro[pid] = atual;
    };
    /** order_id → produtos e unidades daquele pedido, pra ratear o frete depois. */
    const rateioFrete: { orderId: string; porProduto: Map<string, number>; totalUnidades: number }[] = [];

    // Pedidos do período (paginado). Cancelados/inválidos não contam como venda.
    const vendas: Record<string, number> = {};
    /**
     * Separação de envio (o ML cancela o pedido e cria outros no mesmo pacote)
     * já sai certo aqui SEM tratamento especial: o original vem com status
     * "cancelled" e é pulado logo abaixo, e os pedidos novos contam. Só as
     * rotas que somam o faturamento BRUTO precisam de detectarPedidosSubstituidos.
     */
    let offset = 0;
    while (true) {
      const u =
        `${ML_API}/orders/search?seller=${SELLER_ID}` +
        `&order.date_created.from=${encodeURIComponent(fromISO)}` +
        `&order.date_created.to=${encodeURIComponent(toISO)}` +
        `&limit=50&offset=${offset}`;
      const res = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) break;
      const data = (await res.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
      const results = data.results ?? [];
      for (const o of results) {
        const status = String(o.status ?? "").toLowerCase();
        if (status === "cancelled" || status === "invalid") continue;
        const items = (o.order_items as Record<string, unknown>[]) ?? [];
        const porProduto = new Map<string, number>();
        let totalUnidades = 0;
        for (const it of items) {
          const item = (it.item as Record<string, unknown>) ?? {};
          const mlbNum = normalizeItemId(String(item.id ?? ""));
          const sku = normalizeSku(String(item.seller_sku ?? ""));
          const qty = Number(it.quantity ?? 0) || 0;
          totalUnidades += qty;
          const pid = porMlb.get(mlbNum) ?? porSku.get(sku);
          if (!pid) continue;
          vendas[pid] = (vendas[pid] ?? 0) + qty;
          // sale_fee é POR UNIDADE (mesma leitura de app/api/ml/metrics/route.ts).
          acumular(pid, "receita", Number(it.unit_price ?? 0) * qty);
          acumular(pid, "taxaML", Number(it.sale_fee ?? 0) * qty);
          acumular(pid, "unidades", qty);
          porProduto.set(pid, (porProduto.get(pid) ?? 0) + qty);
        }
        if (porProduto.size > 0) {
          rateioFrete.push({ orderId: String(o.id ?? ""), porProduto, totalUnidades });
        }
      }
      const totalPag = data.paging?.total ?? 0;
      offset += results.length;
      if (offset >= totalPag || results.length === 0) break;
    }

    /**
     * Frete por produto: `shipping_cost` é do PEDIDO, então rateia por unidade
     * (mesma regra de metrics/route.ts, pra simulação e realizado não
     * divergirem). Vem do cache que o sync grava — a busca de pedidos não
     * traz o custo de envio.
     */
    const custosFrete = await readShippingCosts(db, rateioFrete.map((r) => r.orderId));
    for (const { orderId, porProduto, totalUnidades } of rateioFrete) {
      const frete = custosFrete.get(orderId) ?? 0;
      if (frete <= 0 || totalUnidades <= 0) continue;
      const porUnidade = frete / totalUnidades;
      for (const [pid, qty] of porProduto) acumular(pid, "frete", porUnidade * qty);
    }

    /**
     * ─── DIAS EM QUE O PRODUTO ESTEVE À VENDA ───────────────────────────
     *
     * Dividir as vendas pela janela inteira subestima quem ficou pausado.
     * Um anúncio ativo só 10 dos 30 dias e que vendeu 20 unidades vende 2
     * por dia, não 0,67 — e comprar pela média errada garante ruptura.
     *
     * O sinal vem de /items/{id}/visits/time_window. Medido na conta: a API
     * NÃO devolve dias com zero, ela os omite. Anúncio ativo apareceu com
     * 24 a 30 dias na janela; pausado, com 8 a 22. Ou seja, dia ausente é
     * dia em que o anúncio não foi visto.
     *
     * União entre os anúncios do produto, não soma: se QUALQUER anúncio dele
     * estava vivo naquele dia, o produto era vendável naquele dia. Somar
     * contaria o mesmo dia várias vezes e inflaria a base.
     *
     * ─── LIMITE CONHECIDO, E POR QUE ELE É ACEITÁVEL ────────────────────
     *
     * Anúncio ATIVO que não recebeu nenhuma visita num dia também some da
     * lista, e vira "dia inativo" aqui. Isso encurta a base e AUMENTA a
     * média diária — ou seja, erra pedindo estoque a mais. Num cálculo cujo
     * objetivo é não deixar o Full zerar, esse é o lado seguro do erro.
     *
     * A tela mostra a base usada em cada linha, pra a conta não depender de
     * fé.
     */
    const diasAtivos: Record<string, number> = {};
    try {
      const diasPorProduto = new Map<string, Set<string>>();
      const mlbsUnicos = [...porMlb.keys()];
      for (const mlbNum of mlbsUnicos) {
        const pid = porMlb.get(mlbNum);
        if (!pid) continue;
        try {
          const r = await fetch(
            `${ML_API}/items/MLB${mlbNum}/visits/time_window?last=${dias}&unit=day`,
            { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
          );
          if (!r.ok) continue;
          const j = (await r.json()) as { results?: { date?: string; total?: number }[] };
          const set = diasPorProduto.get(pid) ?? new Set<string>();
          for (const p of j.results ?? []) {
            if (Number(p?.total ?? 0) > 0 && p?.date) set.add(String(p.date).slice(0, 10));
          }
          diasPorProduto.set(pid, set);
        } catch {
          // Um anúncio que falhe não pode derrubar o forecast inteiro: o
          // produto cai no fallback da janela cheia, que é o comportamento
          // de antes desta feature.
        }
      }
      for (const [pid, set] of diasPorProduto) if (set.size > 0) diasAtivos[pid] = set.size;
    } catch {
      // Sem visitas, `diasAtivos` fica vazio e quem consome usa a janela.
    }

    const body = { vendas, financeiro, diasAtivos, dias, from: fromISO.slice(0, 10), to: toISO.slice(0, 10) };
    cache = { at: Date.now(), dias, body };
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "forecast_failed", details: msg, vendas: {}, dias: 30 }, { status: 500 });
  }
}
