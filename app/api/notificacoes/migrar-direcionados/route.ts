import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLECAO_EVENTOS, COLECAO_EVENTOS_PUBLICA } from "@/lib/domain/notificacao-publico";

export const maxDuration = 60;

/**
 * Tira das coleções COMPARTILHADAS os avisos que sempre foram direcionados.
 *
 * Tarefa atribuída, lembrete de prazo e teste eram gravados em
 * notification_events (e no espelho), e a Central do time inteiro os listava:
 * "Nova tarefa atribuída a você" de outra pessoa, e o teste de um aparecendo
 * como venda na tela de outro. Os novos já nascem no feed pessoal de quem deve
 * vê-los; este é o passivo dos antigos.
 *
 * Não dá pra MOVER: o evento antigo não guarda pra quem era — a audiência nunca
 * foi gravada. Como manter seria manter o vazamento, os antigos são APAGADOS das
 * duas coleções compartilhadas. O que se perde é só o histórico do aviso (a
 * tarefa continua em `tarefas`, e o aviso de prazo é refeito no dia).
 *
 *   (sem parâmetro)   simulação: conta o que apagaria, não apaga nada
 *   ?aplicar=1        apaga (até 200 por tipo por chamada; repita até `restantes: false`)
 *
 * Aceita o segredo do cron (curl) e o dono da conta.
 */
const TIPOS_DIRECIONADOS = ["task_assigned", "task_due", "test"] as const;

async function tratar(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  const aplicar = new URL(req.url).searchParams.get("aplicar") === "1";
  const db = getAdminDb();

  const contagem: Record<string, { compartilhado: number; espelho: number }> = {};
  let restantes = false;

  for (const tipo of TIPOS_DIRECIONADOS) {
    const [original, espelho] = await Promise.all([
      db.collection(COLECAO_EVENTOS).where("type", "==", tipo).limit(200).get(),
      db.collection(COLECAO_EVENTOS_PUBLICA).where("type", "==", tipo).limit(200).get(),
    ]);
    contagem[tipo] = { compartilhado: original.size, espelho: espelho.size };
    if (original.size === 200 || espelho.size === 200) restantes = true;

    if (aplicar) {
      const lote = db.batch();
      original.docs.forEach((d) => lote.delete(d.ref));
      espelho.docs.forEach((d) => lote.delete(d.ref));
      if (original.size + espelho.size > 0) await lote.commit();
    }
  }

  return NextResponse.json({ ok: true, simulacao: !aplicar, porTipo: contagem, restantes });
}

export const POST = tratar;
export const GET = tratar;
