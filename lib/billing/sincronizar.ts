import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  bloqueioPara,
  deStatusDoProvedor,
  type Assinatura,
} from "@/lib/domain/assinatura";
import type { EventoDoProvedor, ProvedorDeCobranca } from "./provedor";

/**
 * Do Stripe pra empresa (S25).
 *
 * ─── POR QUE BUSCAR A ASSINATURA EM VEZ DE LER O EVENTO ─────────────────
 *
 * O Stripe não garante ORDEM de entrega: um `subscription.updated` antigo pode
 * chegar depois de um novo, e reentrega o mesmo evento se não recebeu 200.
 * Aplicar o conteúdo do evento faria um estado velho cobrir um novo. Então o
 * evento só diz QUAL assinatura mudou; o estado vem de GET na assinatura
 * (canônico, sempre o atual), e a gravação só acontece se a leitura for mais
 * nova que a gravada (`sincronizadoEm`).
 *
 * ─── DURÁVEL E IDEMPOTENTE ──────────────────────────────────────────────
 *
 * `billing_eventos/{id}` marca recebido → processado. Evento já processado
 * responde 200 sem refazer. Se o processamento falhar, a rota responde 500 e o
 * Stripe reentrega (até 3 dias); o registro "recebido" não impede o reprocesso.
 * E a reconciliação diária (cron) busca de novo toda assinatura, mesmo sem evento.
 */

export const COLECAO_EVENTOS = "billing_eventos";

/** Grava a assinatura e o bloqueio da empresa, se a leitura for mais nova que a gravada. */
export async function aplicarAssinatura(db: Firestore, tenantId: string, nova: Assinatura, agora: number): Promise<"gravada" | "mais_velha" | "sem_empresa"> {
  const ref = db.doc(`tenants/${tenantId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "sem_empresa";
    const atual = snap.data()?.assinatura as Assinatura | undefined;
    if (atual?.sincronizadoEm != null && nova.sincronizadoEm != null && atual.sincronizadoEm > nova.sincronizadoEm) return "mais_velha";
    const bloqueio = bloqueioPara(nova, agora);
    tx.update(ref, { assinatura: nova, bloqueio: bloqueio ?? FieldValue.delete() });
    return "gravada";
  });
}

export type ResultadoDoEvento = "processado" | "duplicado" | "ignorado";

/** Tipos que mudam assinatura. O resto responde 200 e é ignorado. */
const TIPOS_RELEVANTES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
]);

export async function processarEvento(
  db: Firestore,
  provedor: ProvedorDeCobranca,
  evento: EventoDoProvedor,
  opcoes: { agora: number; env: Record<string, string | undefined> },
): Promise<ResultadoDoEvento> {
  const ref = db.collection(COLECAO_EVENTOS).doc(evento.id);
  const ja = await ref.get();
  if (ja.data()?.estado === "processado") return "duplicado";

  if (!TIPOS_RELEVANTES.has(evento.tipo) || !evento.assinaturaId) {
    await ref.set({ tipo: evento.tipo, estado: "processado", ignorado: true, em: opcoes.agora });
    return "ignorado";
  }
  await ref.set({ tipo: evento.tipo, estado: "recebido", em: opcoes.agora, assinaturaId: evento.assinaturaId }, { merge: true });

  const sub = await provedor.buscarAssinatura(evento.assinaturaId);
  const tenantId = sub.tenantId ?? evento.tenantId;
  if (!tenantId || !/^[a-z0-9-]{2,60}$/.test(tenantId)) {
    // Assinatura sem empresa: criada fora do checkout do app. Não é nossa pra aplicar.
    await ref.set({ estado: "processado", ignorado: true, motivo: "sem_empresa" }, { merge: true });
    return "ignorado";
  }
  const anterior = (await db.doc(`tenants/${tenantId}`).get()).data()?.assinatura as Assinatura | undefined;
  const nova = deStatusDoProvedor(sub, anterior, opcoes);
  const r = await aplicarAssinatura(db, tenantId, nova, opcoes.agora);
  await ref.set({ estado: "processado", tenantId, resultado: r, processadoEm: Date.now() }, { merge: true });
  return "processado";
}

/**
 * Reconciliação de UMA empresa (cron diário): busca a assinatura no Stripe, se
 * houver; senão só reaplica o relógio (trial que venceu, carência que acabou).
 */
export async function reconciliarEmpresa(
  db: Firestore,
  provedor: ProvedorDeCobranca | null,
  tenantId: string,
  opcoes: { agora: number; env: Record<string, string | undefined> },
): Promise<"buscada" | "relogio" | "sem_mudanca"> {
  const ref = db.doc(`tenants/${tenantId}`);
  const dados = (await ref.get()).data() ?? {};
  const atual = dados.assinatura as Assinatura | undefined;
  if (provedor && atual?.assinaturaId) {
    const sub = await provedor.buscarAssinatura(atual.assinaturaId);
    await aplicarAssinatura(db, tenantId, deStatusDoProvedor(sub, atual, opcoes), opcoes.agora);
    return "buscada";
  }
  const deveria = bloqueioPara(atual, opcoes.agora);
  const tem = dados.bloqueio as { motivo?: string } | undefined;
  if ((deveria?.motivo ?? null) === (tem?.motivo ?? null)) return "sem_mudanca";
  await ref.update({ bloqueio: deveria ?? FieldValue.delete() });
  return "relogio";
}
