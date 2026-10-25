import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { tenantAtual } from "@/lib/firebase/contexto-tenant";
import { sinalDoPedido, type EstadoParaSinal, type SinalAoVivo } from "@/lib/domain/ao-vivo-tempo-real";

/**
 * O lado do servidor das vendas ao vivo em tempo real. O webhook chama logo
 * depois de gravar o pedido (lib/ml/webhook-inbox.ts):
 *
 * `publicarSinalAoVivo` escreve `ao_vivo/sinal`. A barra de quem está com o
 * app aberto escuta esse documento e soma a venda na hora. (Com o app fechado,
 * quem mostra o dia é o widget do iPhone — ver lib/domain/widget-script.ts.)
 *
 * É melhor-esforço: falhar aqui nunca impede o pedido de ser gravado
 * nem o aviso da venda de sair. A barra continua relendo o ML sozinha.
 */

/** A empresa do momento (a da requisição/webhook) — a mesma chave que a rota usa. */
export function empresaDoAoVivo(): string {
  return tenantAtual() ?? "raiz";
}

/** Publica o sinal se o pedido mudou algo que a barra mostra. Devolve o sinal, ou `null`. */
export async function publicarSinalAoVivo(
  db: FirebaseFirestore.Firestore,
  estado: EstadoParaSinal,
  antes: { status?: unknown } | undefined,
  agora = Date.now(),
): Promise<Omit<SinalAoVivo, "seq"> | null> {
  const sinal = sinalDoPedido(estado, antes, agora);
  if (!sinal) return null;
  // `seq` sobe a cada sinal: duas vendas iguais seguidas ainda são duas mudanças pro app.
  await db.collection("ao_vivo").doc("sinal").set({ ...sinal, seq: FieldValue.increment(1) }, { merge: true });
  return sinal;
}
