"use client";

import {
  FieldPath,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  updateDoc,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { NotificationEvent } from "@/lib/domain/notifications";
import {
  COLECAO_EVENTOS,
  COLECAO_EVENTOS_PUBLICA,
  COLECAO_FEED,
} from "@/lib/domain/notificacao-publico";
import { TAMANHO_DA_PAGINA, normalizarItemPessoal } from "@/lib/domain/central-feed";
import { getFirebase } from "./client";

/**
 * Leitura e marcação da Central de Notificações.
 *
 * O evento em si (criação, classificação, delivery de push) é escrito só pelo
 * backend (ver lib/notification-events.ts) — aqui é leitura + marcar lido/
 * dispensado, os únicos campos que firestore.rules deixa o cliente tocar.
 *
 * Há DUAS fontes, e a diferença é de privacidade, não de estilo:
 *  - "time": as coleções compartilhadas (vendas, alertas). Quem não vê
 *    financeiro escuta o espelho redigido (as regras são por documento);
 *  - "pessoal": o feed direcionado da própria pessoa (tarefa, prazo, teste),
 *    no caminho notification_feed/{email}/itens — a regra decide pelo CAMINHO.
 */

export type FonteDoFeed =
  | { tipo: "time"; colecao: string }
  | { tipo: "pessoal"; email: string };

export type PaginaDoFeed = {
  itens: NotificationEvent[];
  /** O snapshot veio do cache local (offline, ou ainda sincronizando), não do servidor. */
  doCache: boolean;
  /** Há avisos mais antigos que os retornados. */
  temMais: boolean;
  /** Onde a próxima página continua. */
  cursor: QueryDocumentSnapshot | null;
};

function refDaFonte(f: FonteDoFeed) {
  const { db } = getFirebase();
  return f.tipo === "time"
    ? collection(db, f.colecao)
    : collection(db, COLECAO_FEED, f.email.toLowerCase(), "itens");
}

function paraPagina(f: FonteDoFeed, docs: QueryDocumentSnapshot[], max: number, doCache: boolean): PaginaDoFeed {
  const visiveis = docs.slice(0, max);
  return {
    itens: visiveis.map((d) => {
      const dados = d.data() as Record<string, unknown>;
      return f.tipo === "pessoal" ? normalizarItemPessoal(dados, f.email.toLowerCase()) : (dados as unknown as NotificationEvent);
    }),
    doCache,
    // Pede max+1 e devolve max: o "+1" é só pra saber se existe mais, sem uma segunda consulta.
    temMais: docs.length > max,
    cursor: visiveis[visiveis.length - 1] ?? null,
  };
}

/**
 * Escuta os `max` avisos mais recentes de uma fonte.
 *
 * O limite é de propósito — sem ele o listener ficaria mais caro a cada aviso
 * novo (é o requisito explícito da Fase 7: nunca um listener global sem
 * limite). O que os limita NÃO pode ser escondido: `temMais` diz que há mais, e
 * `carregarMais` busca as páginas antigas. `onErro` recebe a falha — permissão,
 * rede — em vez de a lista ficar vazia como se não houvesse nada.
 */
export function assistirFeed(
  fonte: FonteDoFeed,
  onPagina: (p: PaginaDoFeed) => void,
  onErro: (mensagem: string) => void,
  max = TAMANHO_DA_PAGINA,
): () => void {
  const q = query(refDaFonte(fonte), orderBy("createdAt", "desc"), limit(max + 1));
  return onSnapshot(
    q,
    // includeMetadataChanges: a passagem de "cache" pra "servidor" é só metadado, e é ela que
    // separa "sem conexão, mostrando o guardado" de "atualizado".
    { includeMetadataChanges: true },
    (snap) => onPagina(paraPagina(fonte, snap.docs, max, snap.metadata.fromCache)),
    (err) => onErro(descreverErro(err)),
  );
}

/** Uma página mais antiga, a partir de `cursor`. */
export async function carregarMais(fonte: FonteDoFeed, cursor: QueryDocumentSnapshot, max = TAMANHO_DA_PAGINA): Promise<PaginaDoFeed> {
  const q = query(refDaFonte(fonte), orderBy("createdAt", "desc"), startAfter(cursor), limit(max + 1));
  const snap = await getDocs(q);
  return paraPagina(fonte, snap.docs, max, false);
}

/** Mensagem curta e útil, sem despejar o texto técnico do SDK na tela. */
export function descreverErro(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "permission-denied") return "sem permissão para ler estes avisos";
  if (code === "unavailable" || code === "deadline-exceeded") return "sem conexão com o servidor";
  if (code === "failed-precondition") return "o servidor ainda não está pronto para esta consulta";
  return "erro inesperado";
}

// ── marcar lido / dispensado ───────────────────────────────────────

export type AlvoDaMarca = { id: string; origem: "time" | "pessoal" };

function ehNaoEncontrado(err: unknown): boolean {
  return (err as { code?: string })?.code === "not-found";
}

/**
 * Grava a marca. Diferente da versão anterior, NÃO engole o erro: quem chama
 * precisa saber que falhou pra dizer à pessoa e oferecer tentar de novo.
 *
 * Um aviso do time existe em DUAS coleções (o original e o espelho redigido), e o
 * "lido" é por e-mail, não por papel. A marca vai nas duas: senão quem é dono hoje
 * e vira member amanhã (ou o contrário) veria tudo de novo como não lido — o item
 * "ressuscitaria" porque a marca ficou na coleção que a pessoa deixou de ler. Só a
 * ausência do documento (`not-found`) é aceita como "nada a marcar ali".
 *
 * Por que FieldPath, e não a chave com ponto: o Firestore lê PONTO como separador de
 * caminho, e um e-mail tem pelo menos um. "readBy.caua@gmail.com" virava
 * readBy > caua@gmail > com — três níveis aninhados, a marca no lugar errado.
 */
async function marcar(alvo: AlvoDaMarca, email: string, campoDoTime: "readBy" | "dismissedBy", campoPessoal: "lidoEm" | "dispensadoEm"): Promise<void> {
  const { db } = getFirebase();

  if (alvo.origem === "pessoal") {
    try {
      await updateDoc(doc(db, COLECAO_FEED, email.toLowerCase(), "itens", alvo.id), campoPessoal, Date.now());
    } catch (err) {
      if (!ehNaoEncontrado(err)) throw err;
    }
    return;
  }

  const agora = Date.now();
  const resultados = await Promise.allSettled(
    [COLECAO_EVENTOS, COLECAO_EVENTOS_PUBLICA].map((colecao) =>
      updateDoc(doc(db, colecao, alvo.id), new FieldPath(campoDoTime, email), agora),
    ),
  );
  const falhou = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected" && !ehNaoEncontrado(r.reason));
  const algumOk = resultados.some((r) => r.status === "fulfilled");
  // Se ao menos uma coleção gravou, a marca vale pra quem lê aquela; o erro da outra não a desfaz.
  if (falhou && !algumOk) throw falhou.reason;
}

export const marcarLido = (alvo: AlvoDaMarca, email: string) => marcar(alvo, email, "readBy", "lidoEm");
export const marcarDispensado = (alvo: AlvoDaMarca, email: string) => marcar(alvo, email, "dismissedBy", "dispensadoEm");

/** Marca vários e diz QUAIS falharam — nada de disparar promessas e torcer. */
export async function marcarVariosLidos(alvos: AlvoDaMarca[], email: string): Promise<{ ok: number; falhas: AlvoDaMarca[] }> {
  const rs = await Promise.allSettled(alvos.map((a) => marcarLido(a, email)));
  const falhas = alvos.filter((_, i) => rs[i].status === "rejected");
  return { ok: alvos.length - falhas.length, falhas };
}
