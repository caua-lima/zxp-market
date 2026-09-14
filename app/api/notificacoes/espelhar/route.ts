import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  COLECAO_EVENTOS,
  COLECAO_EVENTOS_PUBLICA,
  redigirEvento,
} from "@/lib/domain/notificacao-publico";
import type { NotificationEvent } from "@/lib/domain/notifications";

/**
 * Preenche o espelho redigido a partir dos avisos que já existem.
 *
 * O espelho passou a ser escrito junto com cada evento novo, mas o histórico
 * nasceu antes dele. Sem esta carga, quem não pode ver financeiro abriria a
 * Central vazia até chegar um aviso novo.
 *
 * Só cria o que falta e não toca em nada da coleção original — derivar de
 * novo um documento que já existe só apagaria a marca de lido de quem já leu
 * o espelho.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  const db = getAdminDb();
  const origem = await db.collection(COLECAO_EVENTOS).get();

  let criados = 0;
  let jaExistiam = 0;
  let lote = db.batch();
  let pendentes = 0;

  for (const doc of origem.docs) {
    const espelho = db.collection(COLECAO_EVENTOS_PUBLICA).doc(doc.id);
    if ((await espelho.get()).exists) { jaExistiam += 1; continue; }

    const redigido = redigirEvento(doc.data() as Partial<NotificationEvent>);
    // `undefined` não passa pelo Admin SDK; redigirEvento remove os campos,
    // mas um evento antigo pode trazer outros campos vazios.
    lote.set(espelho, Object.fromEntries(Object.entries(redigido).filter(([, v]) => v !== undefined)));
    criados += 1;
    pendentes += 1;

    // O lote do Firestore para em 500 operações.
    if (pendentes === 400) { await lote.commit(); lote = db.batch(); pendentes = 0; }
  }

  if (pendentes > 0) await lote.commit();

  return NextResponse.json({ ok: true, origem: origem.size, criados, jaExistiam });
}
