import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { createNotificationEventIdempotent, markPushAttempted, markPushDelivered, markPushError } from "@/lib/notification-events";
import { sendPushToUserIfAllowed } from "@/lib/push-send";
import {
  buildTaskAssignedContent,
  buildTaskDeepLink,
  taskAssignedSeverity,
  type SalePushPayload,
} from "@/lib/domain/notifications";

/**
 * Chamado pelo cliente (TarefasTab.tsx) logo depois de salvar uma tarefa com
 * uma atribuição NOVA — diferente do fluxo de venda (que nasce de um webhook
 * do lado de fora), atribuir tarefa é uma ação de dentro do próprio app, sem
 * gatilho de servidor pra interceptar. Autenticado (requireAccess) pra não
 * virar um jeito de qualquer um mandar push pra qualquer e-mail.
 *
 * Vai só pro destinatário (sendPushToUserIfAllowed), nunca pro time inteiro
 * — diferente de venda, que é informação de todo mundo.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null) as {
    taskId?: string; assigneeEmail?: string; title?: string; priority?: string; dueDate?: string;
  } | null;

  const taskId = String(body?.taskId ?? "").trim();
  const assigneeEmail = String(body?.assigneeEmail ?? "").trim().toLowerCase();
  const title = String(body?.title ?? "").trim();
  const priority = String(body?.priority ?? "media");
  const dueDate = body?.dueDate ? String(body.dueDate) : undefined;

  if (!taskId || !assigneeEmail || !title) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }
  // Nunca notifica quem se auto-atribuiu — a pessoa já sabe, ela mesma clicou em Salvar.
  if (assigneeEmail === gate.email) {
    return NextResponse.json({ ok: true, skipped: "self_assign" });
  }

  const content = buildTaskAssignedContent(title, priority, dueDate);
  const severity = taskAssignedSeverity(priority);
  // Cada atribuição é um evento NOVO (diferente de venda, aqui não faz
  // sentido "idempotência contra retry" — reatribuir a mesma pessoa depois
  // de um tempo deve notificar de novo). O timestamp no dedupeKey só existe
  // pra dar uma chave única por documento; o botão "Salvar" já fica
  // desabilitado durante o envio, então clique duplo não é um risco real aqui.
  const dedupeKey = `task_assigned:${taskId}:${Date.now()}`;

  const { eventId } = await createNotificationEventIdempotent({
    type: "task_assigned", severity, entityType: "task", entityId: taskId, dedupeKey,
    title: content.title, body: content.body,
    deepLink: buildTaskDeepLink(taskId),
    financialState: "unavailable", // campo pensado pra venda; tarefa não tem dado financeiro
  });

  const payload: SalePushPayload = {
    eventId, type: "task_assigned", title: content.title, body: content.body,
    tag: `task-${taskId}`, deepLink: buildTaskDeepLink(taskId), timestamp: new Date().toISOString(),
  };

  await markPushAttempted(eventId);
  try {
    const { enviados, bloqueadoPorPreferencia } = await sendPushToUserIfAllowed(assigneeEmail, payload, "task_assigned");
    if (enviados > 0) await markPushDelivered(eventId);
    else await markPushError(eventId, bloqueadoPorPreferencia ? "destinatário bloqueou por preferência/horário silencioso" : "nenhum dispositivo registrado");
    return NextResponse.json({ ok: true, eventId, enviados });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPushError(eventId, msg.slice(0, 160));
    return NextResponse.json({ ok: false, error: msg, eventId }, { status: 500 });
  }
}
