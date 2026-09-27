import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type Firestore,
} from "firebase/firestore";

/**
 * Paginação de verdade pras listas longas — S22 da auditoria SaaS.
 *
 * `watchMovimentos` (1500) e `watchTasks` (500) leem só a primeira página. O
 * S22 parcial tornou o corte VISÍVEL; isto torna o resto ALCANÇÁVEL: a tela
 * pede a página seguinte a partir do último item que já mostra.
 *
 * ─── POR QUE O CURSOR TEM O ID ──────────────────────────────────────────
 *
 * `data` das movimentações é só o dia (AAAA-MM-DD): dezenas empatam. Continuar
 * "depois de 2026-09-20" pularia as outras do mesmo dia que não couberam na
 * página; continuar "a partir de" repetiria as que já vieram. O par (valor,
 * id do documento) é único, e é a mesma ordem que a primeira página já usa (o
 * Firestore desempata pelo id na mesma direção) — então as páginas emendam sem
 * buraco nem repetição. E não pede índice composto: ordenar por um campo e
 * pelo id na mesma direção usa o índice de campo único.
 *
 * Injetável (`db`) pra ser testado contra o emulador — o `getFirebase()` do app
 * exige `window`.
 */

export type Pagina<T> = { itens: T[]; /** Pode haver mais depois desta página. */ temMais: boolean };

export async function paginaApos<T extends { id: string }>(
  db: Firestore,
  colecao: string,
  campo: string,
  ultimo: { id: string; valor: string | number },
  tamanho: number,
): Promise<Pagina<T>> {
  const snap = await getDocs(query(
    collection(db, colecao),
    orderBy(campo, "desc"),
    orderBy(documentId(), "desc"),
    startAfter(ultimo.valor, ultimo.id),
    // Um a mais que o pedido: é assim que se sabe se há outra página sem
    // uma segunda leitura.
    limit(tamanho + 1),
  ));
  const docs = snap.docs.slice(0, tamanho);
  return {
    itens: docs.map((d) => ({ ...(d.data() as Omit<T, "id">), id: d.id }) as T),
    temMais: snap.docs.length > tamanho,
  };
}
