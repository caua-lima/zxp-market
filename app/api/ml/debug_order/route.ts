import { getAdminDb } from "@/lib/firebase/admin";
import { rotaDeDiagnostico } from "@/lib/diagnostico";

/** Diagnóstico de vínculo pedido → estoque (por SKU), na empresa da requisição. */
export const GET = rotaDeDiagnostico("debug_order", async () => {
  const db = getAdminDb();

  const [ordersSnap, estoqueSnap] = await Promise.all([
    db.collection("ml_orders").limit(3).get(),
    db.collection("estoque").get(),
  ]);

  const sample_orders = ordersSnap.docs.map((doc) => {
    const d = doc.data();
    return { order_id: d.order_id, total_amount: d.total_amount, items: d.items };
  });

  const estoque = estoqueSnap.docs.map((doc) => {
    const d = doc.data();
    return { id: doc.id, name: d.name, sku: d.sku, mlb: d.mlb, custo: d.custo, custo_envio_full: d.custo_envio_full };
  });

  // Diagnóstico de vínculo: testa cada item de pedido contra o estoque
  const skusEstoque = new Set(estoque.map((p) => String(p.sku ?? "").trim().toLowerCase()));
  const vinculos: { sku_pedido: string; encontrado: boolean }[] = [];
  for (const o of sample_orders) {
    for (const item of (o.items ?? [])) {
      const sku = String(item.sku ?? "").trim().toLowerCase();
      vinculos.push({ sku_pedido: sku, encontrado: skusEstoque.has(sku) });
    }
  }

  return { corpo: { sample_orders, estoque, diagnostico_vinculo: vinculos } };
});
