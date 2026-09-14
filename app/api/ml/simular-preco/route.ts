import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { impostoNaData, custoNaData, type CustoFaixa, type ImpostoFaixa } from "@/lib/domain/types";
import { precoParaMargem, simularPreco } from "@/lib/domain/preco-simulacao";

const ML_API = "https://api.mercadolibre.com";
export const maxDuration = 30;

/**
 * Taxas REAIS do Mercado Livre para um preço hipotético.
 *
 * ─── POR QUE CONSULTAR A API, E NÃO CALCULAR ────────────────────────────
 *
 * Medido contra a conta real (categoria MLB247522, anúncio Clássico):
 *   preço  78,99 → comissão 11,06  (14%)
 *   preço 250,00 → comissão 27,50  (11%)
 * A alíquota CAI em preços altos. E `fixed_fee` nessa categoria é ZERO — a
 * taxa fixa de item barato que existe em outras categorias não se aplica.
 *
 * Ou seja: nem a % nem a taxa fixa podem ser hardcodadas. Uma calculadora que
 * "estima" a comissão erra justamente onde a decisão importa, e erra em
 * silêncio. Por isso `/sites/MLB/listing_prices` é consultado PARA CADA preço
 * simulado, e o frete vem de `shipping_options` do próprio anúncio.
 */

type Item = {
  id: string; title: string; price: number;
  category_id: string; listing_type_id: string;
  shipping?: { logistic_type?: string; mode?: string; free_shipping?: boolean };
};

/** Comissão do ML para um preço específico. Lança em falha — nunca devolve 0 como se fosse real. */
async function buscarComissao(
  token: string, categoria: string, listingType: string, preco: number,
): Promise<{ valor: number; percentual: number; fixa: number }> {
  const u = `${ML_API}/sites/MLB/listing_prices?price=${preco}&category_id=${categoria}&listing_type_id=${listingType}`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`listing_prices_falhou_${r.status}`);
  const j = (await r.json()) as { sale_fee_amount?: number; sale_fee_details?: { percentage_fee?: number; fixed_fee?: number } };
  return {
    valor: Number(j.sale_fee_amount ?? 0),
    percentual: Number(j.sale_fee_details?.percentage_fee ?? 0),
    fixa: Number(j.sale_fee_details?.fixed_fee ?? 0),
  };
}

/**
 * Frete que o VENDEDOR paga neste anúncio. `list_cost` é o custo do vendedor;
 * `cost` é o que o comprador paga (0 = frete grátis, e aí o custo é todo seu).
 *
 * Best-effort: se o ML não responder, devolve null — e a resposta marca
 * `freteIndisponivel`, pra tela dizer que o número está incompleto em vez de
 * mostrar um lucro otimista com frete zero.
 */
async function buscarFrete(token: string, mlb: string, preco: number, cep: string): Promise<number | null> {
  try {
    const r = await fetch(`${ML_API}/items/${mlb}/shipping_options?zip_code=${cep}&price=${preco}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { options?: { cost?: number; list_cost?: number }[] };
    const o = (j.options ?? [])[0];
    if (!o) return null;
    // Comprador paga (cost > 0) → o vendedor não arca com o frete.
    return Number(o.cost ?? 0) > 0 ? 0 : Number(o.list_cost ?? 0);
  } catch {
    return null;
  }
}

const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_financeiro" });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const mlb = String(url.searchParams.get("mlb") ?? "").trim().toUpperCase();
    const precoParam = Number(url.searchParams.get("preco") ?? 0);
    // CEP de referência do frete. São Paulo capital por padrão — o custo varia
    // por destino, então a tela deixa claro qual CEP foi usado.
    const cep = String(url.searchParams.get("cep") ?? "01001000").replace(/\D/g, "") || "01001000";
    const margemAlvo = Number(url.searchParams.get("margemAlvo") ?? 0);

    if (!/^MLB\d+$/.test(mlb)) {
      return NextResponse.json({ error: "mlb_invalido" }, { status: 400 });
    }

    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem_token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

    // ── Anúncio: categoria e tipo definem a comissão ──
    const rItem = await fetch(
      `${ML_API}/items/${mlb}?attributes=id,title,price,category_id,listing_type_id,shipping`,
      { headers, cache: "no-store" },
    );
    if (!rItem.ok) return NextResponse.json({ error: "anuncio_nao_encontrado" }, { status: 404 });
    const item = (await rItem.json()) as Item;

    // Sem preço informado, simula o preço ATUAL do anúncio — assim a tela abre
    // já mostrando a situação de hoje, que é a referência pra comparar.
    const preco = precoParam > 0 ? precoParam : Number(item.price ?? 0);
    if (!(preco > 0)) return NextResponse.json({ error: "preco_invalido" }, { status: 400 });

    // ── Custo e imposto do produto cadastrado ──
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const prodSnap = await getAdminDb().collection("estoque").get();
    let custo = 0;
    let impostoPct = 0;
    let produtoNome = "";
    let produtoVinculado = false;
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      const casa = mlbs.some((m) => normId(String(m)) === normId(mlb));
      if (!casa) continue;
      const prod = {
        custo: String(d.custo ?? "0"),
        custoMedio: d.custoMedio,
        custoMedioFaixas: Array.isArray(d.custoMedioFaixas) ? (d.custoMedioFaixas as CustoFaixa[]) : undefined,
        imposto: d.imposto,
        impostoFaixas: Array.isArray(d.impostoFaixas) ? (d.impostoFaixas as ImpostoFaixa[]) : undefined,
      };
      // MESMAS funções de vigência que o Dashboard usa — se divergisse, a
      // simulação prometeria um lucro que os Pedidos depois não confirmariam.
      custo = custoNaData(prod, hoje);
      impostoPct = impostoNaData(prod, hoje);
      produtoNome = String(d.name ?? "");
      produtoVinculado = true;
      break;
    }

    // ── Taxas reais para ESTE preço ──
    const comissao = await buscarComissao(token, item.category_id, item.listing_type_id, preco);
    const freteBruto = await buscarFrete(token, mlb, preco, cep);
    const freteIndisponivel = freteBruto == null;
    const frete = freteBruto ?? 0;

    const adsPorUnidade = Number(url.searchParams.get("ads") ?? 0) || 0;
    const outrosPorUnidade = Number(url.searchParams.get("outros") ?? 0) || 0;
    const impostoUsado = url.searchParams.has("imposto") ? Number(url.searchParams.get("imposto")) : impostoPct;

    const baseSim = { frete, custo, impostoPct: impostoUsado, adsPorUnidade, outrosPorUnidade };
    const resultado = simularPreco({ ...baseSim, preco, comissao: comissao.valor });

    // ── Preço-alvo para uma margem desejada (opcional) ──
    // Cache por preço arredondado: a busca binária faria ~40 chamadas à API
    // sem isso, e o ML aplica rate limit.
    let precoSugerido: number | null = null;
    if (margemAlvo > 0) {
      const cache = new Map<string, number>();
      precoSugerido = await precoParaMargem(margemAlvo, baseSim, async (p) => {
        const k = p.toFixed(2);
        const hit = cache.get(k);
        if (hit != null) return hit;
        const c = await buscarComissao(token, item.category_id, item.listing_type_id, Number(k));
        cache.set(k, c.valor);
        return c.valor;
      }, { min: Math.max(custo, 1), max: Math.max(custo * 20, 5000), iteracoes: 18 });
    }

    return NextResponse.json({
      anuncio: {
        mlb: item.id, titulo: item.title, precoAtual: Number(item.price ?? 0),
        categoria: item.category_id,
        tipoAnuncio: item.listing_type_id,
        logistica: item.shipping?.logistic_type ?? "",
      },
      produto: { nome: produtoNome, vinculado: produtoVinculado, custo, impostoPct },
      taxas: {
        comissaoPercentual: comissao.percentual,
        comissaoFixa: comissao.fixa,
        cepFrete: cep,
        freteIndisponivel,
      },
      simulacao: resultado,
      precoSugerido,
      margemAlvo: margemAlvo > 0 ? margemAlvo : null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "simulacao_falhou", details: msg }, { status: 500 });
  }
}
