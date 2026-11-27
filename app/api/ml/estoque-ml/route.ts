import { NextResponse } from "next/server";
import { fetchML } from "@/lib/ml/fetch-ml";
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
  const gate = await requireAccess(req, { allowCron: true, capacidade: "ver_operacao" });
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
    const estoque: Record<string, { available: number; sold: number; status: string; price: number; regularPrice: number; hasPromo: boolean; logistic: string; inventoryId: string; poolProprio?: string }> = {};

    // Multi-get de 20 em 20 (preço de lista + original + logística p/ saber se é Full)
    //
    // `inventory_id` é o que identifica o POOL de estoque no Full. Dois
    // anúncios podem compartilhar o mesmo pool e cada um responde
    // available_quantity com o total do pool, não com uma fatia — sem este
    // campo não há como saber que são o mesmo estoque, e somar os dois dobra
    // o número (ver consolidarEstoqueAnuncios em lib/domain/estoque.ts).
    /**
     * NENHUM BLOCO PODE SUMIR CALADO (26/11/2026: "o estoque está zerado de
     * todos os produtos"). Era `if (!res.ok) continue`: um bloco de 20 que
     * falhava (rate limit, erro do ML) simplesmente não entrava, e a resposta
     * saía como se fosse completa — a tela trocava o estoque inteiro por ela e
     * os anúncios do bloco perdido viravam ZERO. Medido: uma resposta com 2
     * anúncios de 42, e a aba mostrando "0 Full + 0 Agências" em tudo.
     *
     * Agora o bloco que falha é refeito em metades até o anúncio sozinho; o
     * que nem assim vier sai em `faltando`, com `incompleto: true`, e a tela
     * mantém o que já tinha pra esses anúncios em vez de zerar.
     */
    const headersMl = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const ATRIBUTOS = "id,available_quantity,sold_quantity,status,price,original_price,shipping,inventory_id,item_relations";
    const faltando: string[] = [];
    const falhas: string[] = [];
    const guardar = (b: Record<string, unknown>) => {
        const id = String(b.id ?? "").toUpperCase();
        if (!id) return;
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
          // Anúncio sincronizado com outro ("Sincronizado com #…", catálogo): mesmo estoque.
          ...((() => {
            const rel = Array.isArray(b.item_relations) ? (b.item_relations as { id?: string }[]).map((r) => String(r?.id ?? "").toUpperCase()).filter(Boolean) : [];
            return rel.length ? { poolProprio: [id, ...rel].sort().join("+") } : {};
          })()),
        };
    };
    async function buscarBloco(chunk: string[]): Promise<void> {
      let res: Response | null = null;
      try {
        res = await fetchML(`${ML_API}/items?ids=${chunk.join(",")}&attributes=${ATRIBUTOS}`, { headers: headersMl, cache: "no-store" });
      } catch { res = null; }
      if (res?.ok) {
        const rows = (await res.json().catch(() => [])) as { code?: number; body?: Record<string, unknown> }[];
        const vieram = new Set<string>();
        for (const row of Array.isArray(rows) ? rows : []) {
          if (row?.body && (row.code == null || row.code === 200) && row.body.id) { guardar(row.body); vieram.add(String(row.body.id).toUpperCase()); }
        }
        const naoVieram = chunk.filter((id) => !vieram.has(id));
        if (!naoVieram.length) return;
        if (chunk.length === 1) { faltando.push(...naoVieram); falhas.push(`${chunk[0]}: sem corpo`); return; }
        for (const id of naoVieram) await buscarBloco([id]);
        return;
      }
      if (chunk.length > 1) {
        const meio = Math.ceil(chunk.length / 2);
        await buscarBloco(chunk.slice(0, meio));
        await buscarBloco(chunk.slice(meio));
        return;
      }
      faltando.push(chunk[0]);
      falhas.push(`${chunk[0]}: HTTP ${res?.status ?? "sem resposta"}`);
    }
    for (let i = 0; i < arr.length; i += 20) await buscarBloco(arr.slice(i, i + 20));

    // Preço REAL de venda (Central de Promoções / ofertas): endpoint sale_price.
    // O `price` de lista nem sempre reflete a promoção ativa; o sale_price sim.
    // 8 chamadas em paralelo por vez pra não estourar o rate limit.
    async function enrichPromo(id: string) {
      try {
        const r = await fetchML(`${ML_API}/items/${id}/sale_price?context=channel_marketplace`, {
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

    if (faltando.length) console.error("estoque-ml incompleto", falhas.join(" | "));
    return NextResponse.json({ estoque, ...(faltando.length ? { incompleto: true, faltando, falhas } : {}) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "estoque_ml_failed", details: msg }, { status: 500 });
  }
}
