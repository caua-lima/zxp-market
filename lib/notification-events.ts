import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { NotificationEvent } from "@/lib/domain/notifications";
import {
  COLECAO_EVENTOS,
  COLECAO_EVENTOS_PUBLICA,
  redigirEvento,
} from "@/lib/domain/notificacao-publico";

const COL = COLECAO_EVENTOS;

/**
 * O Admin SDK, ao contrário do client SDK usado em lib/firebase/data.ts,
 * REJEITA `undefined` em qualquer campo — `ref.create()` lança erro em vez de
 * ignorar o campo. `estimatedProfit`/`estimatedMargin` chegam `undefined` em
 * toda venda sem produto cadastrado (o caso que este app trata com um texto
 * próprio, "Venda de produto sem cadastro"), então sem isto o evento dessas
 * vendas nunca seria criado — a exceção subiria e derrubaria o webhook
 * inteiro pra essa venda específica. Mesmo padrão que sanitizeUndefined em
 * lib/firebase/data.ts, só que pro lado admin.
 */
function sanitizeUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

export type NewNotificationEvent = Omit<NotificationEvent, "id" | "createdAt" | "readBy" | "dismissedBy" | "delivery">;

/**
 * Cria o evento de forma idempotente: o `dedupeKey` (ex.: "sale_paid:2000123456")
 * É o id do documento, e `DocumentReference.create()` falha se o doc já
 * existir. Isso substitui o padrão antigo de "lê o campo notifiedPush numa
 * transação" por algo mais simples e igualmente atômico — o próprio
 * Firestore garante que só UMA chamada concorrente cria o doc, sem precisar
 * ler antes.
 *
 * Retorna `created: false` quando o evento já existia (retry do webhook do
 * ML, ou duas chamadas quase simultâneas pro mesmo pedido) — quem chama deve
 * pular o envio de push nesse caso, mas o evento em si já está lá, intacto.
 */
export async function createNotificationEventIdempotent(
  input: NewNotificationEvent,
): Promise<{ created: boolean; eventId: string }> {
  const db = getAdminDb();
  const ref = db.collection(COL).doc(input.dedupeKey);
  const completo = sanitizeUndefined({
    ...input,
    id: input.dedupeKey,
    createdAt: FieldValue.serverTimestamp(),
  });
  try {
    await ref.create(completo);
    /**
     * Espelho redigido, pra quem nao pode ver financeiro.
     *
     * As regras do Firestore sao por DOCUMENTO: nao da pra liberar o evento e
     * esconder grossAmount/estimatedProfit/estimatedMargin dentro dele. Entao
     * o `member` lia tudo — pela Central e pelo SDK. Aqui nasce a versao sem
     * dinheiro, que e a unica que ele alcanca.
     *
     * Escrito DEPOIS do create original de proposito: o `create()` e o que
     * garante a idempotencia, e um espelho que falhe nao pode fazer o evento
     * (e o push) sumirem. `set` sem merge deixa o espelho convergir num
     * eventual retry.
     */
    await db.collection(COLECAO_EVENTOS_PUBLICA).doc(input.dedupeKey)
      .set(sanitizeUndefined(redigirEvento(completo as Partial<NotificationEvent>)))
      .catch(() => {});
    return { created: true, eventId: input.dedupeKey };
  } catch (err) {
    // ALREADY_EXISTS (code 6) é o caso esperado de retry — qualquer outro
    // erro (permissão, rede) precisa subir de verdade pra quem chamou saber.
    const code = (err as { code?: number })?.code;
    if (code === 6) return { created: false, eventId: input.dedupeKey };
    throw err;
  }
}

/** Registra a tentativa de push — chamado ANTES de enviar, pra existir rastro mesmo se o envio falhar no meio do caminho. */
export async function markPushAttempted(eventId: string): Promise<void> {
  await getAdminDb().collection(COL).doc(eventId).update({
    "delivery.pushAttemptedAt": FieldValue.serverTimestamp(),
  }).catch(() => {});
}

/** Sucesso: pelo menos um dispositivo recebeu. */
export async function markPushDelivered(eventId: string): Promise<void> {
  await getAdminDb().collection(COL).doc(eventId).update({
    "delivery.pushDeliveredAt": FieldValue.serverTimestamp(),
  }).catch(() => {});
}

/**
 * Erro registrado é só um resumo curto (ex.: "sem dispositivos", "3/5 tokens
 * inválidos") — nunca o token FCM nem qualquer payload completo, pra não
 * vazar dado sensível num campo que fica lido por qualquer autorizado.
 */
export async function markPushError(eventId: string, resumoErro: string): Promise<void> {
  await getAdminDb().collection(COL).doc(eventId).update({
    "delivery.pushError": resumoErro.slice(0, 200),
  }).catch(() => {});
}

/**
 * O estado de entrega de um evento, pra decidir se ainda há o que enviar.
 *
 * Existe porque criação e ENTREGA eram a mesma coisa: evento criado com o
 * envio falhando logo depois ficava sem entrega, e a tentativa seguinte via
 * `created: false` e desistia. O push sumia em silêncio, pra sempre.
 */
export async function lerEntrega(eventId: string): Promise<{
  existe: boolean;
  delivery: Record<string, unknown> | null;
  criadoEm: number;
}> {
  const snap = await getAdminDb().collection(COL).doc(eventId).get();
  if (!snap.exists) return { existe: false, delivery: null, criadoEm: 0 };
  const d = snap.data() ?? {};
  const criado = d.createdAt;
  // `createdAt` é serverTimestamp na escrita e Timestamp na leitura.
  const criadoEm = criado && typeof (criado as { toMillis?: unknown }).toMillis === "function"
    ? (criado as { toMillis: () => number }).toMillis()
    : Number(criado ?? 0) || 0;
  return { existe: true, delivery: (d.delivery as Record<string, unknown>) ?? null, criadoEm };
}

/** Aplica um patch de entrega. Caminhos com ponto são de propósito: são campos aninhados em `delivery`. */
export async function aplicarPatchEntrega(eventId: string, patch: Record<string, unknown>): Promise<void> {
  await getAdminDb().collection(COL).doc(eventId).update(patch).catch(() => {});
}
