import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { NotificationEvent } from "@/lib/domain/notifications";
import {
  COLECAO_EVENTOS,
  COLECAO_EVENTOS_PUBLICA,
  COLECAO_FEED,
  redigirEvento,
} from "@/lib/domain/notificacao-publico";
import { COLECAO_OUTBOX, montarDocDoOutbox, type EspecPush } from "@/lib/notification-outbox";

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

const ALREADY_EXISTS = 6;
const codigoDe = (err: unknown) => (err as { code?: number })?.code;

/**
 * Cria os documentos do evento e, se houver, o do push — NO MESMO LOTE (S09).
 *
 * ─── POR QUE JUNTOS ─────────────────────────────────────────────────────
 *
 * O evento nascia numa escrita e o push em outra, e entre as duas havia o
 * processo morrer, o Firestore recusar, ou `enviarEPersistirEntrega` engolir
 * o erro e devolver zero. O evento ficava, o push não — e a varredura do outbox
 * não tem como achar o que nunca foi gravado. O conserto dependia de o
 * PRODUTOR repetir, e nem todo produtor repete (o webhook, desde o inbox do
 * S07, marca a notificação como processada).
 *
 * No mesmo lote, os dois nascem ou nenhum nasce. Nascido, o push tem
 * `fanoutPendente: true` e a varredura o completa mesmo que ninguém mais chame.
 *
 * Se o lote falha porque algo já existia (retry, ou evento de antes disto), refaz
 * um a um ignorando o que já está lá: o push que faltar nasce agora — é assim que
 * um evento antigo que ficou sem push se conserta quando o produtor repete.
 *
 * @returns se algum documento do EVENTO foi criado agora.
 */
async function criarComPush(
  db: Firestore,
  eventos: { ref: FirebaseFirestore.DocumentReference; dados: Record<string, unknown> }[],
  push: EspecPush | undefined,
): Promise<boolean> {
  const outbox = push
    ? { ref: db.collection(COLECAO_OUTBOX).doc(push.pushId), dados: montarDocDoOutbox(push, Date.now()) }
    : null;
  // Sem push, o caminho de sempre (um create por documento). O lote só existe
  // pra amarrar o push ao evento.
  if (outbox) {
    const lote = db.batch();
    for (const e of eventos) lote.create(e.ref, e.dados);
    lote.create(outbox.ref, outbox.dados);
    try {
      await lote.commit();
      return eventos.length > 0;
    } catch (err) {
      if (codigoDe(err) !== ALREADY_EXISTS) throw err;
    }
  }
  let criou = false;
  for (const e of eventos) {
    try {
      await e.ref.create(e.dados);
      criou = true;
    } catch (err) {
      if (codigoDe(err) !== ALREADY_EXISTS) throw err;
    }
  }
  if (outbox) {
    await outbox.ref.create(outbox.dados).catch((err) => { if (codigoDe(err) !== ALREADY_EXISTS) throw err; });
  }
  return criou;
}

/**
 * Grava o espelho redigido de um evento — criando OU consertando, sem nunca
 * apagar a marca de lido de quem já leu.
 *
 * ─── O QUE ISTO CORRIGE ─────────────────────────────────────────────────
 *
 * O espelho era escrito uma vez, logo depois do `create()` do original, com o
 * erro engolido (`.catch(() => {})`). Se essa escrita falhasse, o evento ficava
 * sem espelho pra sempre: o retry seguinte recebia ALREADY_EXISTS e não
 * tentava de novo, e quem só lê o espelho (o `member`) via a Central sem um
 * aviso que o dono via — sem erro em lugar nenhum.
 *
 * ─── COMO PRESERVA O LIDO ───────────────────────────────────────────────
 *
 * `readBy`/`dismissedBy` do espelho são de quem lê O ESPELHO; nunca vêm do
 * original. A escrita é uma transação que lê o espelho atual e o regrava com o
 * conteúdo público novo E as marcas antigas — um `set` puro apagaria as marcas,
 * e um `merge` deixaria pra trás campos que a projeção nova já não inclui.
 * A transação também fecha a janela em que alguém marca como lido entre a
 * leitura e a escrita.
 */
export async function garantirEspelho(
  db: Firestore,
  eventId: string,
  original: Partial<NotificationEvent>,
): Promise<"criado" | "atualizado"> {
  const ref = db.collection(COLECAO_EVENTOS_PUBLICA).doc(eventId);
  const publico = sanitizeUndefined(redigirEvento(original));
  return db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    const marcas = atual.data();
    tx.set(ref, {
      ...publico,
      readBy: marcas?.readBy ?? {},
      dismissedBy: marcas?.dismissedBy ?? {},
    });
    return atual.exists ? ("atualizado" as const) : ("criado" as const);
  });
}

/** O espelho não pôde ser gravado agora: fica marcado pra ser refeito, em vez de sumir em silêncio. */
async function marcarEspelhoPendente(db: Firestore, eventId: string, err: unknown): Promise<void> {
  const code = (err as { code?: unknown })?.code;
  console.error(`[notificacoes] espelho de ${eventId} nao gravado (codigo ${String(code ?? "desconhecido")}); ficou pendente`);
  await db.collection(COL).doc(eventId).update({ espelhoPendente: true }).catch(() => {});
}

/**
 * Cria o evento de forma idempotente: o `dedupeKey` (ex.: "sale_paid:2000123456")
 * É o id do documento, e `DocumentReference.create()` falha se o doc já
 * existir. Isso substitui o padrão antigo de "lê o campo notifiedPush numa
 * transação" por algo mais simples e igualmente atômico — o próprio
 * Firestore garante que só UMA chamada concorrente cria o doc, sem precisar
 * ler antes.
 *
 * Retorna `created: false` quando o evento já existia (retry do webhook do
 * ML, ou duas chamadas quase simultâneas pro mesmo pedido). O evento em si já
 * está lá, intacto — mas isso NÃO diz que o push foi entregue nem que o espelho
 * foi gravado: quem chama deve publicar o push de qualquer forma (é
 * idempotente), e aqui o espelho é conferido e consertado se faltar.
 */
export async function createNotificationEventIdempotent(
  input: NewNotificationEvent,
  /** Injetável pra o teste usar o emulador; em produção é sempre o banco do app. */
  db: Firestore = getAdminDb(),
  /**
   * Evento DIRECIONADO: só estas pessoas o veem. Vai pro feed de cada uma
   * (notification_feed/{email}/itens) e NUNCA pras coleções compartilhadas — a
   * privacidade é da regra do Firestore, não de um filtro no React.
   */
  opcoes: {
    audiencia?: string[];
    /**
     * O push deste evento, criado no MESMO lote (S09 — ver criarComPush). O
     * `pushId` do aviso individual é o próprio `dedupeKey`, então o payload pode
     * ser montado antes do evento existir.
     */
    push?: EspecPush;
  } = {},
): Promise<{ created: boolean; eventId: string }> {
  if (opcoes.audiencia && opcoes.audiencia.length > 0) return criarEventoPessoal(db, input, opcoes.audiencia, opcoes.push);
  const ref = db.collection(COL).doc(input.dedupeKey);
  const completo = sanitizeUndefined({
    ...input,
    id: input.dedupeKey,
    createdAt: FieldValue.serverTimestamp(),
  });
  // ALREADY_EXISTS é o caso esperado de retry — qualquer outro erro (permissão,
  // rede) sobe de verdade pra quem chamou saber.
  if (!(await criarComPush(db, [{ ref, dados: completo }], opcoes.push))) {
    await conferirEspelho(db, input.dedupeKey);
    return { created: false, eventId: input.dedupeKey };
  }

  /**
   * Espelho redigido, pra quem nao pode ver financeiro.
   *
   * As regras do Firestore sao por DOCUMENTO: nao da pra liberar o evento e
   * esconder grossAmount/estimatedProfit/estimatedMargin dentro dele. Entao o
   * `member` lia tudo — pela Central e pelo SDK. Aqui nasce a versao sem
   * dinheiro, que e a unica que ele alcanca.
   *
   * Escrito DEPOIS do create original de proposito: o `create()` e o que
   * garante a idempotencia, e um espelho que falhe nao pode fazer o evento (e o
   * push) sumirem. Mas a falha agora deixa rastro e e refeita.
   */
  try {
    await garantirEspelho(db, input.dedupeKey, completo as Partial<NotificationEvent>);
  } catch (err) {
    await marcarEspelhoPendente(db, input.dedupeKey, err);
  }
  return { created: true, eventId: input.dedupeKey };
}

/** Num retry: se o espelho falta (ou ficou marcado pendente), conserta. Nunca lança. */
async function conferirEspelho(db: Firestore, eventId: string): Promise<void> {
  try {
    const [original, espelho] = await Promise.all([
      db.collection(COL).doc(eventId).get(),
      db.collection(COLECAO_EVENTOS_PUBLICA).doc(eventId).get(),
    ]);
    if (!original.exists) return;
    if (espelho.exists && !original.data()?.espelhoPendente) return;
    await garantirEspelho(db, eventId, original.data() as Partial<NotificationEvent>);
    if (original.data()?.espelhoPendente) {
      await db.collection(COL).doc(eventId).update({ espelhoPendente: FieldValue.delete() });
    }
  } catch (err) {
    await marcarEspelhoPendente(db, eventId, err);
  }
}

/**
 * Refaz os espelhos que ficaram marcados como pendentes. Roda nas varreduras
 * do outbox, então uma falha passageira não vira ausência permanente.
 */
export async function repararEspelhosPendentes(db: Firestore, limite = 50): Promise<number> {
  const pendentes = await db.collection(COL).where("espelhoPendente", "==", true).limit(limite).get();
  let refeitos = 0;
  for (const d of pendentes.docs) {
    try {
      await garantirEspelho(db, d.id, d.data() as Partial<NotificationEvent>);
      await d.ref.update({ espelhoPendente: FieldValue.delete() });
      refeitos++;
    } catch (err) {
      console.error(`[notificacoes] reparo do espelho de ${d.id} falhou (codigo ${String((err as { code?: unknown })?.code ?? "desconhecido")})`);
    }
  }
  return refeitos;
}

/**
 * Um evento direcionado, no feed de cada pessoa da audiência.
 *
 * O aviso de tarefa e o de teste aparecem na Central de QUEM DEVE VÊ-LOS: antes
 * caíam na coleção compartilhada e todo o time via "Nova tarefa atribuída a você"
 * de outra pessoa, e o teste de um virava "venda" na Central do outro.
 *
 * Cada pessoa tem o PRÓPRIO documento, com o lido dela (`lidoEm`), então não há
 * mapa por e-mail nem marca de outra pessoa pra proteger. `create()` mantém a
 * idempotência: o mesmo evento não nasce duas vezes.
 */
async function criarEventoPessoal(
  db: Firestore,
  input: NewNotificationEvent,
  audiencia: string[],
  push?: EspecPush,
): Promise<{ created: boolean; eventId: string }> {
  const emails = [...new Set(audiencia.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const created = await criarComPush(db, emails.map((email) => ({
    ref: db.collection(COLECAO_FEED).doc(email).collection("itens").doc(input.dedupeKey),
    dados: sanitizeUndefined({
      ...input,
      id: input.dedupeKey,
      audiencia: emails,
      lidoEm: null,
      dispensadoEm: null,
      createdAt: FieldValue.serverTimestamp(),
    }),
  })), push);
  return { created, eventId: input.dedupeKey };
}

/** Quanto tempo um evento de TESTE fica no feed. É histórico técnico, não histórico operacional. */
export const RETENCAO_DE_TESTES_MS = 7 * 24 * 3600 * 1000;

/** Apaga testes antigos dos feeds. Por pessoa e por tipo (consulta de campo único): não exige índice composto nem de grupo de coleção. */
export async function limparTestesAntigos(db: Firestore, emails: string[], agora = Date.now()): Promise<number> {
  let apagados = 0;
  for (const email of emails) {
    const antigos = await db.collection(COLECAO_FEED).doc(email.toLowerCase()).collection("itens")
      .where("type", "==", "test").limit(100).get();
    const lote = db.batch();
    for (const d of antigos.docs) {
      const criado = d.data().createdAt;
      const ms = criado && typeof (criado as { toMillis?: unknown }).toMillis === "function"
        ? (criado as { toMillis: () => number }).toMillis()
        : 0;
      if (ms > 0 && agora - ms > RETENCAO_DE_TESTES_MS) { lote.delete(d.ref); apagados++; }
    }
    await lote.commit();
  }
  return apagados;
}

/**
 * Limpa os testes vencidos de TODOS os feeds. O documento `notification_feed/{email}`
 * nunca é criado (só a subcoleção `itens`), então os e-mails vêm de `listDocuments`,
 * que enxerga esses pais "vazios"; uma consulta comum não os listaria.
 */
export async function limparTestesDosFeeds(db: Firestore, agora = Date.now()): Promise<number> {
  const pais = await db.collection(COLECAO_FEED).listDocuments();
  return limparTestesAntigos(db, pais.slice(0, 200).map((p) => p.id), agora);
}
