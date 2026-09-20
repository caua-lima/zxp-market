import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { consumirLimite, type EstadoDoLimite, type ResultadoDoLimite } from "@/lib/domain/limite-de-taxa";

const COLECAO = "notification_limites";
const ABORTED = 10;

/** Chave segura como id de documento (sem `/`, sem comprimento absurdo). */
function idDe(chave: string): string {
  return chave.replace(/\//g, "_").slice(0, 200);
}

/**
 * Consome uma unidade do limite `chave`, numa transação: duas chamadas
 * simultâneas serializam, e a segunda vê a primeira já contada. Sem a
 * transação, dez chamadas em paralelo leriam "0" juntas e passariam todas.
 */
export async function consumirLimiteDaChave(
  db: Firestore,
  chave: string,
  cfg: { max: number; janelaMs: number },
  agora = Date.now(),
): Promise<ResultadoDoLimite> {
  const ref = db.collection(COLECAO).doc(idDe(chave));
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.data();
        const atual: EstadoDoLimite | null = snap.exists
          ? { inicio: Number(d?.inicio ?? 0), contagem: Number(d?.contagem ?? 0) }
          : null;
        const r = consumirLimite(atual, agora, cfg);
        if (r.permitido) tx.set(ref, { inicio: r.estado.inicio, contagem: r.estado.contagem });
        return r;
      });
    } catch (err) {
      if ((err as { code?: number })?.code !== ABORTED || tentativa >= 6) throw err;
      await new Promise((ok) => setTimeout(ok, 40 * tentativa + Math.random() * 80));
    }
  }
}
