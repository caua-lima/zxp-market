import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Poda do `webhook_log`.
 *
 * ─── POR QUE PRECISOU ───────────────────────────────────────────────────
 *
 * A trilha do webhook foi criada pra responder "o ML chamou ou não?", e o
 * comentário dela dizia que crescer sem limite não era problema, porque cada
 * doc é minúsculo e o volume é o de vendas. Medido: 9.906 documentos, contra
 * 1.100 de `ml_orders` e 515 de `notification_events`. É a maior coleção da
 * base, com folga — o ML chama várias vezes por pedido (criação, pagamento,
 * cada mudança de envio), então o volume é o de EVENTOS, não o de vendas.
 *
 * Some-se a isso que o webhook é público por natureza (o ML não assina as
 * chamadas), e a coleção vira uma gravação ilimitada acionável de fora.
 *
 * ─── POR QUE 30 DIAS ────────────────────────────────────────────────────
 *
 * A trilha serve pra diagnosticar "não chegou notificação", e essa pergunta
 * é sempre sobre algo recente — ninguém investiga um push de dois meses
 * atrás. 30 dias cobre com folga qualquer investigação real e ainda segura
 * o tamanho num patamar previsível.
 */
export const RETENCAO_DIAS = 30;

/**
 * Teto por execução: apagar 10 mil docs de uma vez estouraria o tempo da
 * função. Com o cron diário, a poda alcança o atraso em poucos dias e depois
 * só remove o do dia — e nunca corre risco de derrubar o resto do cron.
 */
const TETO_POR_EXECUCAO = 2000;
const LOTE = 400;

export type ResultadoPoda = { apagados: number; restaram: number | null; erro?: string };

export async function podarWebhookLog(agora: number = Date.now()): Promise<ResultadoPoda> {
  const db = getAdminDb();
  const limite = agora - RETENCAO_DIAS * 86400000;
  let apagados = 0;

  try {
    while (apagados < TETO_POR_EXECUCAO) {
      const snap = await db.collection("webhook_log")
        .where("ts", "<", limite)
        .limit(LOTE)
        .get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      apagados += snap.size;

      // Lote incompleto = acabou o que havia pra apagar.
      if (snap.size < LOTE) break;
    }

    /**
     * Quantos sobraram acima do limite, pra dar pra ver na resposta do cron se
     * a poda está alcançando o acúmulo ou ficando pra trás.
     */
    const resto = await db.collection("webhook_log").where("ts", "<", limite).count().get();
    return { apagados, restaram: resto.data().count };
  } catch (err) {
    // Best-effort como todo passo do cron: limpeza nunca derruba o resto.
    return { apagados, restaram: null, erro: err instanceof Error ? err.message : String(err) };
  }
}
