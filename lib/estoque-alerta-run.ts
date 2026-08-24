import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { getMlAccessToken } from "@/app/api/ml/token";
import { consolidarEstoqueAnuncios, type AnuncioEstoque } from "@/lib/domain/estoque";
import {
  detectarEstoqueBaixo,
  type AvisoEstoque,
  type ProdutoEstoque,
} from "@/lib/domain/estoque-alerta";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { buildPayload, enviarEPersistirEntrega } from "@/lib/ml/notificar-venda";

const ML_API = "https://api.mercadolibre.com";

/**
 * Verifica o estoque NO FULL de todos os anúncios e avisa o que chegou no
 * mínimo — o gatilho pra agendar coleta.
 *
 * ─── POR QUE O ESTADO FICA NO FIRESTORE, E NÃO SÓ NO dedupeKey ──────────
 *
 * `createNotificationEventIdempotent` já garante um evento por chave — mas a
 * chave aqui é `stock_low:{produto}`, sem data, de propósito (ver
 * estoque-alerta.ts). Isso sozinho avisaria UMA VEZ NA VIDA por produto:
 * repôs, vendeu tudo de novo, e nenhum aviso.
 *
 * Por isso existe `estoque_alertas`: guarda quem já foi avisado e ainda não
 * repôs. Quando o estoque volta a subir, o doc é apagado — e o evento antigo
 * some junto, liberando a mesma chave pro próximo ciclo.
 *
 * Best-effort por construção: erro aqui nunca pode derrubar o cron, que é o
 * que mantém venda e faturamento em dia.
 */

const ESTADO = "estoque_alertas";

const normId = (s: string) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

type Row = { available: number; logistic: string; inventoryId: string };

/** Busca disponível + logística dos MLBs, de 20 em 20 (limite do multi-get). */
async function buscarEstoqueML(ids: string[], token: string): Promise<Map<string, Row>> {
  const mapa = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    try {
      const res = await fetch(
        `${ML_API}/items?ids=${chunk.join(",")}&attributes=id,available_quantity,status,shipping,inventory_id`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" },
      );
      if (!res.ok) continue;
      const rows = (await res.json()) as { code?: number; body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b?.id) continue;
        const shipping = (b.shipping as Record<string, unknown>) ?? {};
        mapa.set(normId(String(b.id)), {
          available: Number(b.available_quantity ?? 0),
          logistic: String(shipping.logistic_type ?? ""),
          inventoryId: String(b.inventory_id ?? ""),
        });
      }
    } catch {
      // Um lote que falha não pode impedir os outros de serem verificados.
    }
  }
  return mapa;
}

async function lerJaAvisados(): Promise<Set<string>> {
  try {
    const snap = await getAdminDb().collection(ESTADO).get();
    return new Set(snap.docs.map((d) => d.id));
  } catch {
    /**
     * Sem conseguir ler o estado, o seguro é NÃO avisar: tratar todo mundo
     * como "nunca avisado" mandaria push de todos os produtos baixos de uma
     * vez, a cada rodada do cron. Perder um aviso é melhor que inundar.
     */
    return new Set(["__falha_de_leitura__"]);
  }
}

export type ResultadoEstoqueAlerta = {
  avisados: string[];
  rearmados: string[];
  verificados: number;
  erro?: string;
};

export async function verificarEstoqueBaixo(): Promise<ResultadoEstoqueAlerta> {
  const vazio: ResultadoEstoqueAlerta = { avisados: [], rearmados: [], verificados: 0 };
  try {
    const token = await getMlAccessToken();
    if (!token) return { ...vazio, erro: "sem_token" };

    const db = getAdminDb();
    const prodSnap = await db.collection("estoque").get();
    if (prodSnap.empty) return vazio;

    // Todos os MLBs de todos os produtos, pra uma busca só no ML.
    const todosIds = new Set<string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) { const n = normId(m); if (n) todosIds.add(n); }
    }
    const estoqueML = await buscarEstoqueML([...todosIds], token);

    const produtos: ProdutoEstoque[] = prodSnap.docs.map((doc) => {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      const anuncios: AnuncioEstoque[] = list
        .map((m) => estoqueML.get(normId(m)))
        .filter((r): r is Row => !!r)
        .map((r) => ({ available: r.available, logistic: r.logistic, inventoryId: r.inventoryId }));

      // Consolida pools do Full: dois anúncios no mesmo pool não somam.
      const c = consolidarEstoqueAnuncios(anuncios);
      return {
        id: doc.id,
        nome: String(d.name ?? d.nome ?? doc.id),
        // Só o Full dispara o aviso — é ele que a coleta reabastece.
        full: c.full,
        // Não entra no limite; diz se dá pra coletar hoje ou se falta comprar.
        casa: Math.max(Number(d.qtdLocal ?? 0), 0),
        ehFull: c.ehFull,
        // Limite por produto, quando o operador tiver definido um.
        minimo: d.estoqueMinimo != null ? Number(d.estoqueMinimo) : null,
      };
    });

    const jaAvisados = await lerJaAvisados();
    if (jaAvisados.has("__falha_de_leitura__")) {
      return { ...vazio, verificados: produtos.length, erro: "estado_indisponivel" };
    }

    const { avisar, rearmar } = detectarEstoqueBaixo(produtos, jaAvisados);

    const avisados: string[] = [];
    for (const aviso of avisar) {
      try {
        if (await notificarEstoque(aviso)) {
          await db.collection(ESTADO).doc(aviso.produtoId).set({
            produtoId: aviso.produtoId,
            full: aviso.full,
            casa: aviso.casa,
            avisadoEm: Date.now(),
          });
          avisados.push(aviso.produtoId);
        }
      } catch (err) {
        console.error("[estoque-alerta] falhou ao avisar", aviso.produtoId, err);
      }
    }

    // Repôs: apaga o estado E o evento, pra mesma chave poder avisar de novo.
    const rearmados: string[] = [];
    for (const id of rearmar) {
      try {
        await db.collection(ESTADO).doc(id).delete();
        await db.collection("notification_events").doc(`stock_low:${id}`).delete().catch(() => {});
        rearmados.push(id);
      } catch { /* tenta de novo na próxima rodada */ }
    }

    return { avisados, rearmados, verificados: produtos.length };
  } catch (err) {
    console.error("[estoque-alerta] falhou", err);
    return { ...vazio, erro: err instanceof Error ? err.message : String(err) };
  }
}

async function notificarEstoque(aviso: AvisoEstoque): Promise<boolean> {
  const { created, eventId } = await createNotificationEventIdempotent({
    type: "stock_low",
    severity: "warning",
    entityType: "system",
    entityId: aviso.produtoId,
    dedupeKey: aviso.chave,
    title: aviso.titulo,
    body: aviso.corpo,
    financialState: "confirmed",
    // Aba Full: e la que a coleta e agendada, nao no Estoque geral.
    deepLink: "/?tab=full",
  });
  if (!created) return false;

  await enviarEPersistirEntrega(
    eventId,
    "stock_low",
    buildPayload(eventId, "stock_low", aviso.titulo, aviso.corpo, {
      orderId: "",
      tag: aviso.chave,
    }),
  );
  return true;
}
