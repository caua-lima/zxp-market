import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { enviarEPersistirEntrega } from "@/lib/notification-dispatch";
import { consumirLimiteDaChave } from "@/lib/notification-limites";
import { avaliarAtribuicao } from "@/lib/domain/atribuicao-de-tarefa";
import { podeCapacidade } from "@/lib/domain/capacidades";
import { papelDe, type PermissionTab, type Task } from "@/lib/domain/types";
import {
  buildTaskAssignedContent,
  buildTaskDeepLink,
  taskAssignedSeverity,
  type SalePushPayload,
} from "@/lib/domain/notifications";

const ID_DE_TAREFA = /^[A-Za-z0-9_-]{1,128}$/;

/** Uma pessoa dispara no máximo 20 avisos de atribuição por 10 minutos. Salvar 20 tarefas em 10 min já é um dia atípico. */
const LIMITE = { max: 20, janelaMs: 10 * 60_000 };

/**
 * Chamado pelo cliente (TarefasTab.tsx) logo depois de salvar uma tarefa com
 * uma atribuição NOVA — atribuir tarefa é uma ação de dentro do próprio app,
 * sem gatilho de servidor pra interceptar.
 *
 * ─── O NAVEGADOR SÓ DIZ QUAL TAREFA ─────────────────────────────────────
 *
 * A rota exigia acesso à operação e confiava em todo o resto do corpo: id,
 * destinatário, título, prioridade. Qualquer pessoa autorizada podia avisar
 * quem quisesse do que quisesse, e o dedupeKey com Date.now() fazia cada
 * retry ser um aviso novo. Agora só o taskId vem do cliente; quem recebe, o
 * texto e a prioridade saem do documento GRAVADO, e o aviso só existe se o banco
 * diz que ESTA pessoa atribuiu a tarefa há pouco (ver
 * lib/domain/atribuicao-de-tarefa). A identidade do aviso é a transição, então
 * repetir a chamada é retry (não duplica) e reatribuir depois avisa de novo.
 *
 * Vai só pro responsável (audiência do outbox), nunca pro time inteiro.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null) as { taskId?: unknown } | null;
  const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
  if (!ID_DE_TAREFA.test(taskId)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const db = getAdminDb();

  // Estar autenticado diz QUEM chama, não QUANTAS vezes pode chamar.
  const limite = await consumirLimiteDaChave(db, `tarefa:${gate.email}`, LIMITE);
  if (!limite.permitido) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limite.esperarSegundos) } },
    );
  }

  const snap = await db.collection("tarefas").doc(taskId).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });

  const avaliacao = avaliarAtribuicao({ ...(snap.data() as Task), id: taskId }, gate.email, Date.now());
  if (!avaliacao.ok) {
    // "Nada a avisar" (auto-atribuição, tarefa concluída) é sucesso; "você não atribuiu isto" é recusa.
    const recusa = avaliacao.motivo === "outra_pessoa_atribuiu" || avaliacao.motivo === "sem_transicao" || avaliacao.motivo === "transicao_antiga";
    return recusa
      ? NextResponse.json({ ok: false, error: "assignment_not_confirmed", motivo: avaliacao.motivo }, { status: 403 })
      : NextResponse.json({ ok: true, skipped: avaliacao.motivo });
  }

  // O responsável precisa enxergar tarefas: o member não lê a coleção (regras), então avisar seria empurrar
  // uma tarefa que a pessoa não consegue abrir. Sem acesso nenhum, idem.
  const acessoDoResponsavel = await db.collection("controleAcesso").doc(avaliacao.responsavel).get();
  if (!acessoDoResponsavel.exists) return NextResponse.json({ ok: true, skipped: "responsavel_sem_acesso" });
  const dados = acessoDoResponsavel.data() ?? {};
  const papel = papelDe(dados.role);
  const permissoes: PermissionTab[] = Array.isArray(dados.permissoesEdicao) ? dados.permissoesEdicao : [];
  if (!podeCapacidade(papel, permissoes, "ver_operacao")) {
    return NextResponse.json({ ok: true, skipped: "responsavel_sem_acesso_a_tarefas" });
  }

  const content = buildTaskAssignedContent(avaliacao.titulo, avaliacao.prioridade, avaliacao.prazo);
  const { eventId } = await createNotificationEventIdempotent({
    type: "task_assigned", severity: taskAssignedSeverity(avaliacao.prioridade), entityType: "task", entityId: taskId,
    dedupeKey: avaliacao.dedupeKey,
    title: content.title, body: content.body,
    deepLink: buildTaskDeepLink(taskId),
    financialState: "unavailable", // campo pensado pra venda; tarefa não tem dado financeiro
  }, db);

  const payload: SalePushPayload = {
    eventId, type: "task_assigned", title: content.title, body: content.body,
    tag: `task-${taskId}`, deepLink: buildTaskDeepLink(taskId), timestamp: new Date().toISOString(),
  };

  // Publica também quando o evento já existia: é o retry da MESMA transição, e o outbox não reenvia o que já foi aceito.
  const enviados = await enviarEPersistirEntrega(eventId, "task_assigned", payload, false, {
    audiencia: [avaliacao.responsavel], origem: "tarefa:atribuida",
  });
  return NextResponse.json({ ok: true, eventId, enviados });
}
