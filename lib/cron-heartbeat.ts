import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Registro da última execução do cron diário.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * O cron carrega cinco automações de uma vez: backup semanal, marcos,
 * alerta de estoque, lembrete de prazo das tarefas e aviso de devolução.
 * Quando ele não roda, nenhuma delas roda — e o sintoma é AUSÊNCIA, que não
 * dispara alarme nenhum. Foi exatamente o que aconteceu: `backups_semanais`
 * vazio, zero marcos, zero lembretes, zero alertas de estoque, todos
 * simultaneamente, e nada em lugar nenhum dizendo que o cron não passava.
 *
 * Um carimbo por execução transforma "não recebi notificação" (sintoma
 * ambíguo, que pode ser preferência, aparelho, regra de negócio ou cron) na
 * pergunta objetiva "o cron rodou ontem?".
 *
 * Best-effort: se o carimbo falhar, o cron segue. Ele serve pra diagnóstico,
 * e diagnóstico não pode derrubar o que diagnostica.
 */

const COLECAO = "cron_estado";
const DOC = "ultima_execucao";

export type ExecucaoDoCron = {
  em: number;
  /** Resumo do que a execução conseguiu fazer — o suficiente pra saber se foi completa. */
  resumo: Record<string, unknown>;
};

/**
 * @param executor qual execução carimbar. O padrão é o cron diário; o worker
 *   frequente (S09, app/api/worker) tem o próprio carimbo, porque as duas
 *   perguntas são diferentes: "o cron rodou ontem?" e "o worker está rodando?".
 */
export async function registrarExecucaoDoCron(resumo: Record<string, unknown>, executor: string = DOC): Promise<void> {
  try {
    await getAdminDb().collection(COLECAO).doc(executor).set({
      em: Date.now(),
      emISO: new Date().toISOString(),
      resumo,
    });
  } catch (err) {
    console.error("[cron] nao consegui registrar a execucao", err);
  }
}

export async function lerUltimaExecucaoDoCron(executor: string = DOC): Promise<ExecucaoDoCron | null> {
  try {
    const d = await getAdminDb().collection(COLECAO).doc(executor).get();
    if (!d.exists) return null;
    const x = d.data() ?? {};
    return { em: Number(x.em ?? 0), resumo: (x.resumo as Record<string, unknown>) ?? {} };
  } catch {
    return null;
  }
}
