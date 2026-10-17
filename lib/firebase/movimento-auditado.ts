import { traduzirCaminho } from "./caminhos";
import { doc, getDoc, writeBatch, type Firestore } from "firebase/firestore";
import type { EstoqueMovimento } from "@/lib/domain/types";

/**
 * Movimentação de estoque e o seu registro de auditoria, NO MESMO LOTE — S20
 * da auditoria SaaS.
 *
 * O registro era uma escrita separada, depois, com o erro engolido
 * (`logAudit(...).catch(() => {})`): se falhasse, ou se o cliente nem
 * chamasse, a mudança no livro — que muda o custo médio e o lucro de vendas já
 * apuradas — ficava sem rastro. Agora as regras do Firestore (ver
 * `estoque_movimentos` em firestore.rules) RECUSAM a gravação sem o registro
 * junto, e o registro tem id determinístico pela versão:
 *
 *   criar   → mov_{id}_r1
 *   editar  → mov_{id}_r{revisao}      (revisao = anterior + 1)
 *   excluir → mov_{id}_excluido
 *
 * Injetável (`db`) pra ser provado contra o emulador com as regras de verdade.
 */

export type TextoDaAuditoria = { entidadeLabel: string; detalhe?: string };

type Acao = "criar" | "editar" | "excluir";

function registro(acao: Acao, movId: string, sufixo: string, email: string, texto: TextoDaAuditoria, agora: number) {
  const id = `mov_${movId}${sufixo}`;
  return {
    id,
    dados: {
      id, acao, entidade: "movimento", entidadeId: movId,
      entidadeLabel: String(texto.entidadeLabel || movId).slice(0, 200),
      ...(texto.detalhe ? { detalhe: String(texto.detalhe).slice(0, 500) } : {}),
      por: email, em: agora,
    },
  };
}

/** Remove `undefined` — o SDK recusa, e campo opcional ausente é o normal aqui. */
function semIndefinidos<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export async function criarMovimentoAuditado(
  db: Firestore,
  mov: Omit<EstoqueMovimento, "createdBy" | "createdAt" | "revisao">,
  email: string,
  texto: TextoDaAuditoria,
  agora = Date.now(),
): Promise<void> {
  const r = registro("criar", mov.id, "_r1", email, texto, agora);
  const lote = writeBatch(db);
  lote.set(doc(db, traduzirCaminho("estoque_movimentos"), mov.id), semIndefinidos({ ...mov, revisao: 1, createdBy: email, createdAt: agora }));
  lote.set(doc(db, traduzirCaminho("auditLog"), r.id), r.dados);
  await lote.commit();
}

export async function editarMovimentoAuditado(
  db: Firestore,
  atual: EstoqueMovimento,
  proxima: EstoqueMovimento,
  email: string,
  texto: TextoDaAuditoria,
  agora = Date.now(),
): Promise<void> {
  // A versão sai da que foi LIDA: se outra edição entrou no meio, a regra
  // recusa (revisao tem que ser a gravada + 1) em vez de sobrescrever calada.
  const revisao = (Number(atual.revisao) || 0) + 1;
  const r = registro("editar", atual.id, `_r${revisao}`, email, texto, agora);
  const lote = writeBatch(db);
  lote.set(doc(db, traduzirCaminho("estoque_movimentos"), atual.id), semIndefinidos({ ...proxima, revisao }));
  lote.set(doc(db, traduzirCaminho("auditLog"), r.id), r.dados);
  await lote.commit();
}

export async function excluirMovimentoAuditado(
  db: Firestore,
  movId: string,
  email: string,
  texto: TextoDaAuditoria,
  agora = Date.now(),
): Promise<void> {
  const r = registro("excluir", movId, "_excluido", email, texto, agora);
  const lote = writeBatch(db);
  lote.delete(doc(db, traduzirCaminho("estoque_movimentos"), movId));
  lote.set(doc(db, traduzirCaminho("auditLog"), r.id), r.dados);
  await lote.commit();
}

/**
 * Transferência entre dois produtos: as DUAS pernas do livro e os DOIS registros
 * de auditoria num lote só. Ou entra tudo ou não entra nada — a origem não pode
 * perder unidade sem o destino ganhar (nem o contrário), e é isso que um lote
 * garante e dois lançamentos separados não.
 *
 * As regras recusam cada movimento sem o seu registro (existsAfter dentro do
 * mesmo lote), então não há caminho de gravar uma perna sem rastro.
 */
export async function criarTransferenciaAuditada(
  db: Firestore,
  pernas: [
    Omit<EstoqueMovimento, "createdBy" | "createdAt" | "revisao">,
    Omit<EstoqueMovimento, "createdBy" | "createdAt" | "revisao">,
  ],
  email: string,
  textos: [TextoDaAuditoria, TextoDaAuditoria],
  agora = Date.now(),
): Promise<void> {
  /**
   * Repetir (retry depois de um timeout, duplo clique) não pode falhar nem
   * duplicar: gravar de novo num documento que já existe é um UPDATE, e as
   * regras exigem `revisao + 1` — a repetição seria recusada como "sem
   * permissão" com a transferência JÁ feita. As duas pernas vão no mesmo lote,
   * então a primeira existir com o mesmo id de transferência é prova de que
   * entraram as duas.
   */
  const ja = await getDoc(doc(db, traduzirCaminho("estoque_movimentos"), pernas[0].id));
  if (ja.exists() && ja.data()?.transferenciaId && ja.data()?.transferenciaId === pernas[0].transferenciaId) return;

  const lote = writeBatch(db);
  pernas.forEach((mov, i) => {
    const r = registro("criar", mov.id, "_r1", email, textos[i], agora);
    lote.set(doc(db, traduzirCaminho("estoque_movimentos"), mov.id), semIndefinidos({ ...mov, revisao: 1, createdBy: email, createdAt: agora }));
    lote.set(doc(db, traduzirCaminho("auditLog"), r.id), r.dados);
  });
  await lote.commit();
}
