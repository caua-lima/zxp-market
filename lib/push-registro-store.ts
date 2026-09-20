import "server-only";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  alvosDoDesvinculo,
  planejarVinculo,
  type EntradaValida,
  type RegistroDePush,
} from "@/lib/domain/push-registro";

/**
 * Leitura e escrita do registro de push no Firestore, com as invariantes de
 * lib/domain/push-registro aplicadas DENTRO de uma transação.
 *
 * Recebe o `db` por parâmetro (em vez de chamar getAdminDb) pra ser testado
 * contra o emulador do Firestore sem tocar no app.
 */

const COLECAO = "pushTokens";

const ABORTED = 10;

/**
 * Refaz a operação quando a transação é abortada por contenção.
 *
 * O SDK já reexecuta a transação algumas vezes; sob muitos escritores no MESMO
 * documento (o login e a reconciliação de duas abas, ou de duas contas, no
 * mesmo navegador) ainda pode esgotar e devolver ABORTED. Isso é contenção, não
 * erro: esperar um pouco, com jitter, e tentar de novo resolve — e devolver 500
 * ao navegador só o obrigaria a repetir a chamada.
 */
async function comRetentativaDeContencao<T>(fn: () => Promise<T>, tentativas = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as { code?: number })?.code !== ABORTED || i >= tentativas) throw err;
      await new Promise((ok) => setTimeout(ok, 50 * i + Math.random() * 100));
    }
  }
}

function registroDe(d: QueryDocumentSnapshot): RegistroDePush {
  const x = d.data() ?? {};
  return {
    docId: d.id,
    email: String(x.email ?? ""),
    token: String(x.token ?? d.id), // legado: o id era o próprio token
    deviceId: String(x.deviceId ?? ""),
    updatedAt: Number(x.updatedAt ?? x.createdAt ?? 0),
  };
}

/**
 * Vincula o token à pessoa: grava o registro (pessoa, instalação) e apaga, na
 * MESMA transação, o que as invariantes mandam apagar.
 *
 * Transação porque duas abas (ou o login e a reconciliação) podem vincular ao
 * mesmo tempo, e o resultado não pode depender de quem chegou primeiro.
 * Devolve quantos registros saíram.
 */
export async function vincularToken(
  db: Firestore,
  email: string,
  entrada: EntradaValida,
  userAgent: string,
  agora = Date.now(),
): Promise<{ removidos: number }> {
  const col = db.collection(COLECAO);
  const dono = email.toLowerCase();

  const removidos = await comRetentativaDeContencao(() => db.runTransaction(async (tx) => {
    // Os dois conjuntos que as invariantes precisam ver: quem já tem ESTE token
    // (troca de dono, legado) e os registros DESTA pessoa (teto por pessoa).
    const [porToken, porEmail] = await Promise.all([
      tx.get(col.where("token", "==", entrada.token)),
      tx.get(col.where("email", "==", dono)),
    ]);
    const vistos = new Map<string, RegistroDePush>();
    for (const d of [...porToken.docs, ...porEmail.docs]) vistos.set(d.id, registroDe(d));

    const plano = planejarVinculo([...vistos.values()], { ...entrada, email: dono });
    const existia = vistos.has(plano.gravarId);

    tx.set(col.doc(plano.gravarId), {
      email: dono,
      token: entrada.token,
      deviceId: entrada.deviceId,
      updatedAt: agora,
      // O Admin SDK rejeita `undefined`, então o campo só entra quando existe.
      ...(existia ? {} : { createdAt: agora }),
      userAgent,
    }, { merge: true });
    for (const a of plano.apagar) tx.delete(col.doc(a.docId));
    return plano.apagar.length;
  }));

  return { removidos };
}

/** Apaga o que o critério alcança (ver alvosDoDesvinculo). Devolve quantos saíram. */
export async function desvincular(
  db: Firestore,
  criterio: { email?: string; deviceId?: string; token?: string },
): Promise<{ removidos: number }> {
  const col = db.collection(COLECAO);
  const candidatos = new Map<string, RegistroDePush>();
  if (criterio.token) {
    for (const d of (await col.where("token", "==", criterio.token).get()).docs) candidatos.set(d.id, registroDe(d));
  }
  if (criterio.email && criterio.deviceId) {
    for (const d of (await col.where("email", "==", criterio.email.toLowerCase()).get()).docs) candidatos.set(d.id, registroDe(d));
  }

  const alvos = alvosDoDesvinculo([...candidatos.values()], criterio);
  if (alvos.length > 0) {
    const lote = db.batch();
    for (const id of alvos) lote.delete(col.doc(id));
    await lote.commit();
  }
  return { removidos: alvos.length };
}
