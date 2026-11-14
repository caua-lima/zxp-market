import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchML } from "@/lib/ml/fetch-ml";
import { sellerIdAtual } from "@/lib/ml/vendedor";
import { getMlAccessToken } from "@/app/api/ml/token";
import { siglasDoEnvio, type ItemDoEnvio, type SiglaDoProduto, type ComponenteKit } from "@/lib/etiquetas/siglas";

export const maxDuration = 60;
const ML_API = "https://api.mercadolibre.com";
const MAX_ENVIOS = 300;

/**
 * Do número do envio (lido da etiqueta) aos produtos e à sigla de separação.
 *
 * Resposta MÍNIMA de propósito — quem usa é o Colaborador, que não vê
 * operação nem financeiro: envio, pedidos, produto, SKU, quantidade e sigla.
 * Sem preço, custo, margem, comprador nem token.
 *
 * Primeiro os pedidos já sincronizados (`ml_orders.shipping_id`); o que
 * faltar vem do ML, e só depois de conferir que o envio é DESTA conta — a rota
 * não serve de proxy pra consultar envio de ninguém.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "usar_etiquetas" });
  if (gate instanceof NextResponse) return gate;

  const corpo = (await req.json().catch(() => null)) as { envios?: unknown } | null;
  const envios = [...new Set((Array.isArray(corpo?.envios) ? corpo.envios : []).map((x) => String(x ?? "").trim()))]
    .filter((x) => /^\d{6,20}$/.test(x))
    .slice(0, MAX_ENVIOS);
  if (envios.length === 0) return NextResponse.json({ error: "sem_envios" }, { status: 400 });

  const db = getAdminDb();

  // Cadastro de siglas: os produtos do Estoque (só os campos que a separação usa).
  const prodSnap = await db.collection("estoque").get();
  const cadastro: SiglaDoProduto[] = [];
  const semSigla: string[] = [];
  for (const d of prodSnap.docs) {
    const p = d.data();
    const sigla = String(p.siglaSeparacao ?? "").trim();
    const skus = [String(p.sku ?? ""), ...(Array.isArray(p.skusAnteriores) ? p.skusAnteriores.map(String) : [])].filter(Boolean);
    const mlbs: string[] = Array.isArray(p.mlbs) && p.mlbs.length ? p.mlbs.map(String) : p.mlb ? [String(p.mlb)] : [];
    if (!sigla) { if (p.ativo !== false) semSigla.push(String(p.name ?? d.id)); continue; }
    const componentes = Array.isArray(p.kitComponentes)
      ? (p.kitComponentes as ComponenteKit[]).map((c) => ({ sigla: String(c?.sigla ?? ""), quantidade: Number(c?.quantidade ?? 0) }))
      : undefined;
    cadastro.push({ produtoId: d.id, nome: String(p.name ?? d.id), sigla, skus, mlbs, ...(componentes ? { componentes } : {}) });
  }

  // 1) Pedidos já sincronizados, por envio.
  const itensPorEnvio = new Map<string, { pedidos: string[]; itens: ItemDoEnvio[] }>();
  for (let i = 0; i < envios.length; i += 30) {
    const lote = envios.slice(i, i + 30);
    const snap = await db.collection("ml_orders").where("shipping_id", "in", lote).get();
    for (const d of snap.docs) {
      const o = d.data();
      if (String(o.status ?? "") === "cancelled") continue;
      const envio = String(o.shipping_id ?? "");
      const atual = itensPorEnvio.get(envio) ?? { pedidos: [], itens: [] };
      atual.pedidos.push(d.id);
      for (const it of (Array.isArray(o.items) ? o.items : []) as { sku?: string; item_id?: string; quantity?: number; title?: string }[]) {
        atual.itens.push({ sku: it.sku ?? null, mlb: it.item_id ?? null, titulo: String(it.title ?? ""), quantidade: Number(it.quantity ?? 0) });
      }
      itensPorEnvio.set(envio, atual);
    }
  }

  // 2) O que faltou: do ML, só se o envio for desta conta.
  const faltando = envios.filter((e) => !itensPorEnvio.has(e));
  const naoEncontrados = new Set<string>();
  if (faltando.length) {
    const token = await getMlAccessToken().catch(() => null);
    const seller = token ? await sellerIdAtual().catch(() => "") : "";
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    for (const envio of faltando.slice(0, 40)) {
      if (!token || !seller) { naoEncontrados.add(envio); continue; }
      try {
        const rs = await fetchML(`${ML_API}/shipments/${envio}`, { headers, cache: "no-store" }, { maxTentativas: 1 });
        if (!rs.ok) { naoEncontrados.add(envio); continue; }
        const s = (await rs.json()) as { sender_id?: number | string };
        if (String(s.sender_id ?? "") !== String(seller)) { naoEncontrados.add(envio); continue; }
        const ri = await fetchML(`${ML_API}/shipments/${envio}/items`, { headers, cache: "no-store" }, { maxTentativas: 1 });
        if (!ri.ok) { naoEncontrados.add(envio); continue; }
        const itens = (await ri.json()) as { order_id?: number | string; item_id?: string; quantity?: number; description?: string }[];
        itensPorEnvio.set(envio, {
          pedidos: [...new Set(itens.map((x) => String(x.order_id ?? "")).filter(Boolean))],
          itens: itens.map((x) => ({ mlb: x.item_id ?? null, sku: null, titulo: String(x.description ?? ""), quantidade: Number(x.quantity ?? 0) })),
        });
      } catch {
        naoEncontrados.add(envio);
      }
    }
    for (const e of faltando.slice(40)) naoEncontrados.add(e);
  }

  const resultado = envios.map((envio) => {
    const achado = itensPorEnvio.get(envio);
    if (!achado) {
      return { envio, status: "nao_encontrado" as const, pedidos: [], itens: [], motivo: naoEncontrados.has(envio) ? "envio não encontrado nesta conta" : "sem dados" };
    }
    const r = siglasDoEnvio(achado.itens, cadastro);
    const itens = achado.itens.map((it) => ({ mlb: it.mlb ?? null, sku: it.sku ?? null, titulo: it.titulo ?? "", quantidade: it.quantidade }));
    return r.ok
      ? { envio, status: "ok" as const, pedidos: achado.pedidos, itens, porSigla: r.porSigla, texto: r.texto }
      : { envio, status: "pendente" as const, pedidos: achado.pedidos, itens, motivo: r.motivo };
  });

  return NextResponse.json(
    { envios: resultado, produtosSemSigla: semSigla },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
