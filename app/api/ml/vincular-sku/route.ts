import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { SELLER_ID } from "@/lib/ml/orders";

const ML_API = "https://api.mercadolibre.com";
export const maxDuration = 60;

function normMlb(s: string) {
  const up = String(s).trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
}
function normSku(s: string) {
  return String(s).trim().toLowerCase();
}

/**
 * Chave frouxa para casar SKU escrito de formas diferentes nos dois lados.
 * No ML é comum o valor vir com o próprio prefixo ("SKU MentaCereja"), e
 * acento/espaço/hífen variam ("Limão Caipira" × "LimaoCaipira"). Só é usada
 * como sugestão marcada como aproximada — nunca como certeza.
 */
function chaveSku(s: string) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")    // tira acento
    .replace(/^sku[\s:_.-]*/, "")                        // tira prefixo "SKU "
    .replace(/[^a-z0-9]/g, "");                          // tira separadores
}

/** SKUs de um anúncio: raiz, atributo SELLER_SKU e cada variação. */
function skusDoItem(b: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => { const s = normSku(String(v ?? "")); if (s) out.add(s); };
  push(b.seller_custom_field);
  for (const a of (b.attributes ?? []) as { id?: string; value_name?: string }[]) {
    if (String(a?.id) === "SELLER_SKU") push(a?.value_name);
  }
  for (const v of (b.variations ?? []) as Record<string, unknown>[]) {
    push(v.seller_custom_field);
    for (const a of (v.attributes ?? []) as { id?: string; value_name?: string }[]) {
      if (String(a?.id) === "SELLER_SKU") push(a?.value_name);
    }
  }
  return Array.from(out);
}

/**
 * Monta o plano de vínculo produto → anúncio pelo SKU. Não grava nada: devolve
 * o que casaria, e a tela aplica com a confirmação do dono. A escrita fica no
 * cliente (owner) para não abrir caminho de escrita no servidor.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "editar_estoque" });
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const db = getAdminDb();

    // Produtos cadastrados, com o SKU e os anúncios que já têm.
    const prodSnap = await db.collection("estoque").get();
    type Prod = { id: string; name: string; sku: string; mlbs: Set<string> };
    const produtos: Prod[] = [];
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const mlbs = new Set<string>();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) { const n = normMlb(m); if (n) mlbs.add(n); }
      produtos.push({ id: doc.id, name: String(d.name ?? ""), sku: normSku(String(d.sku ?? "")), mlbs });
    }

    // Todos os anúncios do vendedor.
    const todosMlb: string[] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const res = await fetch(`${ML_API}/users/${SELLER_ID}/items/search?limit=100&offset=${offset}`, { headers, cache: "no-store" });
      if (!res.ok) break;
      const j = (await res.json()) as { results?: string[] };
      const lote = j.results ?? [];
      for (const m of lote) { const n = normMlb(m); if (n) todosMlb.push(n); }
      if (lote.length < 100) break;
    }

    // SKU → anúncios que o expõem (raiz ou variação), no valor exato e na
    // chave frouxa. Guardamos o SKU cru do anúncio para mostrar na conferência.
    const mlbsPorSku = new Map<string, Set<string>>();
    const mlbsPorChave = new Map<string, Set<string>>();
    const skuDoMlb = new Map<string, string>();
    const tituloPorMlb = new Map<string, string>();
    let anunciosLidos = 0;
    for (let i = 0; i < todosMlb.length; i += 20) {
      const chunk = todosMlb.slice(i, i + 20);
      const res = await fetch(
        `${ML_API}/items?ids=${chunk.join(",")}&attributes=id,title,seller_custom_field,attributes,variations,status`,
        { headers, cache: "no-store" },
      );
      if (!res.ok) continue;
      const rows = (await res.json()) as { body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b) continue;
        const mlb = normMlb(String(b.id ?? ""));
        if (!mlb) continue;
        anunciosLidos += 1;
        tituloPorMlb.set(mlb, String(b.title ?? ""));
        for (const sku of skusDoItem(b)) {
          const set = mlbsPorSku.get(sku) ?? new Set<string>();
          set.add(mlb);
          mlbsPorSku.set(sku, set);

          const chave = chaveSku(sku);
          if (chave) {
            const setC = mlbsPorChave.get(chave) ?? new Set<string>();
            setC.add(mlb);
            mlbsPorChave.set(chave, setC);
          }
          if (!skuDoMlb.has(mlb)) skuDoMlb.set(mlb, sku);
        }
      }
    }

    /**
     * Plano por produto. O casamento exato é confiável; o aproximado sai
     * marcado, porque prefixo/acento removidos podem aproximar SKUs que na
     * verdade são de produtos distintos — quem decide é quem confere.
     */
    type Novo = { mlb: string; titulo: string; skuAnuncio: string; exato: boolean };
    const plano: {
      productId: string; name: string; sku: string;
      atuais: { mlb: string; titulo: string }[];
      novos: Novo[];
    }[] = [];
    let semSku = 0;
    let semMatch = 0;
    let aproximados = 0;

    for (const p of produtos) {
      if (!p.sku) { semSku += 1; continue; }

      const exatos = mlbsPorSku.get(p.sku) ?? new Set<string>();
      const frouxos = mlbsPorChave.get(chaveSku(p.sku)) ?? new Set<string>();
      if (exatos.size === 0 && frouxos.size === 0) { semMatch += 1; continue; }

      const novos: Novo[] = [];
      for (const mlb of new Set([...exatos, ...frouxos])) {
        if (p.mlbs.has(mlb)) continue;
        const exato = exatos.has(mlb);
        if (!exato) aproximados += 1;
        novos.push({ mlb, titulo: tituloPorMlb.get(mlb) ?? "", skuAnuncio: skuDoMlb.get(mlb) ?? "", exato });
      }
      if (!novos.length) continue;

      novos.sort((a, b) => Number(b.exato) - Number(a.exato));
      plano.push({
        productId: p.id,
        name: p.name,
        sku: p.sku,
        // Mostrar o que já está vinculado é o que permite julgar se o
        // anúncio sugerido é outro de verdade ou duplicata.
        atuais: Array.from(p.mlbs).map((mlb) => ({ mlb, titulo: tituloPorMlb.get(mlb) ?? "" })),
        novos,
      });
    }
    plano.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      plano,
      resumo: {
        produtos: produtos.length,
        anunciosDaConta: todosMlb.length,
        anunciosLidos,
        semSku,
        semMatch,
        aproximados,
        aVincular: plano.reduce((s, p) => s + p.novos.length, 0),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "vincular_sku_failed", details: msg }, { status: 500 });
  }
}
