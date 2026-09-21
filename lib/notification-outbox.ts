import "server-only";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { getAdminDb, getAdminMessaging } from "@/lib/firebase/admin";
import type { NotificationEventType, SalePushPayload } from "@/lib/domain/notifications";
import { redigirPush, type AcessoDoDestinatario, type NivelConteudo } from "@/lib/domain/notificacao-publico";
import { serializarPayload, ajustarAoOrcamento } from "@/lib/domain/push-payload";
import { dividirEmLotes, mapearRespostas, ttlSegundos, type RespostaDeEnvio } from "@/lib/domain/push-envio";
import { planejarDestinos, type RegistroDeDestino } from "@/lib/domain/push-destinos";
import { decidirDestinatario, type ContextoDeRajada } from "@/lib/domain/decisao-destinatario";
import { personalizarPayload } from "@/lib/domain/personalizacao-push";
import { minutosDaJanela } from "@/lib/domain/janela-de-vendas";
import { buildGroupedSalesContent, type NotificationEventType as TipoDeEvento } from "@/lib/domain/notifications";
import { lerJanela } from "@/lib/notification-janelas";
import { preferenciasSeguras, type LeituraDePreferencias } from "@/lib/domain/notification-preferences";
import {
  VALIDADE_PADRAO_MS,
  avaliarEntrega,
  patchEncerrada,
  patchReivindicada,
  patchResultado,
  resumirEntregas,
  type ResultadoDoEnvio,
  type StatusEntrega,
} from "@/lib/domain/entrega-destino";
import { lerPreferenciasPorEmail } from "@/lib/notification-preferences";
import { papelDe, type PermissionTab } from "@/lib/domain/types";
import { COLECAO_EVENTOS } from "@/lib/domain/notificacao-publico";

/**
 * O outbox: o que garante que um aviso agendado chega a quem devia, mesmo com
 * o FCM instável, o processo morrendo no meio, ou dez aparelhos com destinos
 * diferentes.
 *
 * ─── AS DUAS COLEÇÕES ───────────────────────────────────────────────────
 *
 *  notification_outbox/{pushId}
 *      O QUE enviar: o payload completo (com dinheiro — é só do servidor),
 *      a audiência, a validade. Um por push. Escrito com `create()`, então
 *      publicar duas vezes o mesmo aviso é inofensivo.
 *
 *  notification_entregas/{pushId}__{registro}
 *      PRA QUEM, e em que pé está: um por (aviso, aparelho), com o estado da
 *      máquina de lib/domain/entrega-destino.
 *
 * As duas são fechadas às regras do Firestore (só o Admin SDK entra): o outbox
 * carrega o payload com o financeiro, e as entregas dizem quem recebeu o quê.
 *
 * ─── QUEM CONSOME ───────────────────────────────────────────────────────
 *
 * `processarEntregas` não depende de quem publicou. O produtor chama pra
 * entrega imediata; e qualquer varredura (o cron diário, o webhook de outro
 * pedido, a rota /api/push/processar) acha o que ficou pendente — inclusive o
 * que um worker deixou pela metade, porque a concessão vencida reaparece na
 * mesma consulta.
 *
 * ─── O QUE NÃO SE PROMETE ───────────────────────────────────────────────
 *
 * Nada aqui é "exatamente uma vez". Se o FCM aceita e o worker morre antes de
 * gravar o resultado, a concessão vence e o destino é reenviado: o aparelho
 * pode receber duas, e a `tag` do payload colapsa na tela. E "aceito" não é
 * "exibido" — ver lib/domain/entrega-destino.
 */

export const COLECAO_OUTBOX = "notification_outbox";
export const COLECAO_ENTREGAS = "notification_entregas";

export type EspecPush = {
  /** Id do push. Pra um aviso individual é o próprio eventId; um resumo agrupado tem o seu. */
  pushId: string;
  eventId: string;
  type: NotificationEventType;
  payload: SalePushPayload;
  /** Troca o toggle checado de `toggles[type]` pra `toggles.sales_summary`. */
  isSummary?: boolean;
  /** `null`/ausente = o time inteiro; lista = só essas pessoas (aviso direcionado). */
  audiencia?: string[] | null;
  /** Restringe a APARELHOS específicos (ids de registro). O teste vai só pro aparelho que o pediu. */
  apenasRegistros?: string[] | null;
  validadeMs?: number;
  /** De onde veio — só pra diagnóstico. */
  origem: string;
  /** Se o estado de entrega deve ser refletido no evento. Padrão: só quando pushId === eventId. */
  atualizaEvento?: boolean;
  /** Onde este push está numa rajada de vendas — decide quem o recebe (ver decidirDestinatario). */
  rajada?: ContextoDeRajada;
  /**
   * Conteúdo calculado NO MOMENTO DE ENVIAR, não no de agendar. O resumo de uma
   * rajada precisa do número FINAL de vendas, que só existe quando a janela fecha.
   */
  conteudo?: { tipo: "resumo_janela"; janelaId: string } | null;
  /** Não enviar antes deste instante (ms). O fechamento de uma rajada espera o fim da janela. A validade conta a partir dele. */
  entregarApos?: number;
  /**
   * A decisão de agrupamento tomada quando a venda entrou na janela. Vive AQUI, no
   * push individual, porque é ele que o retry relê: reprocessar a venda reusa a
   * mesma posição na rajada em vez de contá-la de novo.
   */
  agrupamento?: { janelaId: string; n: number };
};

export type MensagemDeLote = {
  tokens: string[];
  data: Record<string, string>;
  link: string;
  ttlSegundos: number;
};

/**
 * Tudo o que o outbox pede ao mundo de fora, injetável: os testes trocam o
 * FCM por um simulado (pra provar falha parcial, lote de 501, resposta
 * incompleta) sem tocar no resto — o Firestore continua sendo o do emulador.
 */
export type Dependencias = {
  db: Firestore;
  agora: () => number;
  aleatorio: () => number;
  novoLeaseId: () => string;
  enviarLote: (m: MensagemDeLote) => Promise<RespostaDeEnvio[]>;
  lerAcessos: () => Promise<Map<string, AcessoDoDestinatario>>;
  lerPreferencias: (email: string) => Promise<LeituraDePreferencias>;
};

/**
 * Quem ainda tem acesso, lido do `controleAcesso`. Preferência nunca foi
 * autorização: quem perdeu o acesso não é "alguém que desligou o aviso".
 */
async function lerAcessosDoBanco(db: Firestore): Promise<Map<string, AcessoDoDestinatario>> {
  const snap = await db.collection("controleAcesso").get();
  const mapa = new Map<string, AcessoDoDestinatario>();
  for (const d of snap.docs) {
    const dados = d.data() ?? {};
    const email = String(dados.email ?? d.id).toLowerCase();
    if (!email) continue;
    mapa.set(email, {
      papel: papelDe(dados.role),
      permissoesEdicao: Array.isArray(dados.permissoesEdicao) ? (dados.permissoesEdicao as PermissionTab[]) : [],
    });
  }
  return mapa;
}

export function dependenciasReais(): Dependencias {
  const db = getAdminDb();
  return {
    db,
    agora: () => Date.now(),
    aleatorio: () => Math.random(),
    novoLeaseId: () => crypto.randomUUID(),
    enviarLote: async (m) => {
      const resp = await getAdminMessaging().sendEachForMulticast({
        tokens: m.tokens,
        // SÓ "data", sem "notification" no topo — de propósito. Com um campo
        // "notification" presente, o próprio SDK do Firebase pode exibir a
        // notificação sozinho ALÉM do showNotification() manual que o Service
        // Worker já faz (ver app/firebase-messaging-sw.js/route.ts) — duas
        // exibições pra um push só. Só "data" garante que a exibição acontece
        // uma vez, sempre pelo nosso código.
        data: m.data,
        webpush: {
          // TTL: o provedor descarta o que já não vale, em vez de guardar por até
          // quatro semanas e mostrar venda velha como nova. Urgência alta porque
          // aviso de venda não deve esperar o aparelho sair do modo de economia.
          headers: { TTL: String(m.ttlSegundos), Urgency: "high" },
          fcmOptions: { link: m.link },
        },
      });
      return resp.responses.map((r) => ({
        success: r.success,
        messageId: r.messageId,
        error: r.error ? { code: r.error.code } : undefined,
      }));
    },
    lerAcessos: () => lerAcessosDoBanco(db),
    lerPreferencias: lerPreferenciasPorEmail,
  };
}

// ── utilitários ──────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** `null` num patch do domínio significa "apagar o campo". */
function paraFirestore(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? FieldValue.delete() : v]));
}

async function comConcorrencia<T>(itens: T[], limite: number, fn: (i: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      await fn(itens[i]);
    }
  });
  await Promise.all(trabalhadores);
}

const ALREADY_EXISTS = 6;
const codigoDe = (err: unknown) => (err as { code?: number })?.code;

// ── publicar ─────────────────────────────────────────────────────────────

export function idDaEntrega(pushId: string, registroDocId: string): string {
  return `${pushId}__${registroDocId}`;
}

function registroDe(d: FirebaseFirestore.QueryDocumentSnapshot): RegistroDeDestino {
  const x = d.data() ?? {};
  return {
    docId: d.id,
    token: String(x.token ?? d.id), // legado: o id era o próprio token
    updatedAt: num(x.updatedAt ?? x.createdAt),
    deviceId: String(x.deviceId ?? ""),
    email: String(x.email ?? ""),
    userAgent: String(x.userAgent ?? ""),
  };
}

/**
 * Cria um destino por aparelho registrado que a audiência alcança.
 *
 * Idempotente e tolerante a corrida: o lote usa `create()`, que falha inteiro
 * se UM documento já existir — nesse caso refaz um a um, ignorando os que já
 * estão lá. Assim republicar o mesmo push, ou dois processos publicando juntos,
 * termina com exatamente um destino por aparelho.
 */
async function fazerFanout(
  deps: Dependencias,
  outbox: DocumentReference,
  dados: { pushId: string; eventId: string; audiencia: string[] | null; expiraEm: number; entregarApos?: number; apenasRegistros?: string[] | null },
): Promise<number> {
  const { db } = deps;
  const agora = deps.agora();
  const snap = await db.collection("pushTokens").get();
  let registros = planejarDestinos(snap.docs.map(registroDe));
  if (dados.audiencia) {
    const permitidos = new Set(dados.audiencia.map((e) => e.toLowerCase()));
    registros = registros.filter((r) => permitidos.has(r.email.toLowerCase()));
  }
  if (dados.apenasRegistros) {
    const ids = new Set(dados.apenasRegistros);
    registros = registros.filter((r) => ids.has(r.docId));
  }

  const col = db.collection(COLECAO_ENTREGAS);
  const novos = registros.map((r) => ({
    ref: col.doc(idDaEntrega(dados.pushId, r.docId)),
    dados: {
      pushId: dados.pushId,
      eventId: dados.eventId,
      registroDocId: r.docId,
      email: r.email.toLowerCase(),
      status: "pending" satisfies StatusEntrega,
      tentativas: 0,
      adiamentos: 0,
      criadoEm: agora,
      expiraEm: dados.expiraEm,
      // É por este campo que o worker acha o destino: devido já, ou quando o push
      // agendado pode sair.
      proximaTentativaEm: dados.entregarApos ?? agora,
    },
  }));

  for (const grupo of dividirEmLotes(novos, 400)) {
    const lote = db.batch();
    for (const n of grupo) lote.create(n.ref, n.dados);
    try {
      await lote.commit();
    } catch (err) {
      if (codigoDe(err) !== ALREADY_EXISTS) throw err;
      for (const n of grupo) {
        await n.ref.create(n.dados).catch((e) => { if (codigoDe(e) !== ALREADY_EXISTS) throw e; });
      }
    }
  }

  await outbox.update({ fanoutPendente: false, fanoutEm: agora, destinos: registros.length });
  return registros.length;
}

/**
 * Agenda o push: grava o QUE enviar e cria um destino por aparelho.
 *
 * Idempotente. Chamar de novo com o mesmo `pushId` (retry do webhook, sync que
 * reencontra o pedido) não recria nada — só completa o fan-out se ele tiver
 * ficado pela metade.
 */
export type PushPublicado = {
  criado: boolean;
  destinos: number;
  /** Todos os destinos já em estado terminal: não há o que processar. */
  concluido: boolean;
  doc: FirebaseFirestore.DocumentData;
};

export async function publicarPush(deps: Dependencias, spec: EspecPush): Promise<PushPublicado> {
  const agora = deps.agora();
  const ref = deps.db.collection(COLECAO_OUTBOX).doc(spec.pushId);
  const doc = {
    pushId: spec.pushId,
    eventId: spec.eventId,
    type: spec.type,
    isSummary: Boolean(spec.isSummary),
    // JSON, não objeto: o payload tem campos `undefined`, que o Admin SDK recusa.
    payloadJson: JSON.stringify(spec.payload),
    audiencia: spec.audiencia ?? null,
    apenasRegistros: spec.apenasRegistros ?? null,
    criadoEm: agora,
    entregarApos: spec.entregarApos ?? agora,
    // A validade conta do momento em que o envio PODE acontecer: um push agendado
    // pra daqui a 90 s não nasce com 90 s a menos de vida.
    expiraEm: (spec.entregarApos ?? agora) + (spec.validadeMs ?? VALIDADE_PADRAO_MS),
    origem: spec.origem,
    atualizaEvento: spec.atualizaEvento ?? spec.pushId === spec.eventId,
    rajada: spec.rajada ?? null,
    conteudo: spec.conteudo ?? null,
    agrupamento: spec.agrupamento ?? null,
    // Só vira false quando os destinos foram criados: se o processo morrer entre
    // uma coisa e outra, a varredura acha o push por este campo e completa.
    fanoutPendente: true,
  };

  let criado = true;
  try {
    await ref.create(doc);
  } catch (err) {
    if (codigoDe(err) !== ALREADY_EXISTS) throw err;
    criado = false;
  }

  if (criado) return { criado, destinos: await fazerFanout(deps, ref, doc), concluido: false, doc };

  const existente: FirebaseFirestore.DocumentData = (await ref.get()).data() ?? doc;
  if (existente.fanoutPendente) {
    const destinos = await fazerFanout(deps, ref, {
      pushId: spec.pushId,
      eventId: String(existente.eventId ?? spec.eventId),
      audiencia: (existente.audiencia as string[] | null) ?? null,
      apenasRegistros: (existente.apenasRegistros as string[] | null) ?? null,
      expiraEm: num(existente.expiraEm),
      entregarApos: num(existente.entregarApos) || undefined,
    });
    return { criado, destinos, concluido: false, doc: existente };
  }
  return { criado, destinos: num(existente.destinos), concluido: Boolean(existente.concluidoEm), doc: existente };
}

// ── consumir ─────────────────────────────────────────────────────────────

type Reivindicada = {
  ref: DocumentReference;
  pushId: string;
  registroDocId: string;
  email: string;
  leaseId: string;
  adiamentos: number;
};

export type ResultadoDoProcessamento = {
  reivindicadas: number;
  aceitas: number;
  reagendadas: number;
  suprimidas: number;
  expiradas: number;
  falhas: number;
  /** Concessão perdida antes de gravar: outro worker assumiu o destino. */
  concessaoPerdida: number;
};

const zerado = (): ResultadoDoProcessamento => ({
  reivindicadas: 0, aceitas: 0, reagendadas: 0, suprimidas: 0, expiradas: 0, falhas: 0, concessaoPerdida: 0,
});

/**
 * Assume o destino numa transação, ANTES de chamar o FCM.
 *
 * É aqui que 20 workers simultâneos viram um só por destino: a transação relê
 * o documento, e o que perdeu a corrida encontra a concessão já gravada e
 * recua. O FCM nunca é chamado dentro da transação — ela pode ser reexecutada
 * sob contenção, e uma chamada externa reexecutada é um envio duplicado.
 */
async function reivindicar(
  deps: Dependencias,
  ref: DocumentReference,
): Promise<{ tipo: "reivindicada"; r: Reivindicada } | { tipo: "encerrada"; status: StatusEntrega } | null> {
  return deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    const agora = deps.agora();
    const avaliacao = avaliarEntrega({
      status: d.status as StatusEntrega,
      tentativas: num(d.tentativas),
      proximaTentativaEm: d.proximaTentativaEm == null ? null : num(d.proximaTentativaEm),
      leaseId: d.leaseId ?? null,
      leaseAte: d.leaseAte == null ? null : num(d.leaseAte),
      expiraEm: num(d.expiraEm),
      adiamentos: num(d.adiamentos),
    }, agora);

    if (avaliacao.acao === "pular") return null;
    if (avaliacao.acao === "expirar" || avaliacao.acao === "esgotar") {
      tx.update(ref, paraFirestore(patchEncerrada(avaliacao.acao, agora)));
      return { tipo: "encerrada" as const, status: (avaliacao.acao === "expirar" ? "expired" : "permanent_failure") as StatusEntrega };
    }

    const leaseId = deps.novoLeaseId();
    tx.update(ref, paraFirestore(patchReivindicada(avaliacao.tentativa, agora, leaseId)));
    return {
      tipo: "reivindicada" as const,
      r: {
        ref, pushId: String(d.pushId), registroDocId: String(d.registroDocId), email: String(d.email ?? ""),
        leaseId, adiamentos: num(d.adiamentos),
      },
    };
  });
}

type Contexto = {
  acessos?: Promise<Map<string, AcessoDoDestinatario>>;
  prefs: Map<string, Promise<LeituraDePreferencias>>;
};

/**
 * Grava o resultado SE a concessão ainda é nossa.
 *
 * Um worker lento, cuja concessão venceu e foi assumida por outro, não pode
 * sobrescrever o resultado do sucessor — o `leaseId` no documento é o que
 * distingue os dois. Retenta a escrita, porque perder o resultado depois de o
 * FCM ter aceitado é justamente o que faz a concessão vencer e o aparelho
 * receber uma segunda vez.
 */
async function gravarResultado(
  deps: Dependencias,
  r: Reivindicada,
  resultado: ResultadoDoEnvio,
  c: ResultadoDoProcessamento,
): Promise<void> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const gravou = await deps.db.runTransaction(async (tx) => {
        const snap = await tx.get(r.ref);
        const d = snap.data();
        if (!snap.exists || d?.leaseId !== r.leaseId || d?.status !== "leased") return false;
        tx.update(r.ref, paraFirestore(patchResultado(
          { tentativas: num(d.tentativas), expiraEm: num(d.expiraEm), adiamentos: num(d.adiamentos) },
          resultado, deps.agora(), deps.aleatorio(),
        )));
        return true;
      });
      if (!gravou) { c.concessaoPerdida++; return; }
      if (resultado.tipo === "aceito") c.aceitas++;
      else if (resultado.tipo === "transitorio" || resultado.tipo === "adiar") c.reagendadas++;
      else if (resultado.tipo === "suprimido") c.suprimidas++;
      else if (resultado.tipo === "expirado") c.expiradas++;
      else c.falhas++;
      return;
    } catch (err) {
      ultimoErro = err;
      await new Promise((ok) => setTimeout(ok, 40 * tentativa));
    }
  }
  throw ultimoErro;
}

/** Apaga o registro do aparelho quando o FCM diz que o token morreu — mas só se ainda for ESSE token. */
async function removerTokenMorto(deps: Dependencias, registroDocId: string, token: string): Promise<void> {
  const ref = deps.db.collection("pushTokens").doc(registroDocId);
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? String(snap.data()?.token ?? snap.id) : null;
    // Se o token rodou enquanto enviávamos, o registro já é outro: não se apaga.
    if (atual === token) tx.delete(ref);
  }).catch(() => {});
}

/**
 * O payload no momento de ENVIAR. Pra maioria dos pushes é o que foi agendado;
 * o resumo de uma rajada é recalculado a partir da janela, pra dizer o número
 * FINAL de vendas — não o que valia quando o push foi agendado.
 */
async function resolverPayload(
  deps: Dependencias,
  outbox: FirebaseFirestore.DocumentData,
  agendado: SalePushPayload,
): Promise<SalePushPayload> {
  const c = outbox.conteudo as { tipo?: string; janelaId?: string } | null;
  if (c?.tipo !== "resumo_janela" || !c.janelaId) return agendado;
  const janela = await lerJanela(deps.db, c.janelaId);
  if (!janela) return agendado;
  const membros = Object.values(janela.membros);
  const texto = buildGroupedSalesContent(membros.length, membros.reduce((s, m) => s + m.gross, 0), minutosDaJanela(janela));
  return { ...agendado, title: texto.title, body: texto.body, resumoCount: membros.length };
}

async function processarGrupo(
  deps: Dependencias,
  ctx: Contexto,
  pushId: string,
  itens: Reivindicada[],
  contadores: ResultadoDoProcessamento,
): Promise<void> {
  const { db } = deps;
  const agora = deps.agora();

  const outboxSnap = await db.collection(COLECAO_OUTBOX).doc(pushId).get();
  const outbox = outboxSnap.data();
  if (!outbox) {
    for (const i of itens) await gravarResultado(deps, i, { tipo: "permanente", codigo: "outbox_ausente" }, contadores);
    return;
  }
  const payloadAgendado = JSON.parse(String(outbox.payloadJson)) as SalePushPayload;
  const payload = await resolverPayload(deps, outbox, payloadAgendado);
  const type = outbox.type as NotificationEventType;
  const isSummary = Boolean(outbox.isSummary);
  const rajada = (outbox.rajada as ContextoDeRajada | null) ?? undefined;
  const expiraEm = num(outbox.expiraEm);

  if (agora >= expiraEm) {
    for (const i of itens) await gravarResultado(deps, i, { tipo: "expirado" }, contadores);
    await atualizarEstadoDoPush(deps, outbox);
    return;
  }

  // O token pode ter rodado (ou o registro sumido) desde o agendamento: lê o valor de agora.
  const tokenDocs = await db.getAll(...itens.map((i) => db.collection("pushTokens").doc(i.registroDocId)));
  const tokenDe = new Map<string, string>();
  tokenDocs.forEach((d, idx) => { if (d.exists) tokenDe.set(itens[idx].registroDocId, String(d.data()?.token ?? d.id)); });

  ctx.acessos ??= deps.lerAcessos();
  const acessos = await ctx.acessos;
  type Destinatario = Reivindicada & { token: string };
  // Um envio por (nível de conteúdo, tipo que a pessoa vê): o limiar de alto valor
  // é pessoal, então dois destinatários do mesmo nível podem receber títulos diferentes.
  const porVariante = new Map<string, { nivel: NivelConteudo; tipo: TipoDeEvento; itens: Destinatario[] }>();

  for (const i of itens) {
    const token = tokenDe.get(i.registroDocId);
    if (!token) { await gravarResultado(deps, i, { tipo: "suprimido", motivo: "destino_removido" }, contadores); continue; }

    const email = i.email.toLowerCase();
    let leitura = ctx.prefs.get(email);
    if (!leitura) {
      // Uma leitura que lança vira "indisponível" só pra ESTE destinatário — não derruba o grupo.
      leitura = deps.lerPreferencias(email).catch((): LeituraDePreferencias => ({
        estado: "indisponivel", motivo: "erro_inesperado", prefs: preferenciasSeguras(),
      }));
      ctx.prefs.set(email, leitura);
    }

    const decisao = decidirDestinatario({
      type, isSummary, rajada, payload, acesso: acessos.get(email), leitura: await leitura,
      adiamentos: i.adiamentos, agora,
    });

    if (decisao.acao === "suprimir") { await gravarResultado(deps, i, { tipo: "suprimido", motivo: decisao.motivo }, contadores); continue; }
    if (decisao.acao === "adiar") { await gravarResultado(deps, i, { tipo: "adiar", ate: decisao.ate, motivo: decisao.motivo }, contadores); continue; }

    const chave = `${decisao.nivel}|${decisao.tipo}`;
    const variante = porVariante.get(chave) ?? { nivel: decisao.nivel, tipo: decisao.tipo, itens: [] };
    variante.itens.push({ ...i, token });
    porVariante.set(chave, variante);
  }

  const ttl = ttlSegundos(deps.agora(), expiraEm);
  for (const { nivel, tipo, itens: grupo } of porVariante.values()) {
    if (ttl <= 0) {
      for (const i of grupo) await gravarResultado(deps, i, { tipo: "expirado" }, contadores);
      continue;
    }
    const { data } = ajustarAoOrcamento(serializarPayload(redigirPush(personalizarPayload(payload, tipo), nivel)));

    for (const lote of dividirEmLotes(grupo)) {
      let respostas: RespostaDeEnvio[];
      try {
        respostas = await deps.enviarLote({ tokens: lote.map((i) => i.token), data, link: payload.deepLink, ttlSegundos: ttl });
      } catch {
        // A chamada inteira falhou (rede, credencial): todos deste lote são transitórios.
        respostas = lote.map(() => ({ success: false, error: { code: "messaging/lote-falhou" } }));
      }

      for (const m of mapearRespostas(lote, respostas)) {
        const resultado: ResultadoDoEnvio =
          m.classe === "aceito" ? { tipo: "aceito", messageId: m.messageId }
          : m.classe === "token_invalido" ? { tipo: "token_invalido", codigo: m.codigo ?? "desconhecido" }
          : m.classe === "permanente" ? { tipo: "permanente", codigo: m.codigo ?? "desconhecido" }
          : { tipo: "transitorio", codigo: m.codigo ?? "desconhecido" };
        await gravarResultado(deps, m.destino, resultado, contadores);
        if (m.classe === "token_invalido") await removerTokenMorto(deps, m.destino.registroDocId, m.destino.token);
      }
    }
  }

  await atualizarEstadoDoPush(deps, outbox);
}

/**
 * Recalcula o estado do push a partir dos destinos: marca o push como concluído
 * quando todos estão em estado terminal (a varredura e os produtores deixam de
 * gastar leituras com ele) e, se pedido, reflete no evento.
 *
 * O evento passa a dizer "quantos aparelhos aceitaram, quantos ainda tentam,
 * quantos foram suprimidos" em vez de um "entregue: sim/não" que não existe.
 */
export async function atualizarEstadoDoPush(deps: Dependencias, outbox: FirebaseFirestore.DocumentData): Promise<void> {
  const snap = await deps.db.collection(COLECAO_ENTREGAS).where("pushId", "==", outbox.pushId).get();
  const entregas = snap.docs.map((d) => d.data());
  const resumo = resumirEntregas(entregas.map((e) => ({ status: e.status as StatusEntrega })));

  if (resumo.concluido && !outbox.concluidoEm) {
    await deps.db.collection(COLECAO_OUTBOX).doc(String(outbox.pushId)).update({ concluidoEm: deps.agora() }).catch(() => {});
  }
  if (!outbox.atualizaEvento) return;
  const aceitoEm = entregas.map((e) => num(e.acceptedByProviderAt)).filter((t) => t > 0).sort((a, b) => a - b)[0];
  const ultimoErro = entregas
    .map((e) => e.ultimoErro as { codigo?: string; em?: number } | undefined)
    .filter((e): e is { codigo: string; em: number } => Boolean(e?.codigo))
    .sort((a, b) => num(b.em) - num(a.em))[0];

  const patch: Record<string, unknown> = {
    "delivery.resumo": { ...resumo, atualizadoEm: deps.agora() },
    "delivery.pushAttemptedAt": deps.agora(),
  };
  if (aceitoEm) patch["delivery.acceptedByProviderAt"] = aceitoEm;
  if (resumo.aceitos === 0 && ultimoErro) patch["delivery.pushError"] = String(ultimoErro.codigo).slice(0, 200);
  if (resumo.aceitos === 0 && !ultimoErro && resumo.concluido) {
    patch["delivery.pushError"] = resumo.total === 0 ? "nenhum dispositivo registrado" : "nenhum destinatário elegível (preferência, acesso ou validade)";
  }
  if (resumo.aceitos > 0) patch["delivery.pushError"] = FieldValue.delete();

  // O evento pode não existir (aviso que só vive no push); nesse caso não há onde refletir.
  await deps.db.collection(COLECAO_EVENTOS).doc(String(outbox.eventId)).update(patch).catch(() => {});
}

export type OpcoesDeProcessamento = {
  /** Só os destinos deste push (a entrega imediata do produtor). Sem isto, varre tudo que está vencido. */
  pushId?: string;
  limite?: number;
  /** Depois disto não assume grupos novos — o resto fica pra próxima varredura. */
  orcamentoMs?: number;
};

/**
 * Envia o que está pendente e vencido. Pode ser chamada por qualquer um, a
 * qualquer momento, quantas vezes for: a concessão garante que cada destino é
 * enviado por um worker só.
 */
export async function processarEntregas(deps: Dependencias, opcoes: OpcoesDeProcessamento = {}): Promise<ResultadoDoProcessamento> {
  const inicio = deps.agora();
  const contadores = zerado();
  const limite = opcoes.limite ?? 200;
  const col = deps.db.collection(COLECAO_ENTREGAS);

  // Fan-outs que ficaram pela metade (o processo morreu entre criar o push e criar os destinos).
  if (!opcoes.pushId) {
    const incompletos = await deps.db.collection(COLECAO_OUTBOX).where("fanoutPendente", "==", true).limit(10).get();
    for (const d of incompletos.docs) {
      const x = d.data();
      await fazerFanout(deps, d.ref, {
        pushId: String(x.pushId), eventId: String(x.eventId),
        audiencia: (x.audiencia as string[] | null) ?? null, expiraEm: num(x.expiraEm),
        apenasRegistros: (x.apenasRegistros as string[] | null) ?? null,
        entregarApos: num(x.entregarApos) || undefined,
      }).catch(() => {});
    }
  }

  const candidatos = opcoes.pushId
    ? (await col.where("pushId", "==", opcoes.pushId).get()).docs
    : (await col.where("proximaTentativaEm", "<=", inicio).orderBy("proximaTentativaEm").limit(limite).get()).docs;

  const reivindicadas: Reivindicada[] = [];
  await comConcorrencia(candidatos, 25, async (doc) => {
    if (opcoes.orcamentoMs && deps.agora() - inicio > opcoes.orcamentoMs) return;
    const r = await reivindicar(deps, doc.ref).catch(() => null);
    if (!r) return;
    if (r.tipo === "encerrada") { if (r.status === "expired") contadores.expiradas++; else contadores.falhas++; return; }
    reivindicadas.push(r.r);
  });
  contadores.reivindicadas = reivindicadas.length;

  const porPush = new Map<string, Reivindicada[]>();
  for (const r of reivindicadas) porPush.set(r.pushId, [...(porPush.get(r.pushId) ?? []), r]);

  const ctx: Contexto = { prefs: new Map() };
  for (const [pushId, itens] of porPush) {
    await processarGrupo(deps, ctx, pushId, itens, contadores);
  }
  return contadores;
}

/** Agenda e já tenta entregar. É o que os produtores chamam. */
export async function publicarEEntregar(deps: Dependencias, spec: EspecPush): Promise<ResultadoDoProcessamento & { criado: boolean; destinos: number }> {
  const p = await publicarPush(deps, spec);
  // Já concluído: reprocessar seria gastar leituras pra descobrir que não há nada a fazer.
  if (p.concluido) return { ...zerado(), criado: p.criado, destinos: p.destinos };
  // Sem nenhum aparelho a alcançar não há grupo pra processar — mas o evento precisa registrar o porquê.
  if (p.destinos === 0) {
    await atualizarEstadoDoPush(deps, p.doc);
    return { ...zerado(), criado: p.criado, destinos: 0 };
  }
  const r = await processarEntregas(deps, { pushId: spec.pushId });
  return { ...r, criado: p.criado, destinos: p.destinos };
}

/** Situação atual dos destinos de um push — pro diagnóstico. */
export async function situacaoDoPush(deps: Dependencias, pushId: string) {
  const snap = await deps.db.collection(COLECAO_ENTREGAS).where("pushId", "==", pushId).get();
  const entregas = snap.docs.map((d) => d.data());
  return { ...resumirEntregas(entregas.map((e) => ({ status: e.status as StatusEntrega }))), entregas };
}

/**
 * Apaga pushes antigos e os destinos deles. O outbox guarda o payload com o
 * financeiro; mantê-lo além do útil é risco sem ganho. Só toca em push já
 * vencido há `retencaoMs` (padrão 14 dias).
 */
export async function limparEntregasAntigas(deps: Dependencias, retencaoMs = 14 * 24 * 3600 * 1000, limite = 100): Promise<number> {
  const corte = deps.agora() - retencaoMs;
  const antigos = await deps.db.collection(COLECAO_OUTBOX).where("expiraEm", "<", corte).limit(limite).get();
  let removidos = 0;
  for (const p of antigos.docs) {
    const destinos = await deps.db.collection(COLECAO_ENTREGAS).where("pushId", "==", p.id).get();
    for (const grupo of dividirEmLotes(destinos.docs, 400)) {
      const lote = deps.db.batch();
      grupo.forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
    await p.ref.delete();
    removidos++;
  }
  return removidos;
}

/**
 * O recibo de CLIQUE: a pessoa tocou na notificação deste aparelho.
 *
 * É um fato à parte de "aceito pelo provedor" (o servidor entregou ao FCM) e de
 * "lido" (a Central): tocar não marca como lido, e ler na Central não conta como
 * clique. Cada um responde uma pergunta diferente — o clique é a única evidência,
 * do lado do servidor, de que o aviso CHEGOU À PESSOA, e por isso é guardado.
 *
 * Idempotente: o clique repetido (reabrir pelo mesmo link) não sobrescreve o primeiro.
 * Só grava se o destino existe e foi ACEITO — clique num aviso que o servidor nunca
 * enviou àquele aparelho não é um fato que valha registrar.
 */
export async function registrarClique(
  db: Firestore,
  alvo: { pushId: string; registroDocId: string },
  agora = Date.now(),
): Promise<"registrado" | "ja_registrado" | "sem_entrega"> {
  const ref = db.collection(COLECAO_ENTREGAS).doc(idDaEntrega(alvo.pushId, alvo.registroDocId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.status !== "accepted") return "sem_entrega" as const;
    if (snap.data()?.clicadoEm) return "ja_registrado" as const;
    tx.update(ref, { clicadoEm: agora });
    return "registrado" as const;
  });
}
