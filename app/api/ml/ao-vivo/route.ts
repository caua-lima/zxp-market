import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { devolucaoConcluida } from "@/lib/domain/devolucao-estado";
import { diaBRDe, recortarPorDiaBR } from "@/lib/domain/periodo-br";
import { metaDoDia, prepararPedidosAoVivo, redigirOperacao, resumirAoVivo, type MetaDoDia, type ProdutoAoVivo, type ResumoAoVivo } from "@/lib/domain/ao-vivo";
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
  /** A meta de hoje (mesmas regras do Dashboard). `null` = sem meta do mês configurada. */
  metaDoDia: MetaDoDia | null;
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

/**
 * Vendas válidas do mês ATÉ ONTEM — a base da meta de hoje. Não muda ao longo do
 * dia (só se um pedido antigo for cancelado), então é lida do banco e guardada
 * por 30 min por empresa: ler o mês inteiro a cada 45 s queimaria cota à toa.
 */
const cacheDoMes = new Map<string, { at: number; valor: number }>();
const TTL_MES = 30 * 60 * 1000;

async function vendasDoMesAteOntem(db: FirebaseFirestore.Firestore, chave: string, primeiroDia: string, ontem: string): Promise<number> {
  if (ontem < primeiroDia) return 0; // dia 1: o mês ainda não tem "até ontem"
  const g = cacheDoMes.get(chave);
  if (g && Date.now() - g.at < TTL_MES) return g.valor;
  const ini = `${primeiroDia}T00:00:00.000Z`, fim = `${ontem}T23:59:59.999Z`;
  const iniBR = `${primeiroDia}T00:00:00.000-03:00`, fimBR = `${ontem}T23:59:59.999-03:00`;
  const pedidos = recortarPorDiaBR(await loadOrders(db, ini, fim, iniBR, fimBR), primeiroDia, ontem).dentro;
  const [a, b] = await Promise.all([
    db.collection("ml_returns").where("date_created", ">=", ini).where("date_created", "<=", fim).get(),
    db.collection("ml_returns").where("date_created", ">=", iniBR).where("date_created", "<=", fimBR).get(),
  ]);
  const cancel = new Set<string>(), devol = new Set<string>();
  for (const snap of [a, b]) for (const d of snap.docs) {
    const r = d.data();
    if (String(r.tipo ?? "") === "devolucao") { if (devolucaoConcluida(r)) devol.add(d.id); } else cancel.add(d.id);
  }
  // Mesma classificação da venda válida — o mês inteiro de uma vez, como o Dashboard faz pro período.
  const valor = prepararPedidosAoVivo(pedidos, cancel, devol).filter((x) => x.classe === "valida").reduce((s2, x) => s2 + x.totalAmount, 0);
  cacheDoMes.set(chave, { at: Date.now(), valor });
  // Só o dia de hoje desta empresa interessa: o de ontem dela sai (as outras empresas ficam).
  const empresa = chave.split("|")[0] + "|";
  for (const k of cacheDoMes.keys()) if (k !== chave && k.startsWith(empresa)) cacheDoMes.delete(k);
  return valor;
}

/** A meta do mês: a do mês corrente, ou a mais recente — a mesma escolha do Dashboard. */
async function metasDoMes(db: FirebaseFirestore.Firestore, mes: string): Promise<{ meta1: number; meta2: number | null; meta3: number | null } | null> {
  const snap = await db.collection("metasHistorico").orderBy("createdAt", "desc").limit(60).get().catch(() => null);
  if (!snap || snap.empty) return null;
  const docs = snap.docs.map((d) => d.data());
  const e = docs.find((d) => d.mes === mes) ?? docs[0];
  const meta1 = Number(e?.meta1 ?? 0);
  if (!(meta1 > 0)) return null;
  return { meta1, meta2: Number(e.meta2) > 0 ? Number(e.meta2) : null, meta3: Number(e.meta3) > 0 ? Number(e.meta3) : null };
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

    // Meta de hoje: o que falta do mês até ontem ÷ dias que restam (hoje incluso), da meta vigente.
    const mes = hoje.slice(0, 7);
    const [ateOntem, metas] = await Promise.all([
      vendasDoMesAteOntem(db, `${gate.tenantId ?? "raiz"}|${hoje}`, `${mes}-01`, ontem).catch(() => null),
      metasDoMes(db, mes),
    ]);
    const [ano, mesNum] = mes.split("-").map(Number);
    const diasNoMes = new Date(Date.UTC(ano, mesNum, 0)).getUTCDate();
    const meta = ateOntem == null ? null : metaDoDia({
      metas, vendasAteOntem: ateOntem, vendasHoje: resumo.hoje.vendas, diaAtual: Number(hoje.slice(8, 10)), diasNoMes,
    });

    const body: Corpo = {
      ...resumo,
      metaDoDia: meta,
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
