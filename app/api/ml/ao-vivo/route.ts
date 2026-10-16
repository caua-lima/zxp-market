import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { devolucaoConcluida } from "@/lib/domain/devolucao-estado";
import { diaBRDe, recortarPorDiaBR } from "@/lib/domain/periodo-br";
import { prepararPedidosAoVivo, redigirOperacao, resumirAoVivo, type ProdutoAoVivo, type ResumoAoVivo } from "@/lib/domain/ao-vivo";
import { fetchOrdersLive, loadOrders } from "@/lib/ml/orders";
import { getMlAccessToken } from "../token";
import { sellerIdAtual } from "@/lib/ml/vendedor";

export const maxDuration = 20;

/**
 * A barra "Ao vivo": o dia de hoje em andamento, em todas as telas.
 *
 * ─── POR QUE NÃO REAPROVEITAR /api/ml/metrics ───────────────────────────
 *
 * A barra fica aberta o dia inteiro e se atualiza sozinha. `/api/ml/metrics`
 * lê o estoque todo, os custos, o Mercado Ads e o frete de cada pedido a cada
 * chamada — repetir isso de minuto em minuto, em toda aba, queimaria leitura
 * do Firestore e limite do ML pra mostrar quatro números. Aqui só entram os
 * pedidos de ontem e de hoje (uma busca no ML) e os cancelamentos desses dois
 * dias. A regra de venda válida é a MESMA do Dashboard
 * (lib/domain/ao-vivo.ts → classificarVenda), pra os dois nunca discordarem.
 *
 * Faturamento e contagem: nada de custo, margem ou lucro. Por isso o `member`
 * também recebe (`ver_resumo`). Visitas e estoque por produto são da OPERAÇÃO
 * (`ver_operacao`): saem da resposta de quem não tem — ausência, nunca zero.
 */

type ProdutoDoDia = ProdutoAoVivo & { imagem: string | null; estoque: number | null };
type Corpo = Omit<ResumoAoVivo, "topProdutos"> & {
  topProdutos: ProdutoDoDia[];
  /** Visitas de hoje (API do ML, não deduplicadas por visitante). `null` = não consegui perguntar. */
  visitas: number | null;
  fonte: "ml" | "banco";
  atualizadoEm: number;
};

/** Por empresa: o cache é do processo, e duas empresas dividem o mesmo processo. */
const cache = new Map<string, { at: number; body: Corpo }>();
const TTL_ML = 45 * 1000;
/** Sem o ML, cada leitura é paga no Firestore e o dado nem é ao vivo: segura mais. */
const TTL_BANCO = 5 * 60 * 1000;
const TTL_URGENTE = 10 * 1000;

const ML_API = "https://api.mercadolibre.com";

/** Visitas de hoje. `null` quando o ML não responde — "ninguém visitou" é outra coisa. */
async function visitasDeHoje(token: string, sellerId: string, hoje: string): Promise<number | null> {
  try {
    const r = await fetch(`${ML_API}/users/${sellerId}/items_visits/time_window?last=2&unit=day`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: { date?: string; total?: number }[] };
    const dia = (j.results ?? []).find((d) => String(d?.date ?? "").slice(0, 10) === hoje);
    return dia ? Number(dia.total ?? 0) : null;
  } catch {
    return null;
  }
}

/** Foto e estoque dos anúncios do ranking, numa chamada só. Sem resposta, o ranking vai sem foto. */
async function detalhesDosAnuncios(token: string, ids: string[]): Promise<Map<string, { imagem: string | null; estoque: number | null }>> {
  const mapa = new Map<string, { imagem: string | null; estoque: number | null }>();
  if (ids.length === 0) return mapa;
  try {
    const r = await fetch(`${ML_API}/items?ids=${ids.join(",")}&attributes=id,thumbnail,secure_thumbnail,available_quantity`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return mapa;
    const lista = (await r.json()) as { code?: number; body?: { id?: string; thumbnail?: string; secure_thumbnail?: string; available_quantity?: number } }[];
    for (const e of lista) {
      if (e.code !== 200 || !e.body?.id) continue;
      const foto = String(e.body.secure_thumbnail || e.body.thumbnail || "");
      mapa.set(e.body.id, {
        // Só https: a foto vai pra <img> numa página https.
        imagem: foto.startsWith("https://") ? foto : foto.startsWith("http://") ? foto.replace("http://", "https://") : null,
        estoque: Number.isFinite(Number(e.body.available_quantity)) ? Number(e.body.available_quantity) : null,
      });
    }
  } catch { /* sem foto, o ranking continua */ }
  return mapa;
}

function diaBR(ms: number): string {
  const d = new Date(ms - 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  try {
    const agora = Date.now();
    const hoje = diaBR(agora);
    const ontem = diaBR(agora - 24 * 3600 * 1000);
    const chave = `${gate.tenantId ?? "raiz"}|${hoje}`;

    const guardado = cache.get(chave);
    // `fresh=1`: chegou o aviso de uma venda, a barra quer o número novo já. Com
    // piso — senão dez abas abertas virariam dez buscas no ML por venda.
    const urgente = new URL(req.url).searchParams.get("fresh") === "1";
    const validade = urgente ? TTL_URGENTE : guardado?.body.fonte === "ml" ? TTL_ML : TTL_BANCO;
    if (guardado && agora - guardado.at < validade) {
      return NextResponse.json({ ...redigirOperacao(guardado.body, gate.pode("ver_operacao")), doCache: true });
    }

    const db = getAdminDb();
    const start = `${ontem}T00:00:00.000Z`;
    const end = `${hoje}T23:59:59.999Z`;
    const startBR = `${ontem}T00:00:00.000-03:00`;
    const endBR = `${hoje}T23:59:59.999-03:00`;

    const token = await getMlAccessToken().catch(() => null);
    let pedidos = token ? await fetchOrdersLive(token, startBR, endBR) : null;
    const fonte: Corpo["fonte"] = pedidos ? "ml" : "banco";
    if (!pedidos) pedidos = await loadOrders(db, start, end, startBR, endBR);

    // Cancelamentos e devoluções dos dois dias — mesma leitura do Dashboard.
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const cancelIds = new Set<string>();
    const devolIds = new Set<string>();
    for (const snap of [retUTC, retBR]) {
      for (const doc of snap.docs) {
        const r = doc.data();
        const dia = diaBRDe(String(r?.date_created ?? ""));
        if (dia !== hoje && dia !== ontem) continue;
        if (String(r.tipo ?? "") === "devolucao") {
          // Devolução em andamento ainda é venda — só a concluída reverte.
          if (devolucaoConcluida(r)) devolIds.add(doc.id);
        } else {
          cancelIds.add(doc.id);
        }
      }
    }

    // Um dia por vez, como o bloco "Vendas — Hoje" (ver prepararPedidosAoVivo).
    const classificados = [
      ...prepararPedidosAoVivo(recortarPorDiaBR(pedidos, ontem, ontem).dentro, cancelIds, devolIds),
      ...prepararPedidosAoVivo(recortarPorDiaBR(pedidos, hoje, hoje).dentro, cancelIds, devolIds),
    ];

    const resumo = resumirAoVivo(classificados, agora);
    // Visitas e fotos só existem com o ML respondendo: sem token, ficam de fora (null).
    const sellerId = token ? String(await sellerIdAtual()) : "";
    const [visitas, detalhes] = token
      ? await Promise.all([
          visitasDeHoje(token, sellerId, hoje),
          detalhesDosAnuncios(token, resumo.topProdutos.map((p) => p.itemId)),
        ])
      : [null, new Map<string, { imagem: string | null; estoque: number | null }>()];

    const body: Corpo = {
      ...resumo,
      topProdutos: resumo.topProdutos.map((p) => ({ ...p, imagem: detalhes.get(p.itemId)?.imagem ?? null, estoque: detalhes.get(p.itemId)?.estoque ?? null })),
      visitas,
      fonte,
      atualizadoEm: agora,
    };
    cache.set(chave, { at: agora, body });
    // O dia virou: o que ficou do dia anterior não serve mais pra ninguém.
    for (const k of cache.keys()) if (!k.endsWith(`|${hoje}`)) cache.delete(k);

    return NextResponse.json(redigirOperacao(body, gate.pode("ver_operacao")));
  } catch (e) {
    console.error("[ao-vivo]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "ao_vivo_indisponivel" }, { status: 500 });
  }
}
