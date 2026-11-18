import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getMlAccessToken } from "@/app/api/ml/token";
import {
  gruposQueBatem, nomeDoGrupo, perguntaDeEstoque, respostaDeEstoque, resumirGrupo,
  type AnuncioConsulta, type ProdutoConsulta,
} from "@/lib/domain/estoque-consulta";

export const maxDuration = 30;
const ML_API = "https://api.mercadolibre.com";
const DIAS = 30;

/**
 * O chat de ajuda pergunta "quanto de estoque tenho do Menta Limão?" — aqui
 * sai a resposta com o número AO VIVO: o disponível dos anúncios (agências e
 * Full, direto do ML) e o ritmo de venda dos últimos 30 dias (a mesma conta
 * da previsão do Estoque, que fica em cache).
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const palavras = perguntaDeEstoque(url.searchParams.get("q") ?? "");
  if (!palavras) return NextResponse.json({ naoEhEstoque: true });

  const db = getAdminDb();
  const snap = await db.collection("estoque").get();
  const produtos: ProdutoConsulta[] = snap.docs.map((d) => {
    const p = d.data();
    const mlbs: string[] = Array.isArray(p.mlbs) && p.mlbs.length ? p.mlbs.map(String) : p.mlb ? [String(p.mlb)] : [];
    return { id: d.id, name: String(p.name ?? d.id), grupo: p.grupo ? String(p.grupo) : undefined, mlbs, ativo: p.ativo !== false };
  }).filter((p) => p.ativo);

  const grupos = gruposQueBatem(palavras, produtos).slice(0, 3);
  if (!grupos.length) {
    return NextResponse.json({ respostas: [`Não achei produto com "${palavras.join(" ")}". Tente o nome do sabor, ex.: "estoque do Menta Limão".`] });
  }

  // Disponível de cada anúncio, ao vivo.
  const mlbs = [...new Set(produtos.filter((p) => grupos.includes(nomeDoGrupo(p))).flatMap((p) => p.mlbs)
    .map((m) => (m.toUpperCase().startsWith("MLB") ? m.toUpperCase() : `MLB${m}`)))];
  const anuncios: Record<string, AnuncioConsulta> = {};
  const token = await getMlAccessToken().catch(() => null);
  if (!token) return NextResponse.json({ respostas: ["A conta do Mercado Livre está desconectada — sem ela não sei o estoque dos anúncios."] });
  for (let i = 0; i < mlbs.length; i += 20) {
    const r = await fetchML(`${ML_API}/items?ids=${mlbs.slice(i, i + 20).join(",")}&attributes=id,available_quantity,status,shipping,inventory_id`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
    }).catch(() => null);
    if (!r || !r.ok) continue;
    for (const row of (await r.json()) as { body?: Record<string, unknown> }[]) {
      const b = row?.body;
      if (!b?.id) continue;
      anuncios[String(b.id).toUpperCase()] = {
        available: Number(b.available_quantity ?? 0),
        logistic: String((b.shipping as Record<string, unknown> | undefined)?.logistic_type ?? ""),
        status: String(b.status ?? ""),
        inventoryId: String(b.inventory_id ?? ""),
      };
    }
  }

  // Ritmo de venda: a previsão do Estoque (mesma conta, em cache de 15 min).
  let vendas: Record<string, number> = {};
  try {
    const f = await fetch(new URL(`/api/ml/estoque-forecast?dias=${DIAS}`, req.url), {
      headers: { authorization: req.headers.get("authorization") ?? "" }, cache: "no-store",
    });
    if (f.ok) vendas = ((await f.json()) as { vendas?: Record<string, number> }).vendas ?? {};
  } catch { /* sem ritmo: a resposta diz que não sabe a cobertura */ }

  const respostas = grupos.map((g) => respostaDeEstoque(resumirGrupo(g, produtos, anuncios, vendas, DIAS)));
  return NextResponse.json({ respostas }, { headers: { "Cache-Control": "private, no-store" } });
}
