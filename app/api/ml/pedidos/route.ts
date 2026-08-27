import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { custoNaData, impostoNaData, type CustoFaixa, type ImpostoFaixa } from "@/lib/domain/types";
import { paraBR } from "@/lib/domain/tempo";

type ProdutoData = { custo: number; custoMedioFaixas?: CustoFaixa[]; imposto: number; impostoFaixas?: ImpostoFaixa[]; name: string };
type OrderItem = { sku?: string; item_id?: string; quantity?: number; unit_price?: number; sale_fee?: number; title?: string };

function normalizeSku(s: string) {
  return s.trim().toLowerCase();
}
function normalizeItemId(s: string) {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

function buildRange(from?: string | null, to?: string | null) {
  if (from && to) {
    return {
      start: `${from}T00:00:00.000Z`, end: `${to}T23:59:59.999Z`,
      startBR: `${from}T00:00:00.000-03:00`, endBR: `${to}T23:59:59.999-03:00`,
    };
  }
  const br = new Date(Date.now() - 3 * 3600 * 1000);
  const y = br.getUTCFullYear();
  const m = br.getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");
  const ld = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  return {
    start: `${y}-${mm}-01T00:00:00.000Z`, end: `${y}-${mm}-${ld}T23:59:59.999Z`,
    startBR: `${y}-${mm}-01T00:00:00.000-03:00`, endBR: `${y}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const { start, end, startBR, endBR } = buildRange(url.searchParams.get("from"), url.searchParams.get("to"));
    const db = getAdminDb();

    // Pedidos do período (dedupe UTC/BR)
    const [snapUTC, snapBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR])
      for (const doc of snap.docs) {
        const d = doc.data();
        ordersMap.set(d.order_id ?? doc.id, d);
      }

    // Cancelamentos/devoluções do período — mesma fonte e mesmo critério que
    // app/api/ml/metrics/route.ts usa pro Dashboard (não é cálculo novo, só
    // reaproveitado aqui pra marcar cada pedido).
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const cancelIds = new Set<string>();
    const devolIds = new Set<string>();
    for (const snap of [retUTC, retBR]) {
      for (const doc of snap.docs) {
        const r = doc.data();
        if (String(r.tipo ?? "") === "devolucao") devolIds.add(doc.id);
        else cancelIds.add(doc.id);
      }
    }

    /**
     * Compra com produtos diferentes vira um pacote: o comprador fez UMA venda,
     * mas a API devolve um pedido por produto. Sem juntar, cada linha mostrava
     * só parte da compra e o lucro real da venda não aparecia em lugar nenhum.
     */
    const porPacote = new Map<string, FirebaseFirestore.DocumentData[]>();
    for (const d of ordersMap.values()) {
      const chave = String(d.pack_id ?? "") || String(d.order_id ?? "");
      const arr = porPacote.get(chave) ?? [];
      arr.push(d);
      porPacote.set(chave, arr);
    }

    const orders: FirebaseFirestore.DocumentData[] = Array.from(porPacote.values()).map((grupo) => {
      // cancelado/devolvido e repasse do MP são checados ANTES do merge —
      // ml_returns e net_received são gravados por order_id ORIGINAL do ML,
      // não pelo pack_id que a linha exibida passa a usar.
      const algumCancelado = grupo.some((o) => cancelIds.has(String(o.order_id ?? "")));
      const algumDevolvido = grupo.some((o) => devolIds.has(String(o.order_id ?? "")));
      const netTotal = grupo.reduce((s, o) => s + Number(o.net_received ?? 0), 0);
      const releaseMax = grupo.reduce((s, o) => (String(o.money_release_date ?? "") > s ? String(o.money_release_date ?? "") : s), "");

      if (grupo.length === 1) {
        return {
          ...grupo[0], cancelado: algumCancelado, devolvido: algumDevolvido,
          net_received: netTotal, money_release_date: releaseMax,
        } as FirebaseFirestore.DocumentData;
      }
      // Mais antigo primeiro: a venda herda a data e o id do primeiro pedido.
      grupo.sort((a, b) => String(a.date_created ?? "").localeCompare(String(b.date_created ?? "")));
      const base = grupo[0];
      return {
        ...base,
        order_id: String(base.pack_id ?? base.order_id ?? ""),
        // O frete é do pacote inteiro; somar o de cada pedido contaria duplicado
        // quando o ML repete o valor. Usamos o maior informado no grupo.
        shipping_cost: grupo.reduce((s, o) => Math.max(s, Number(o.shipping_cost ?? 0)), 0),
        total_amount: grupo.reduce((s, o) => s + Number(o.total_amount ?? 0), 0),
        items: grupo.flatMap((o) => (o.items ?? []) as Record<string, unknown>[]),
        pedidosNoPacote: grupo.length,
        cancelado: algumCancelado,
        devolvido: algumDevolvido,
        net_received: netTotal,
        money_release_date: releaseMax,
      } as FirebaseFirestore.DocumentData;
    });

    // Índice de produtos
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = {
        // Custo médio ponderado (livro de movimentações do Estoque) tem
        // prioridade — é a MESMA fonte que app/api/ml/metrics/route.ts usa
        // pro Dashboard. Cair pro custo manual só quando ainda não há
        // custoMedio calculado (produto sem movimentação lançada ainda).
        custo: Number(d.custoMedio ?? d.custo ?? 0),
        custoMedioFaixas: Array.isArray(d.custoMedioFaixas) ? (d.custoMedioFaixas as CustoFaixa[]) : undefined,
        imposto: Number(d.imposto ?? 0),
        impostoFaixas: Array.isArray(d.impostoFaixas) ? (d.impostoFaixas as ImpostoFaixa[]) : undefined,
        name: String(d.name ?? ""),
      };
      const mlbList: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of mlbList) {
        const n = normalizeItemId(String(m));
        if (n) porMlb.set(n, entry);
      }
      const sku = String(d.sku ?? "").trim();
      if (sku) porSku.set(normalizeSku(sku), entry);
    }

    const pedidos = orders.map((o) => {
      // Alíquota da data da venda — mudar o imposto hoje não reescreve o
      // lucro de meses já fechados.
      // Também convertido: perto da meia-noite, fatiar podia jogar a venda
      // pro dia anterior e aplicar a alíquota/custo médio de outra vigência.
      const diaPedido = paraBR(String(o.date_created ?? ""))?.dia ?? "";
      const items = (o.items as OrderItem[]) ?? [];
      const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
      const orderShipping = Number(o.shipping_cost ?? 0);
      const envioPerUnit = totalUnits > 0 ? orderShipping / totalUnits : 0;

      let bruto = 0, cmv = 0, envio = 0, taxaML = 0, imposto = 0;
      let vinculado = true;
      const nomes: string[] = [];
      // Detalhe por item: um pedido pode ter mais de um produto. Sem isto, o
      // resumo "por produto" não teria como separar um pedido misto.
      const itens: {
        produto: string; mlb: string; qtd: number;
        valor: number; retorno: number; cmv: number; envio: number;
        taxaML: number; imposto: number; lucro: number; vinculado: boolean;
      }[] = [];

      for (const item of items) {
        const qty = Number(item.quantity ?? 1);
        const skuRaw = String(item.sku ?? "").trim();
        const itemId = String(item.item_id ?? "").trim();
        const ret = Number(item.unit_price ?? 0) * qty;
        const itTaxa = Number(item.sale_fee ?? 0) * qty;
        const itEnvio = envioPerUnit * qty;
        bruto += ret;
        taxaML += itTaxa;
        envio += itEnvio;

        const prod = porMlb.get(normalizeItemId(itemId)) ?? porSku.get(normalizeSku(skuRaw));
        const nome = prod?.name || String(item.title ?? skuRaw);
        const itCmv = prod ? custoNaData(prod, diaPedido) * qty : 0;
        const itImposto = prod ? ret * (impostoNaData(prod, diaPedido) / 100) : 0;
        if (prod) {
          cmv += itCmv;
          imposto += itImposto;
        } else {
          vinculado = false;
        }
        nomes.push(nome);

        // Mesma fórmula do pedido, aplicada ao item.
        const itRetorno = ret - itTaxa - itEnvio;
        itens.push({
          produto: nome,
          mlb: itemId.toUpperCase(),
          qtd: qty,
          valor: ret,
          retorno: itRetorno,
          cmv: itCmv,
          envio: itEnvio,
          taxaML: itTaxa,
          imposto: itImposto,
          lucro: itRetorno - itCmv - itImposto,
          vinculado: Boolean(prod),
        });
      }

      /**
       * ATENÇÃO À PALAVRA "RETORNO": aqui ela é LÍQUIDA (valor − taxa − frete),
       * e no Dashboard é BRUTA (preço × quantidade, com taxa e frete
       * descontados depois, separadamente).
       *
       * O LUCRO das duas telas é o mesmo — só a ordem das subtrações muda —
       * mas o número rotulado "retorno" não é, e comparar os dois lado a lado
       * dá a impressão de que uma das telas está errada. Um comentário antigo
       * aqui afirmava que eram iguais; não são.
       *
       * A margem também é a mesma nos dois lugares: lucro ÷ VALOR BRUTO.
       */
      const retorno = bruto - taxaML - envio;
      const lucro = retorno - cmv - imposto;
      const margem = bruto > 0 ? (lucro / bruto) * 100 : 0;

      // Link direto pro anúncio — best-effort: monta a URL padrão do ML a
      // partir do MLB do primeiro item (não vem da API, então pode não
      // resolver em casos raros de anúncio removido/alterado).
      const primeiroMlb = items[0]?.item_id?.trim().toUpperCase() ?? "";
      const linkAnuncio = /^MLB\d+$/.test(primeiroMlb)
        ? `https://produto.mercadolivre.com.br/${primeiroMlb.replace(/^MLB/, "MLB-")}`
        : null;

      return {
        order_id: String(o.order_id ?? ""),
        // Convertido, nao fatiado: o ML devolve o timestamp com o offset dele
        // (na pratica -04:00), e fatiar mostrava a venda das 13:01 como 12:01.
        // Ver lib/domain/tempo.ts.
        data: paraBR(String(o.date_created ?? ""))?.dia ?? "",
        hora: paraBR(String(o.date_created ?? ""))?.hora ?? "",
        status: String(o.status ?? ""),
        // Sem repetir nome quando o mesmo produto vem em mais de uma linha.
        produto: Array.from(new Set(nomes)).join(", "),
        qtd: totalUnits,
        valor: Number(o.total_amount ?? 0),
        bruto, retorno, cmv, envio, taxaML, imposto,
        lucro, margem, vinculado, itens,
        pedidosNoPacote: Number(o.pedidosNoPacote ?? 1),
        // Cancelamento/devolução (ver ml_returns acima).
        cancelado: Boolean(o.cancelado),
        devolvido: Boolean(o.devolvido),
        // Logística — já salva pelo sync (lib/ml/sync.ts), só repassada aqui.
        shippingStatus: String(o.shipping_status ?? ""),
        logisticType: String(o.logistic_type ?? ""),
        tracking: String(o.tracking ?? ""),
        estimatedDelivery: String(o.estimated_delivery ?? ""),
        dateDelivered: String(o.date_delivered ?? ""),
        // Repasse do Mercado Pago: net_received > 0 = valor CONFIRMADO pelo MP;
        // sem isso, "retorno" acima é a nossa ESTIMATIVA (mesma que o resto do app usa).
        netReceived: Number(o.net_received ?? 0) || null,
        moneyReleaseDate: String(o.money_release_date ?? "") || null,
        linkAnuncio,
      };
    });

    pedidos.sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));

    return NextResponse.json({ pedidos, count: pedidos.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "pedidos_failed", details: msg }, { status: 500 });
  }
}
