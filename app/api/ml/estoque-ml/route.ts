import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";

const ML_API = "https://api.mercadolibre.com";

function normId(s: string) {
  const up = String(s).trim().toUpperCase();
  if (!up) return "";
  return up.startsWith("MLB") ? up : `MLB${up}`;
}

/** Retorna a quantidade disponível (estoque) por anúncio MLB, ao vivo do ML. */
export async function GET(req: Request) {
  // Somente leitura, e o snapshot diário lê o estoque do ML daqui — sem
  // `allowCron` a chamada interna leva 401 e o aviso morre calado.
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const db = getAdminDb();

    // Coleta todos os MLBs cadastrados
    const prodSnap = await db.collection("estoque").get();
    const ids = new Set<string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) { const n = normId(m); if (n) ids.add(n); }
    }
    const arr = Array.from(ids);
    const estoque: Record<string, { available: number; sold: number; status: string; price: number; regularPrice: number; hasPromo: boolean; logistic: string; inventoryId: string }> = {};

    // Multi-get de 20 em 20 (preço de lista + original + logística p/ saber se é Full)
    //
    // `inventory_id` é o que identifica o POOL de estoque no Full. Dois
    // anúncios podem compartilhar o mesmo pool e cada um responde
    // available_quantity com o total do pool, não com uma fatia — sem este
    // campo não há como saber que são o mesmo estoque, e somar os dois dobra
    // o número (ver consolidarEstoqueAnuncios em lib/domain/estoque.ts).
    for (let i = 0; i < arr.length; i += 20) {
      const chunk = arr.slice(i, i + 20);
      const res = await fetch(
        `${ML_API}/items?ids=${chunk.join(",")}&attributes=id,available_quantity,sold_quantity,status,price,original_price,shipping,inventory_id`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" },
      );
      if (!res.ok) continue;
      const rows = (await res.json()) as { code?: number; body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b) continue;
        const id = String(b.id ?? "").toUpperCase();
        if (!id) continue;
        const base = Number(b.price ?? 0);
        const orig = Number(b.original_price ?? 0);
        const logistic = String((b.shipping as Record<string, unknown>)?.logistic_type ?? "");
        estoque[id] = {
          available: Number(b.available_quantity ?? 0),
          sold: Number(b.sold_quantity ?? 0),
          status: String(b.status ?? ""),
          price: base,
          regularPrice: orig > base ? orig : base,
          hasPromo: orig > base,
          logistic, // "fulfillment" = Full; outros = anúncio próprio
          // Vazio quando o ML não informa — nesse caso NÃO se deduplica nada
          // (melhor inflar visivelmente do que sumir com estoque em silêncio).
          inventoryId: String(b.inventory_id ?? ""),
        };
      }
    }

    // Preço REAL de venda (Central de Promoções / ofertas): endpoint sale_price.
    // O `price` de lista nem sempre reflete a promoção ativa; o sale_price sim.
    // 8 chamadas em paralelo por vez pra não estourar o rate limit.
    async function enrichPromo(id: string) {
      try {
        const r = await fetch(`${ML_API}/items/${id}/sale_price?context=channel_marketplace`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "x-format-new": "true" },
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = (await r.json()) as { amount?: number; regular_amount?: number };
        const amount = Number(j.amount ?? 0);
        if (amount <= 0) return;
        const e = estoque[id.toUpperCase()];
        if (!e) return;
        const regular = Number(j.regular_amount ?? 0) || e.regularPrice || amount;
        e.price = amount;                       // preço que o comprador paga agora
        e.regularPrice = regular > amount ? regular : amount;
        e.hasPromo = regular > amount;
      } catch { /* mantém o preço de lista */ }
    }
    const idsPromo = Object.keys(estoque);
    for (let i = 0; i < idsPromo.length; i += 8) {
      await Promise.all(idsPromo.slice(i, i + 8).map((id) => enrichPromo(id)));
    }

    return NextResponse.json({ estoque });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "estoque_ml_failed", details: msg }, { status: 500 });
  }
}
