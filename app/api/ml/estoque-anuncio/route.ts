import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getMlAccessToken } from "../token";

const ML_API = "https://api.mercadolibre.com";
export const maxDuration = 60;
const MAX_ANUNCIOS = 40;

/**
 * Acertar a QUANTIDADE DISPONÍVEL de anúncios das agências no Mercado Livre.
 *
 * Nas agências, o "em casa" do Dash é o que o anúncio declara (estoqueForaDoFull):
 * cada venda desconta sozinha no ML. Acertar o número aqui é o que deixa o Dash
 * e o ML sincronizados dali em diante.
 *
 * `modo: "simular"` só lê e diz o que mudaria. `modo: "aplicar"` (só o owner)
 * faz o PUT, relê o anúncio e confere. Anúncio do Full é recusado — lá quem
 * manda no estoque é o centro de distribuição, não o vendedor. Anúncio com
 * variações também (cada variação tem o seu estoque; não chuta a divisão).
 */
type Pedido = { mlb: string; quantidade: number };

const normMlb = (s: unknown) => {
  const up = String(s ?? "").trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
};

export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "editar_estoque" });
  if (gate instanceof NextResponse) return gate;
  const corpo = (await req.json().catch(() => null)) as { modo?: string; itens?: Pedido[]; motivo?: string } | null;
  const modo = corpo?.modo === "aplicar" ? "aplicar" : "simular";
  if (modo === "aplicar" && gate.papel !== "owner") {
    return NextResponse.json({ error: "forbidden", details: "Só o dono altera estoque de anúncio no Mercado Livre." }, { status: 403 });
  }
  const itens = (Array.isArray(corpo?.itens) ? corpo.itens : []).slice(0, MAX_ANUNCIOS)
    .map((i) => ({ mlb: normMlb(i?.mlb), quantidade: Math.trunc(Number(i?.quantidade)) }))
    .filter((i) => i.mlb && Number.isInteger(i.quantidade) && i.quantidade >= 0 && i.quantidade <= 99999);
  if (!itens.length) return NextResponse.json({ error: "sem_itens" }, { status: 400 });

  const token = await getMlAccessToken().catch(() => null);
  if (!token) return NextResponse.json({ error: "sem_token" }, { status: 400 });
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const ler = async (mlb: string) => {
    const r = await fetchML(`${ML_API}/items/${mlb}?attributes=id,title,available_quantity,status,shipping,variations`, { headers, cache: "no-store" }, { maxTentativas: 2 }).catch(() => null);
    if (!r || !r.ok) return null;
    return (await r.json()) as { id: string; title?: string; available_quantity?: number; status?: string; shipping?: { logistic_type?: string }; variations?: unknown[] };
  };

  const resultado: { mlb: string; titulo: string; antes: number | null; depois: number; acao: "alterar" | "ja-esta" | "recusado"; motivo?: string; resultado?: "ok" | "erro"; erro?: string }[] = [];
  for (const it of itens) {
    const item = await ler(it.mlb);
    if (!item) { resultado.push({ mlb: it.mlb, titulo: "", antes: null, depois: it.quantidade, acao: "recusado", motivo: "não consegui ler o anúncio no ML" }); continue; }
    const base = { mlb: it.mlb, titulo: String(item.title ?? ""), antes: Number(item.available_quantity ?? 0), depois: it.quantidade };
    if (String(item.shipping?.logistic_type ?? "") === "fulfillment") { resultado.push({ ...base, acao: "recusado", motivo: "anúncio do Full — o estoque é do centro de distribuição" }); continue; }
    if (Array.isArray(item.variations) && item.variations.length > 0) { resultado.push({ ...base, acao: "recusado", motivo: "anúncio com variações — acerte cada variação no ML" }); continue; }
    if (base.antes === it.quantidade) { resultado.push({ ...base, acao: "ja-esta" }); continue; }
    if (modo === "simular") { resultado.push({ ...base, acao: "alterar" }); continue; }

    const put = await fetchML(`${ML_API}/items/${it.mlb}`, {
      method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ available_quantity: it.quantidade }), cache: "no-store",
    }, { maxTentativas: 1 }).catch((e: unknown) => e);
    if (!(put instanceof Response) || !put.ok) {
      const det = put instanceof Response ? await put.text().catch(() => "") : "sem resposta";
      resultado.push({ ...base, acao: "alterar", resultado: "erro", erro: `o ML recusou: ${det.slice(0, 200)}` });
      continue;
    }
    const depois = await ler(it.mlb);
    const ok = depois != null && Number(depois.available_quantity) === it.quantidade;
    resultado.push({ ...base, acao: "alterar", resultado: ok ? "ok" : "erro", ...(ok ? {} : { erro: `o ML aceitou, mas o anúncio mostra ${depois?.available_quantity ?? "?"}` }) });
    await getAdminDb().collection("auditLog").doc(`audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`).set({
      acao: "editar", entidade: "anuncio", entidadeId: it.mlb, entidadeLabel: base.titulo.slice(0, 80),
      detalhe: `estoque no ML: ${base.antes} → ${it.quantidade}${corpo?.motivo ? ` (${String(corpo.motivo).slice(0, 120)})` : ""}`,
      por: gate.email, em: Date.now(),
    }).catch(() => {});
  }
  return NextResponse.json({ modo, anuncios: resultado }, { headers: { "Cache-Control": "private, no-store" } });
}
