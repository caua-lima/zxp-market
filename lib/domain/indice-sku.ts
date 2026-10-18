/**
 * Índice SKU → produto, lembrando os SKUs ANTERIORES de cada produto.
 *
 * ─── POR QUE ─────────────────────────────────────────────────────────────
 *
 * O pedido guarda o SKU que o anúncio tinha NA HORA da venda. Trocar o SKU do
 * produto (no app e no ML) faz as vendas novas virem com o novo — mas os pedidos
 * já sincronizados continuam com o antigo. Se o índice só conhecesse o SKU de
 * hoje, essas vendas deixariam de achar o produto: custo zero, margem inflada,
 * no mês que já fechou. Com `skusAnteriores`, o antigo continua apontando pro
 * mesmo produto.
 *
 * ─── QUEM GANHA UM EMPATE ───────────────────────────────────────────────
 *
 * O SKU ATUAL de um produto sempre vence o ANTERIOR de outro (o antigo pode ter
 * sido reaproveitado de propósito). Entre dois anteriores iguais, fica o
 * primeiro — e nenhum deles tira o lugar de um atual. A ordem dos documentos
 * não muda o resultado pros SKUs atuais.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export function skusAnterioresDe(doc: { skusAnteriores?: unknown }): string[] {
  return Array.isArray(doc.skusAnteriores) ? doc.skusAnteriores.map((s) => String(s ?? "").trim()).filter(Boolean) : [];
}

/** Registra o SKU atual (vence sempre) e os anteriores (só onde ninguém tem como atual). */
export function registrarSkus<T>(
  indice: Map<string, T>,
  doc: { sku?: unknown; skusAnteriores?: unknown },
  valor: T,
  normalizar: (s: string) => string,
  /** Chaves já tomadas por um SKU ATUAL — controlado por quem monta o índice. */
  atuais: Set<string>,
): void {
  const atual = normalizar(String(doc.sku ?? "").trim());
  if (atual) { indice.set(atual, valor); atuais.add(atual); }
  for (const s of skusAnterioresDe(doc)) {
    const k = normalizar(s);
    if (!k || atuais.has(k) || indice.has(k)) continue;
    indice.set(k, valor);
  }
}

/** Junta o SKU que está saindo à lista de anteriores (sem repetir, sem o atual). */
export function comSkuAnterior(anteriores: unknown, skuSaindo: string, skuNovo: string): string[] {
  const lista = skusAnterioresDe({ skusAnteriores: anteriores });
  const sai = String(skuSaindo ?? "").trim();
  const chave = (s: string) => s.trim().toLowerCase();
  const out = sai && chave(sai) !== chave(skuNovo) ? [...lista, sai] : lista;
  const vistos = new Set<string>();
  return out.filter((s) => {
    const k = chave(s);
    if (k === chave(skuNovo) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
