import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import {
  registrarNaJanela,
  type DecisaoNaJanela,
  type JanelaDeVendas,
} from "@/lib/domain/janela-de-vendas";

/**
 * A janela de vendas rápidas, persistida — a política está em
 * lib/domain/janela-de-vendas.
 *
 * Duas coleções fechadas às regras do cliente (só o Admin SDK entra):
 *
 *  notification_janelas/{janelaId}   a janela: início, fim e os membros
 *  notification_janelas/_atual       ponteiro pra janela em curso
 *
 * O registro é UMA transação sobre o ponteiro e a janela. Duas vendas quase
 * simultâneas serializam (a segunda vê a primeira já contada), e a mesma venda
 * registrada duas vezes devolve a mesma posição — é o que faz o retry do
 * webhook não inflar a rajada.
 *
 * O documento do ponteiro tem o prefixo `_` de propósito: um id de janela é um
 * número, e o ponteiro nunca pode colidir com uma.
 */

const COLECAO = "notification_janelas";
const PONTEIRO = "_atual";
const ABORTED = 10;

/**
 * Refaz a transação abortada por contenção. Todas as vendas de uma rajada disputam
 * o MESMO par de documentos (ponteiro + janela), então sob rajada de verdade o
 * SDK pode esgotar as próprias tentativas: espera com jitter crescente e tenta de novo.
 */
async function comRetentativa<T>(fn: () => Promise<T>, tentativas = 10): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as { code?: number })?.code !== ABORTED || i >= tentativas) throw err;
      await new Promise((ok) => setTimeout(ok, 60 * i + Math.random() * 120 * i));
    }
  }
}

function janelaDe(id: string, d: FirebaseFirestore.DocumentData): JanelaDeVendas {
  return {
    id,
    inicio: Number(d.inicio),
    fim: Number(d.fim),
    membros: (d.membros ?? {}) as JanelaDeVendas["membros"],
  };
}

/**
 * Registra a venda na janela em curso (ou abre uma) e devolve a decisão.
 * Idempotente por `eventId`.
 */
export async function registrarVendaNaJanela(
  db: Firestore,
  venda: { eventId: string; gross: number },
  agora = Date.now(),
): Promise<DecisaoNaJanela> {
  const ponteiro = db.collection(COLECAO).doc(PONTEIRO);

  return comRetentativa(() => db.runTransaction(async (tx) => {
    const p = await tx.get(ponteiro);
    const idAtual = p.exists ? String(p.data()?.janelaId ?? "") : "";
    const docAtual = idAtual ? await tx.get(db.collection(COLECAO).doc(idAtual)) : null;
    const atual = docAtual?.exists ? janelaDe(idAtual, docAtual.data()!) : null;

    const { janela, decisao, jaEstava } = registrarNaJanela(atual, venda, agora);
    if (jaEstava) return decisao;

    tx.set(db.collection(COLECAO).doc(janela.id), {
      inicio: janela.inicio,
      fim: janela.fim,
      membros: janela.membros,
      atualizadoEm: agora,
    });
    if (janela.id !== idAtual) tx.set(ponteiro, { janelaId: janela.id });
    return decisao;
  }));
}

/** A janela, como está agora — o resumo de fechamento lê o número FINAL daqui no momento de enviar. */
export async function lerJanela(db: Firestore, janelaId: string): Promise<JanelaDeVendas | null> {
  const snap = await db.collection(COLECAO).doc(janelaId).get();
  return snap.exists ? janelaDe(janelaId, snap.data()!) : null;
}

/** Apaga janelas antigas (a retenção do resto do outbox). Nunca toca no ponteiro. */
export async function limparJanelasAntigas(db: Firestore, agora = Date.now(), retencaoMs = 14 * 24 * 3600 * 1000): Promise<number> {
  const antigas = await db.collection(COLECAO).where("fim", "<", agora - retencaoMs).limit(200).get();
  const lote = db.batch();
  antigas.docs.forEach((d) => { if (d.id !== PONTEIRO) lote.delete(d.ref); });
  if (antigas.size > 0) await lote.commit();
  return antigas.size;
}
