import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { fetchML } from "@/lib/ml/fetch-ml";
import { sellerIdAtual } from "@/lib/ml/vendedor";
import { conferirSkuNoAnuncio, explicarErroDoMl, planejarSkuNoAnuncio, type ItemML, type PlanoDoAnuncio } from "@/lib/domain/sku-ml";
import { getMlAccessToken } from "../token";

const ML_API = "https://api.mercadolibre.com";
export const maxDuration = 60;

/**
 * Trocar o SKU no app E no anúncio do Mercado Livre — uma vez só.
 *
 * `modo: "simular"` não escreve nada: diz, anúncio por anúncio, o que mudaria
 * (e o que fica de fora, e por quê). `modo: "aplicar"` faz o PUT, relê o anúncio
 * e confere se ficou certo — "salvo" sem conferir não vale aqui.
 *
 * Quais anúncios: os ligados ao produto (mlbs) e os que o ML encontra com o SKU
 * antigo (`items/search?seller_sku=` e o `?sku=` do campo antigo). A decisão do
 * que mandar em cada um mora em lib/domain/sku-ml.ts, com teste.
 *
 * Simular: quem edita estoque. Aplicar: só o dono — é escrita no anúncio da
 * conta, visível pro comprador e fora do alcance de "desfazer" do app.
 */

type Pedido = { productId: string; skuAntigo: string; skuNovo: string };
type ResultadoDoAnuncio = (PlanoDoAnuncio extends infer P ? P : never) & {
  resultado?: "ok" | "erro";
  erro?: string;
};

const MAX_PRODUTOS = 30;

function normMlb(s: unknown): string {
  const up = String(s ?? "").trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "editar_estoque" });
  if (gate instanceof NextResponse) return gate;

  let corpo: { modo?: string; itens?: Pedido[] };
  try { corpo = await req.json(); } catch { return NextResponse.json({ error: "corpo_invalido" }, { status: 400 }); }
  const modo = corpo.modo === "aplicar" ? "aplicar" : "simular";
  const itens = Array.isArray(corpo.itens) ? corpo.itens.slice(0, MAX_PRODUTOS) : [];
  if (itens.length === 0) return NextResponse.json({ error: "sem_itens" }, { status: 400 });
  if (modo === "aplicar" && gate.papel !== "owner") {
    return NextResponse.json({ error: "forbidden", details: "Só o dono altera os anúncios no Mercado Livre." }, { status: 403 });
  }

  const token = await getMlAccessToken().catch(() => null);
  if (!token) return NextResponse.json({ error: "sem_token", details: "Conecte a conta do Mercado Livre." }, { status: 400 });
  const ler = { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" as const };
  const seller = await sellerIdAtual();
  const db = getAdminDb();

  /** O anúncio inteiro, COM os atributos das variações (é onde o SKU de cada uma mora). */
  const lerItem = async (mlb: string): Promise<ItemML | null> => {
    const r = await fetchML(`${ML_API}/items/${mlb}?include_attributes=all`, ler).catch(() => null);
    if (!r || !r.ok) return null;
    return (await r.json()) as ItemML;
  };
  const buscarPorSku = async (param: "seller_sku" | "sku", sku: string): Promise<string[]> => {
    const r = await fetchML(`${ML_API}/users/${seller}/items/search?${param}=${encodeURIComponent(sku)}&limit=50`, ler).catch(() => null);
    if (!r || !r.ok) return [];
    const j = (await r.json()) as { results?: string[] };
    return (j.results ?? []).map(normMlb).filter(Boolean);
  };

  const saida: { productId: string; nome: string; skuAntigo: string; skuNovo: string; anuncios: ResultadoDoAnuncio[]; aviso?: string }[] = [];

  for (const it of itens) {
    const productId = String(it?.productId ?? "");
    const skuAntigo = String(it?.skuAntigo ?? "").trim();
    const skuNovo = String(it?.skuNovo ?? "").trim();
    if (!productId || !skuNovo) continue;

    const doc = await db.collection("estoque").doc(productId).get();
    if (!doc.exists) { saida.push({ productId, nome: productId, skuAntigo, skuNovo, anuncios: [], aviso: "Produto não encontrado." }); continue; }
    const d = doc.data() ?? {};
    const nome = String(d.name ?? productId);
    const ligados: string[] = (Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [d.mlb] : []).map(normMlb).filter(Boolean);

    const candidatos = new Set<string>(ligados);
    if (skuAntigo) {
      for (const m of await buscarPorSku("seller_sku", skuAntigo)) candidatos.add(m);
      for (const m of await buscarPorSku("sku", skuAntigo)) candidatos.add(m);
    }

    const anuncios: ResultadoDoAnuncio[] = [];
    for (const mlb of candidatos) {
      const item = await lerItem(mlb);
      if (!item) {
        anuncios.push({ acao: "nao-mexer", mlb, titulo: "", skuAtual: "", motivo: "Não consegui ler o anúncio no Mercado Livre agora." });
        continue;
      }
      const plano = planejarSkuNoAnuncio(item, skuAntigo, skuNovo);
      if (modo === "simular" || plano.acao !== "alterar") { anuncios.push(plano); continue; }

      // ── Aplicar: PUT, reler, conferir ──
      const put = await fetchML(`${ML_API}/items/${mlb}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(plano.corpo),
        cache: "no-store",
      }, { maxTentativas: 1 }).catch((e: unknown) => e);

      if (!(put instanceof Response)) {
        anuncios.push({ ...plano, resultado: "erro", erro: "Sem resposta do Mercado Livre. Simule de novo antes de repetir — a alteração pode ter entrado." });
        continue;
      }
      if (!put.ok) {
        anuncios.push({ ...plano, resultado: "erro", erro: explicarErroDoMl(put.status, await put.json().catch(() => null)) });
        continue;
      }
      const depois = await lerItem(mlb);
      const conf = depois ? conferirSkuNoAnuncio(depois, plano, skuNovo) : { ok: false as const, problema: "O ML aceitou, mas não consegui reler o anúncio pra conferir." };
      anuncios.push(conf.ok ? { ...plano, resultado: "ok" } : { ...plano, resultado: "erro", erro: conf.problema });

      // Rastro: o que mudou, onde e por quem. Secundário — a alteração já está feita.
      const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.collection("auditLog").doc(id).set({
        id, acao: "editar", entidade: "produto", entidadeId: productId, entidadeLabel: nome,
        detalhe: `SKU no Mercado Livre, anúncio ${mlb}: “${plano.skuAtual || "vazio"}” → “${skuNovo}”${conf.ok ? "" : ` (conferência falhou: ${conf.problema})`}`.slice(0, 500),
        por: gate.email, em: Date.now(),
      }).catch(() => {});
    }

    saida.push({
      productId, nome, skuAntigo, skuNovo, anuncios,
      ...(candidatos.size === 0 ? { aviso: "Nenhum anúncio ligado a este produto nem com o SKU antigo no Mercado Livre." } : {}),
    });
  }

  return NextResponse.json({ modo, produtos: saida });
}
