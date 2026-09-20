import { FieldPath } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  COLECAO_EVENTOS,
  COLECAO_EVENTOS_PUBLICA,
  espelhoDivergente,
  redigirEvento,
} from "@/lib/domain/notificacao-publico";
import type { NotificationEvent } from "@/lib/domain/notifications";
import { garantirEspelho } from "@/lib/notification-events";

export const maxDuration = 60;

/**
 * Cria e CONSERTA o espelho redigido dos avisos que já existem.
 *
 * ─── O QUE FAZ ──────────────────────────────────────────────────────────
 *
 *  - cria o espelho que falta (o histórico nasceu antes dele, e uma falha
 *    passada pode ter deixado eventos sem espelho);
 *  - reprojeta os que já existem quando divergem da projeção de hoje: os
 *    espelhos antigos foram gravados por uma lista NEGRA e ainda trazem `type`
 *    e `severity` que revelam "esta venda deu prejuízo", além de campos
 *    internos como `delivery`.
 *
 * A marca de lido/dispensado do espelho é PRESERVADA (ver garantirEspelho) —
 * derivar de novo um documento sem isso apagaria o que quem já leu marcou.
 *
 * ─── COMO USAR ──────────────────────────────────────────────────────────
 *
 * Pagina por `cursor` (o id do último documento processado): a versão anterior
 * lia a coleção inteira e checava um a um numa única chamada, o que estoura o
 * tempo da função quando o histórico cresce.
 *
 *   ?simular=1   só conta o que faria, sem escrever nada (rode antes)
 *   ?cursor=ID   continua de onde parou (a resposta traz `proximo`)
 *   ?limite=N    tamanho da página, no máximo 300
 *
 * Aceita o segredo do cron (curl) e o dono da conta.
 */
async function tratar(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const simular = url.searchParams.get("simular") === "1";
  const cursor = url.searchParams.get("cursor");
  const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 200, 1), 300);

  const db = getAdminDb();
  let consulta = db.collection(COLECAO_EVENTOS).orderBy(FieldPath.documentId()).limit(limite);
  if (cursor) consulta = consulta.startAfter(cursor);
  const pagina = await consulta.get();

  const espelhos = pagina.docs.length > 0
    ? await db.getAll(...pagina.docs.map((d) => db.collection(COLECAO_EVENTOS_PUBLICA).doc(d.id)))
    : [];

  let criados = 0;
  let reprojetados = 0;
  let iguais = 0;
  let falhas = 0;

  for (let i = 0; i < pagina.docs.length; i++) {
    const doc = pagina.docs[i];
    const original = doc.data() as Partial<NotificationEvent>;
    const atual = espelhos[i].exists ? (espelhos[i].data() as Record<string, unknown>) : undefined;
    const publico = redigirEvento(original);

    if (atual && !espelhoDivergente(publico, atual)) { iguais++; continue; }
    if (!simular) {
      try { await garantirEspelho(db, doc.id, original); } catch { falhas++; continue; }
    }
    if (atual) reprojetados++; else criados++;
  }

  const ultimo = pagina.docs[pagina.docs.length - 1]?.id ?? null;
  return NextResponse.json({
    ok: true,
    simulacao: simular,
    processados: pagina.size,
    criados,
    reprojetados,
    iguais,
    falhas,
    // `null` = acabou. Senão, chame de novo com ?cursor=<proximo>.
    proximo: pagina.size === limite ? ultimo : null,
  });
}

export const POST = tratar;
export const GET = tratar;
