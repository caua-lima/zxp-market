import { getAdminDb } from "@/lib/firebase/admin";
import { criarEventoEPublicar, especDoPush } from "@/lib/notification-dispatch";
import { buildTaskDeepLink, type SalePushPayload } from "@/lib/domain/notifications";
import { agruparLembretes, textoLembrete, type TarefaPrazo } from "@/lib/domain/task-reminders";

/**
 * Varredura diária de prazo das tarefas — o lado de I/O do
 * lib/domain/task-reminders.ts (que é puro e tem os testes).
 *
 * Roda pendurado no cron das 9h (app/api/ml/cron/route.ts) em vez de virar um
 * cron próprio: o plano Hobby da Vercel só aceita cron diário, e cada entrada
 * nova em vercel.json é mais superfície pra quebrar o deploy inteiro. Como já
 * existe uma execução diária de manhã, o lembrete pega carona nela.
 *
 * Best-effort por decisão: se isto falhar, a sincronização de pedidos do cron
 * NÃO pode cair junto. Lembrete de tarefa é útil; pedido desatualizado é grave.
 */

/** Dia de hoje no fuso de São Paulo, "yyyy-mm-dd". */
function diaBR(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

export type ResultadoLembretes = {
  dia: string;
  pessoas: number;
  enviados: number;
  jaAvisadoHoje: number;
};

export async function enviarLembretesDeTarefa(diaForcado?: string): Promise<ResultadoLembretes> {
  const dia = diaForcado ?? diaBR();
  const db = getAdminDb();

  // Só o que pode virar lembrete: tarefa aberta e COM prazo. O filtro de
  // status fica no Firestore (corta a maior parte, já que quadro antigo é
  // quase todo "done") e o resto da regra fica no módulo puro.
  const snap = await db.collection("tarefas").where("status", "in", ["todo", "doing"]).limit(500).get();
  const tarefas: TarefaPrazo[] = snap.docs.map((d) => {
    const t = d.data() as Partial<TarefaPrazo>;
    return {
      id: String(t.id ?? d.id),
      title: String(t.title ?? "Tarefa"),
      status: (t.status ?? "todo") as TarefaPrazo["status"],
      priority: t.priority,
      dueDate: t.dueDate,
      assignedTo: t.assignedTo,
    };
  });

  const grupos = agruparLembretes(tarefas, dia);
  let enviados = 0;
  let jaAvisadoHoje = 0;

  for (const grupo of grupos) {
    const texto = textoLembrete(grupo, dia);
    if (!texto) continue;

    // Uma notificação por pessoa POR DIA: o dedupeKey vira o id do documento,
    // então o próprio Firestore garante que a segunda execução do dia (retry
    // do cron, disparo manual pra testar) não avise de novo.
    const dedupeKey = `task_due:${grupo.email}:${dia}`;
    const destaque = grupo.atrasadas[0] ?? grupo.venceHoje[0];

    // Tipo PRÓPRIO ("task_due"): "vence hoje" e "te atribuíram" são coisas diferentes, e o feed
    // é da pessoa — o lembrete dela não aparece na Central de ninguém mais.
    const payload: SalePushPayload = {
      eventId: dedupeKey, type: "task_due", title: texto.title, body: texto.body,
      tag: `task-due-${dia}`, deepLink: buildTaskDeepLink(destaque.id),
      timestamp: new Date().toISOString(),
    };

    /**
     * Publica mesmo quando o evento do dia já existia. O `continue` que havia
     * aqui tratava "já existe" como "já foi avisado": se o primeiro envio
     * falhasse, a segunda execução do dia (retry do cron, disparo manual) não
     * tentava de novo e a pessoa ficava sem o lembrete. O outbox garante que o
     * que já foi aceito não é reenviado. Evento e push no mesmo lote (S09).
     */
    const { enviados: n } = await criarEventoEPublicar({
      type: "task_due",
      severity: grupo.atrasadas.length > 0 ? "warning" : "info",
      entityType: "task", entityId: destaque.id, dedupeKey,
      title: texto.title, body: texto.body,
      deepLink: buildTaskDeepLink(destaque.id),
      financialState: "unavailable",
    }, especDoPush(dedupeKey, "task_due", payload, false, {
      audiencia: [grupo.email], origem: "tarefa:lembrete", atualizaEvento: false,
    }), { audiencia: [grupo.email] });
    if (n > 0) enviados += n;
    else jaAvisadoHoje++;
  }

  return { dia, pessoas: grupos.length, enviados, jaAvisadoHoje };
}
