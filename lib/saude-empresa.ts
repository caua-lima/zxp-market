import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { diasAte, type SinaisDeSaude } from "@/lib/domain/saude";
import { getMlTokenStatus } from "@/app/api/ml/token";
import { tenantAtual } from "@/lib/firebase/contexto-tenant";

/**
 * Os sinais de saúde da empresa da requisição (Etapa 4). Só contagens e
 * carimbos — nada de conteúdo de venda. Consultas de um campo só (índice
 * automático do Firestore).
 */
export async function lerSinaisDeSaude(agora = Date.now()): Promise<SinaisDeSaude> {
  const db = getAdminDb();
  const estado = db.collection("cron_estado");
  const inbox = db.collection("ml_webhook_inbox");
  const conta = (q: FirebaseFirestore.Query) => q.count().get().then((s) => s.data().count).catch(() => 0);
  const dias = diasAte(agora, 7);
  const t = tenantAtual();

  const [cron, worker, token, pendentes, falhas, entregas, contadores, empresa] = await Promise.all([
    estado.doc("ultima_execucao").get(),
    estado.doc("worker").get(),
    getMlTokenStatus().catch(() => ({ connected: false })),
    conta(inbox.where("estado", "==", "pendente")),
    conta(inbox.where("estado", "==", "falhou")),
    conta(db.collection("notification_entregas").where("estado", "==", "pendente")),
    db.getAll(...dias.map((d) => estado.doc(`ml_saude_${d}`))),
    t ? db.doc(`tenants/${t}`).get() : Promise.resolve(null),
  ]);

  const soma = (campo: string) => contadores.reduce((s, d) => s + Number(d.data()?.[campo] ?? 0), 0);
  return {
    agora,
    cronEm: typeof cron.data()?.em === "number" ? cron.data()!.em : null,
    workerEm: typeof worker.data()?.em === "number" ? worker.data()!.em : null,
    mlConectado: Boolean(token.connected),
    inboxPendentes: pendentes,
    inboxFalhas: falhas,
    entregasPendentes: entregas,
    ml429: soma("s429"),
    ml5xx: soma("s5xx"),
    mlTimeouts: soma("timeouts"),
    bloqueada: Boolean(empresa?.data()?.bloqueio),
  };
}
