import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { devolucaoConcluida } from "@/lib/domain/devolucao-estado";
import { diaBRDe, recortarPorDiaBR } from "@/lib/domain/periodo-br";
import { prepararPedidosAoVivo, resumirAoVivo, type ResumoAoVivo } from "@/lib/domain/ao-vivo";
import { fetchOrdersLive, loadOrders } from "@/lib/ml/orders";
import { getMlAccessToken } from "../token";

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
 * Só faturamento e contagem: nada de custo, margem ou lucro. Por isso o
 * `member` também recebe (`ver_resumo`), sem redação.
 */

type Corpo = ResumoAoVivo & { fonte: "ml" | "banco"; atualizadoEm: number };

/** Por empresa: o cache é do processo, e duas empresas dividem o mesmo processo. */
const cache = new Map<string, { at: number; body: Corpo }>();
const TTL_ML = 45 * 1000;
/** Sem o ML, cada leitura é paga no Firestore e o dado nem é ao vivo: segura mais. */
const TTL_BANCO = 5 * 60 * 1000;
const TTL_URGENTE = 10 * 1000;

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
      return NextResponse.json({ ...guardado.body, doCache: true });
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

    const body: Corpo = { ...resumirAoVivo(classificados, agora), fonte, atualizadoEm: agora };
    cache.set(chave, { at: agora, body });
    // O dia virou: o que ficou do dia anterior não serve mais pra ninguém.
    for (const k of cache.keys()) if (!k.endsWith(`|${hoje}`)) cache.delete(k);

    return NextResponse.json(body);
  } catch (e) {
    console.error("[ao-vivo]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "ao_vivo_indisponivel" }, { status: 500 });
  }
}
