import "server-only";
import { getMlAccessToken } from "@/app/api/ml/token";
import { avisosDeDevolucao, type Reclamacao } from "@/lib/domain/devolucoes";
import { buildPayload, enviarEPersistirEntrega } from "@/lib/ml/notificar-venda";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { buildOrderDeepLink } from "@/lib/domain/notifications";

const ML_API = "https://api.mercadolibre.com";

/**
 * Avisa sobre devolução e reclamação — o buraco que faltava nas notificações.
 *
 * ─── POR QUE A BUSCA PRECISA DE FILTRO ──────────────────────────────────
 *
 * `/post-purchase/v1/claims/search` recusa chamada sem nenhum filtro
 * (400 `atLeastOneFilterProvided`). `stage=claim` é o filtro que traz o que
 * interessa: reclamação que virou caso, ainda antes de virar mediação do ML.
 * Medido na conta: devolve os dois tipos, `returns` e `mediations`.
 *
 * ─── BEST-EFFORT, COMO TODO AVISO ───────────────────────────────────────
 *
 * Nada aqui pode derrubar o cron. Se a API de reclamações estiver fora, o
 * sync e os outros avisos seguem — perder um aviso é ruim, perder o painel
 * é pior.
 */

export type ResultadoDevolucoes = {
  /** Chaves avisadas nesta execução. */
  avisados: string[];
  /** Quantas reclamações a API devolveu. */
  encontradas: number;
  /** Presente quando não deu pra consultar. */
  erro?: string;
};

async function buscarReclamacoes(token: string): Promise<Reclamacao[]> {
  const r = await fetch(
    `${ML_API}/post-purchase/v1/claims/search?stage=claim&limit=50&sort=date_created,desc`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" },
  );
  if (!r.ok) throw new Error(`claims_http_${r.status}`);

  const j = (await r.json()) as { data?: unknown[]; results?: unknown[] };
  const lista = (j.data ?? j.results ?? []) as Record<string, unknown>[];

  return lista.map((c) => ({
    id: String(c.id ?? ""),
    tipo: String(c.type ?? ""),
    status: String(c.status ?? ""),
    // `resource_id` é o pedido a que a reclamação se refere.
    pedido: String(c.resource_id ?? ""),
    criadoEm: String(c.date_created ?? ""),
    atualizadoEm: c.last_updated ? String(c.last_updated) : null,
  }));
}

export async function verificarDevolucoes(): Promise<ResultadoDevolucoes> {
  const token = await getMlAccessToken();
  if (!token) return { avisados: [], encontradas: 0, erro: "ml_nao_conectado" };

  let reclamacoes: Reclamacao[];
  try {
    reclamacoes = await buscarReclamacoes(token);
  } catch (err) {
    return { avisados: [], encontradas: 0, erro: err instanceof Error ? err.message : String(err) };
  }

  const avisados: string[] = [];
  for (const aviso of avisosDeDevolucao(reclamacoes, Date.now())) {
    try {
      /**
       * A chave é o dedupeKey, e o Firestore garante criação única — então
       * rodar o cron de novo não reavisa, sem precisar guardar estado próprio.
       */
      const { created, eventId } = await createNotificationEventIdempotent({
        type: aviso.tipo,
        severity: aviso.tipo === "return_completed" ? "danger" : "warning",
        entityType: "order",
        entityId: aviso.pedido,
        dedupeKey: aviso.chave,
        title: aviso.titulo,
        body: aviso.corpo,
        orderId: aviso.pedido,
        orderExternalId: aviso.pedido,
        financialState: "estimated",
        deepLink: buildOrderDeepLink(aviso.pedido),
      });
      if (!created) continue;

      await enviarEPersistirEntrega(
        eventId,
        aviso.tipo,
        buildPayload(eventId, aviso.tipo, aviso.titulo, aviso.corpo, {
          orderId: aviso.pedido,
          tag: aviso.chave,
        }),
      );
      avisados.push(aviso.chave);
    } catch (err) {
      console.error("[devolucoes] falhou ao avisar", aviso.chave, err);
    }
  }

  return { avisados, encontradas: reclamacoes.length };
}
