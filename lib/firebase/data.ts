"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import {
  CUSTO_FAIXA_SENTINELA,
  type AccessEntry,
  type AdsAlteracao,
  type AuditAction,
  type AuditEntity,
  type AuditEvent,
  type Cost,
  type CustoFaixa,
  type DraftToday,
  type EstoqueMovimento,
  type GoalEntry,
  type Goals,
  type Product,
  type Task,
} from "@/lib/domain/types";
import type { NotificationEvent } from "@/lib/domain/notifications";
import { getFirebase } from "./client";
import { assinarComCache, invalidar } from "./cache";

function sanitizeUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

function getCurrentUserEmail(): string {
  const auth = getAuth();
  const email = auth.currentUser?.email;
  if (!email) throw new Error("User not authenticated");
  return email;
}

// ─── path helpers (apenas coleções globais compartilhadas) ─────
function sCol(name: string) {
  const { db } = getFirebase();
  return collection(db, name);
}

function sDoc(name: string, id: string) {
  const { db } = getFirebase();
  return doc(db, name, id);
}

function aDoc(email: string) {
  const { db } = getFirebase();
  return doc(db, "controleAcesso", email.toLowerCase());
}

function aCol() {
  const { db } = getFirebase();
  return collection(db, "controleAcesso");
}

function accessMetaDoc() {
  const { db } = getFirebase();
  return doc(db, "controleAcessoMeta", "config");
}

// ── Draft (Hoje) ──────────────────────────────────────────────
export function draftRef() {
  return sDoc("rascunho", "hoje");
}

export async function saveDraft(_uid: string, draft: DraftToday) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc("rascunho", "hoje"), {
    ...draft,
    createdBy: email,
    updatedAt: Date.now(),
  });
}

export async function clearDraft(_uid: string) {
  await deleteDoc(sDoc("rascunho", "hoje"));
}

export function watchDraft(
  _uid: string,
  cb: (d: DraftToday | null) => void,
): () => void {
  return onSnapshot(sDoc("rascunho", "hoje"), (snap) => {
    cb(snap.exists() ? (snap.data() as DraftToday) : null);
  });
}

// ── Goals (legacy single-doc) ─────────────────────────────────
export async function saveGoals(_uid: string, g: Goals) {
  await setDoc(sDoc("metas", "config"), g);
}

export function watchGoals(
  _uid: string,
  cb: (g: Goals | null) => void,
): () => void {
  return onSnapshot(sDoc("metas", "config"), (snap) => {
    cb(snap.exists() ? (snap.data() as Goals) : null);
  });
}

// ── Goal Entries (history) ────────────────────────────────────
const CHAVE_METAS = "metasHistorico";
export function watchGoalEntries(
  _uid: string,
  cb: (entries: GoalEntry[]) => void,
): () => void {
  // limit(60) = 5 anos de metas mensais — nunca deveria ser o gargalo, mas
  // sem teto nenhum um listener global fica mais caro pra sempre conforme o
  // histórico cresce (achado da cota do Firestore estourada: metasHistorico,
  // dias e estoque_movimentos eram os únicos listeners sem limit() no app).
  return assinarComCache(CHAVE_METAS, async () => {
    const snap = await getDocs(query(sCol("metasHistorico"), orderBy("createdAt", "desc"), limit(60)));
    return snap.docs.map((d) => d.data() as GoalEntry);
  }, cb);
}

export async function saveGoalEntry(_uid: string, entry: GoalEntry) {
  const email = getCurrentUserEmail();
  const id = entry.id || `goal_${Date.now()}`;
  const payload = sanitizeUndefined({
    ...entry,
    id,
    createdBy: email,
    createdAt: entry.createdAt ?? Date.now(),
  });
  await setDoc(sDoc("metasHistorico", id), payload);
  invalidar(CHAVE_METAS);
}

export async function updateGoalEntry(
  _uid: string,
  id: string,
  patch: Partial<GoalEntry>,
) {
  await updateDoc(sDoc("metasHistorico", id), sanitizeUndefined(patch));
  invalidar(CHAVE_METAS);
}

export async function deleteGoalEntry(_uid: string, id: string) {
  await deleteDoc(sDoc("metasHistorico", id));
  invalidar(CHAVE_METAS);
}

// ── Costs ─────────────────────────────────────────────────────
const CHAVE_CUSTOS = "custos";

/** Também vive o app inteiro (useUserData) e quase nunca muda. */
export function watchCosts(
  _uid: string,
  cb: (costs: Cost[]) => void,
): () => void {
  return assinarComCache(CHAVE_CUSTOS, async () => {
    const snap = await getDocs(sCol("custos"));
    return snap.docs.map((d) => d.data() as Cost);
  }, cb);
}

export async function upsertCost(_uid: string, cost: Cost) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc("custos", cost.id), { ...cost, createdBy: email });
  invalidar(CHAVE_CUSTOS);
}

export async function deleteCost(_uid: string, id: string) {
  await deleteDoc(sDoc("custos", id));
  invalidar(CHAVE_CUSTOS);
}

// ── Products / Stock ──────────────────────────────────────────
const CHAVE_PRODUTOS = "estoque";

/** Montado em useUserData, ou seja: vivo o app inteiro, em toda aba. */
export function watchProducts(
  _uid: string,
  cb: (ps: Product[]) => void,
): () => void {
  return assinarComCache(CHAVE_PRODUTOS, async () => {
    const snap = await getDocs(query(sCol("estoque"), orderBy("name", "asc")));
    return snap.docs.map((d) => d.data() as Product).sort((a, b) => a.name.localeCompare(b.name));
  }, cb);
}

export async function upsertProduct(_uid: string, product: Product) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc("estoque", product.id), { ...product, createdBy: email });
  invalidar(CHAVE_PRODUTOS);
}

export async function deleteProduct(_uid: string, id: string) {
  await deleteDoc(sDoc("estoque", id));
  invalidar(CHAVE_PRODUTOS);
}

// ── Movimentações de estoque (galpão) ──────────────────────────
const MOV_COL = "estoque_movimentos";

// Guarda o custo médio com 4 casas (o display mostra 2). Assim o CMV não
// acumula erro de centavos em volumes grandes (ex.: 300 un a R$10,3333).
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Recalcula o `qtdLocal` (estoque no galpão) a partir do livro e, se informado,
 * grava também o `custoMedio` já calculado pela entrada (blend contra o estoque
 * atual — feito no cliente, que conhece o estoque do Full) e uma FAIXA de
 * vigência dele (ver custoNaData em lib/domain/types.ts): a entrada nova só
 * vale a partir de `dataMovimento` pra frente. Sem isso, dar entrada em
 * estoque hoje mudava a margem de vendas já feitas há meses — reportado como
 * bug: "+100 unidades" e o custo médio novo retroagia pra vendas passadas.
 */
async function recomputeProduto(productId: string, custoMedio?: number, dataMovimento?: string): Promise<void> {
  const snap = await getDocs(query(sCol(MOV_COL), where("productId", "==", productId)));
  const movs = snap.docs.map((d) => d.data() as EstoqueMovimento);

  let qty = 0; // estoque no galpão (em casa)
  for (const m of movs) {
    const q = Number(m.quantidade) || 0;
    if (m.tipo === "entrada") qty += Math.abs(q);
    else if (m.tipo === "saida_full") qty -= Math.abs(q);
    else if (m.tipo === "saldo_inicial") { /* já está fora do galpão (ex.: Full) */ }
    else qty += q; // ajuste: com sinal
  }

  const patch: Record<string, unknown> = { qtdLocal: qty };
  if (custoMedio != null && Number.isFinite(custoMedio)) {
    const novo = round4(custoMedio);
    patch.custoMedio = novo;

    const prodSnap = await getDoc(sDoc("estoque", productId));
    const prodData = prodSnap.data() as { custoMedio?: number; custo?: string; custoMedioFaixas?: CustoFaixa[] } | undefined;
    const faixas: CustoFaixa[] = Array.isArray(prodData?.custoMedioFaixas) ? [...prodData!.custoMedioFaixas!] : [];
    // Primeira vez que este produto passa por aqui: grava o custo ANTERIOR
    // como faixa retroativa (sentinela bem no passado) antes de acrescentar a
    // faixa nova — sem isso, todo pedido já sincronizado (sem faixa própria)
    // cairia direto no custo novo, o mesmo bug que estamos corrigindo.
    if (faixas.length === 0) {
      const custoAnterior = Number(prodData?.custoMedio ?? prodData?.custo ?? 0) || 0;
      faixas.push({ desde: CUSTO_FAIXA_SENTINELA, custo: custoAnterior });
    }
    const dia = (dataMovimento || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const idx = faixas.findIndex((f) => f.desde === dia);
    if (idx >= 0) faixas[idx] = { desde: dia, custo: novo };
    else faixas.push({ desde: dia, custo: novo });
    patch.custoMedioFaixas = faixas;
  }
  await updateDoc(sDoc("estoque", productId), patch);
}

/**
 * ERA o maior consumidor de leitura do app, com folga: até 1500 documentos,
 * montado em AvisoRemessasFull (que renderiza no DASHBOARD, a aba inicial),
 * em EstoqueTab e em FullTab. Como onSnapshot, cada abertura do app custava
 * os 1500 de uma vez, e qualquer movimentação nova relia tudo de novo em toda
 * aba aberta.
 *
 * Agora é busca única compartilhada (ver lib/firebase/cache.ts): os três
 * componentes dividem a MESMA leitura, e remontar não custa nada enquanto o
 * cache está quente. addMovimento/deleteMovimento invalidam, então o próprio
 * usuário nunca vê dado velho depois de mexer.
 */
const CHAVE_MOV = "estoque_movimentos";

export function watchMovimentos(
  cb: (movs: EstoqueMovimento[]) => void,
): () => void {
  return assinarComCache(CHAVE_MOV, async () => {
    const snap = await getDocs(query(sCol(MOV_COL), orderBy("data", "desc"), limit(1500)));
    return snap.docs.map((d) => d.data() as EstoqueMovimento);
  }, cb);
}

/**
 * Versão enxuta pro aviso do Dashboard.
 *
 * AvisoRemessasFull só precisa saber se as remessas dos últimos ~25 dias já
 * têm baixa (`remessaTemBaixa`), mas usava o watchMovimentos completo — 1500
 * documentos lidos na ABERTURA DO APP, já que ele renderiza no Dashboard, só
 * pra checar um punhado de remessas recentes. 200 cobre com folga a janela
 * que o aviso enxerga, e é chave de cache separada pra não brigar com a lista
 * completa que Estoque/Full precisam.
 */
export function watchMovimentosRecentes(
  cb: (movs: EstoqueMovimento[]) => void,
): () => void {
  return assinarComCache("estoque_movimentos:recentes", async () => {
    const snap = await getDocs(query(sCol(MOV_COL), orderBy("data", "desc"), limit(200)));
    return snap.docs.map((d) => d.data() as EstoqueMovimento);
  }, cb);
}

// ── Remessas do Full já resolvidas ─────────────────────────────
const REMESSA_COL = "full_remessas";

/**
 * Marca uma remessa como resolvida sem mexer no estoque. Serve para as que
 * já foram lançadas à mão antes desta tela existir: sem isso, elas ficariam
 * para sempre pedindo uma baixa que geraria contagem dobrada.
 */
export async function ignorarRemessaFull(remessa: string, motivo = "baixa já lançada à mão"): Promise<void> {
  await setDoc(sDoc(REMESSA_COL, remessa), {
    remessa, ignorada: true, motivo,
    createdBy: getCurrentUserEmail(), createdAt: Date.now(),
  });
  invalidar(CHAVE_REMESSAS);
}

export async function reabrirRemessaFull(remessa: string): Promise<void> {
  await deleteDoc(sDoc(REMESSA_COL, remessa));
  invalidar(CHAVE_REMESSAS);
}

/**
 * Custo da coleta informado a mao, por remessa.
 *
 * Existe porque a API publica do Mercado Livre NAO expoe esse valor: a
 * propria doc de Fulfillment diz que "atraves das APIs voce pode apenas
 * consultar o estoque de fulfillment e as operacoes realizadas". O valor
 * aparece so na tela de detalhe do envio no Seller Center, em "Tarifas >
 * Custo da coleta Full", quase sempre marcado como ESTIMADO (calculado por
 * volume x distancia ate o centro).
 *
 * Guardar aqui e o que permite esse custo real entrar no Resultado liquido
 * da DRE. `merge: true` de proposito: a mesma colecao guarda a marcacao de
 * "remessa ja resolvida" (ignorarRemessaFull) e um nao pode apagar o outro.
 */
export async function salvarCustoRemessaFull(remessa: string, custo: number | null): Promise<void> {
  await setDoc(
    sDoc(REMESSA_COL, remessa),
    sanitizeUndefined({
      remessa,
      // null limpa o valor: quem digitou errado precisa conseguir voltar pro
      // estado "sem custo informado", que e diferente de "custou zero".
      custoManual: custo == null || !Number.isFinite(custo) ? null : custo,
      custoInformadoPor: getCurrentUserEmail(),
      custoInformadoEm: Date.now(),
    }),
    { merge: true },
  );
  invalidar(CHAVE_REMESSAS);
}

const CHAVE_REMESSAS = "full_remessas";

export function watchRemessasIgnoradas(cb: (ids: Set<string>) => void): () => void {
  return assinarComCache(CHAVE_REMESSAS, async () => {
    const snap = await getDocs(sCol(REMESSA_COL));
    // Só as marcadas como ignoradas: o mesmo doc também guarda custoManual,
    // e um doc que só tem custo NÃO pode sumir da lista de pendentes.
    return new Set(snap.docs.filter((d) => d.data()?.ignorada === true).map((d) => d.id));
  }, cb);
}

export async function addMovimento(
  mov: Omit<EstoqueMovimento, "createdBy" | "createdAt">,
  custoMedio?: number,
): Promise<void> {
  const email = getCurrentUserEmail();
  await setDoc(
    sDoc(MOV_COL, mov.id),
    sanitizeUndefined({ ...mov, createdBy: email, createdAt: Date.now() }),
  );
  await recomputeProduto(mov.productId, custoMedio, mov.data);
  invalidar(CHAVE_MOV);
  invalidar("estoque_movimentos:recentes");
  invalidar(CHAVE_PRODUTOS); // recomputeProduto mexe em qtdLocal/custoMedio
}

/**
 * Corrige uma movimentação JÁ existente (data, quantidade, obs) sem apagar e
 * recriar — `createdBy`/`createdAt` originais ficam intactos; a correção fica
 * registrada em `updatedBy`/`updatedAt`, separado, pra não parecer que a
 * movimentação sempre teve o valor novo.
 *
 * NÃO aceita mudar `custoUnit` aqui de propósito. `entrada`/`saldo_inicial`
 * blendam o custo digitado contra o custo médio DO MOMENTO em que foram
 * criadas (ver MovimentoModal em EstoqueTab.tsx) — mudar o custo depois não
 * refaz esse blend, só sobrescreveria o número sem recalcular o que já foi
 * apurado a partir dele (faixas de vigência inclusive). Corrigir custo errado
 * continua sendo excluir e lançar de novo, que É a forma correta: gera um
 * blend novo, na data certa.
 */
export async function updateMovimento(
  id: string,
  productId: string,
  /**
   * `custoUnit` entra aqui porque é o campo que mais se digita errado, e o que
   * mais estraga: ele alimenta o custo médio, que vira CMV em todo pedido
   * daquele produto. Sem poder corrigir, a única saída era excluir e relançar
   * — perdendo o histórico de quem lançou e quando.
   *
   * Não precisa recalcular o custo médio à mão: recomputeProduto varre TODAS
   * as movimentações do produto de novo, então corrigir uma entrada antiga
   * conserta a média sozinho.
   */
  patch: { data?: string; quantidade?: number; obs?: string; custoUnit?: number },
): Promise<void> {
  const email = getCurrentUserEmail();
  const snap = await getDoc(sDoc(MOV_COL, id));
  if (!snap.exists()) throw new Error("Movimentação não encontrada — pode já ter sido excluída.");
  const atual = snap.data() as EstoqueMovimento;
  const proxima: EstoqueMovimento = {
    ...atual, ...patch,
    updatedBy: email, updatedAt: Date.now(),
  };
  await setDoc(sDoc(MOV_COL, id), sanitizeUndefined(proxima));
  await recomputeProduto(productId, undefined, proxima.data);
  invalidar(CHAVE_MOV);
  invalidar("estoque_movimentos:recentes");
  invalidar(CHAVE_PRODUTOS);
}

export async function deleteMovimento(id: string, productId: string): Promise<void> {
  await deleteDoc(sDoc(MOV_COL, id));
  await recomputeProduto(productId);
  invalidar(CHAVE_MOV);
  invalidar("estoque_movimentos:recentes");
  invalidar(CHAVE_PRODUTOS);
}

// ── Financeiro: cofrinho semi-automático ──────────────────────
// Guardado em metas/financeiro_manual. Cofrinho = base + repasses liberados
// (auto do MP) − saídas (manuais) + rendimento (120% CDI). O MP não expõe
// saldo/cofrinho pela API, então a base é informada por você e re-sincronizada.
export type SaidaFin = { id: string; data: string; valor: number; desc?: string };
export type FinanceiroManual = {
  cofrinhoBase: number;   // valor do cofrinho quando você fixou a base
  baseTs: number;         // quando a base foi fixada (ms) — a partir daqui soma o liberado
  saldoConta: number;     // saldo disponível na conta (≈0, manual)
  cdiAnual: number;       // CDI anual em % (ex.: 15) — rende 120% disso
  saidas: SaidaFin[];     // saques/transferências manuais
  updatedAt?: number;
  updatedBy?: string;
};

export function watchFinanceiroManual(cb: (f: FinanceiroManual) => void): () => void {
  return onSnapshot(sDoc("metas", "financeiro_manual"), (snap) => {
    const d = snap.data() ?? {};
    cb({
      cofrinhoBase: Number(d.cofrinhoBase ?? d.cofrinho ?? 0),
      baseTs: Number(d.baseTs ?? 0),
      saldoConta: Number(d.saldoConta ?? 0),
      cdiAnual: Number(d.cdiAnual ?? 0),
      saidas: Array.isArray(d.saidas) ? (d.saidas as SaidaFin[]) : [],
      updatedAt: d.updatedAt,
      updatedBy: d.updatedBy,
    });
  });
}

/** Fixa a base do cofrinho (valor + CDI + saldo). Registra o instante (baseTs). */
export async function saveFinanceiroBase(v: { cofrinhoBase: number; cdiAnual: number; saldoConta: number }): Promise<void> {
  const email = getCurrentUserEmail();
  await setDoc(
    sDoc("metas", "financeiro_manual"),
    // Re-ancorar zera as saídas: a base nova já reflete tudo até agora.
    { cofrinhoBase: v.cofrinhoBase, cdiAnual: v.cdiAnual, saldoConta: v.saldoConta, baseTs: Date.now(), saidas: [], updatedAt: Date.now(), updatedBy: email },
    { merge: true },
  );
}

/** Grava a lista de saídas (saques/transferências). */
export async function saveFinanceiroSaidas(saidas: SaidaFin[]): Promise<void> {
  const email = getCurrentUserEmail();
  await setDoc(
    sDoc("metas", "financeiro_manual"),
    { saidas, updatedAt: Date.now(), updatedBy: email },
    { merge: true },
  );
}

// ── Tarefas (Kanban) ────────────────────────────────────────────
// Coleção compartilhada, sem dono: owner e colaborador leem e escrevem igual
// (ver firestore.rules) — é o que permite um atribuir tarefa pro outro.
const TASK_COL = "tarefas";
const CHAVE_TAREFAS = "tarefas";

export function watchTasks(cb: (tasks: Task[]) => void): () => void {
  // limit(500) — sem teto, essa era a última coleção do time (compartilhada,
  // vista por todo mundo) sem limit() num listener global. Achado ao investigar
  // a cota do Firestore esgotando TODO DIA: watchTasks roda em DOIS lugares ao
  // mesmo tempo sempre que o app está aberto — Dashboard.tsx (pro card de
  // tarefas atrasadas) e TarefasTab.tsx (o Kanban) — cada aba/dispositivo aberto
  // de cada pessoa do time reabre esse listener inteiro a cada mudança em
  // QUALQUER tarefa, de QUALQUER pessoa. Sem teto, o custo só cresce conforme o
  // quadro acumula tarefas concluídas ao longo dos meses.
  return assinarComCache(CHAVE_TAREFAS, async () => {
    const snap = await getDocs(query(sCol(TASK_COL), orderBy("createdAt", "desc"), limit(500)));
    return snap.docs.map((d) => d.data() as Task);
  }, cb, {
    // TTL curto: o Kanban é compartilhado e duas pessoas mexem nele ao mesmo
    // tempo. 60s é o meio-termo entre ver o card do outro andar e não reler
    // 500 documentos a cada mudança em cada aba aberta.
    ttl: 60 * 1000,
  });
}

export async function upsertTask(task: Task) {
  const email = getCurrentUserEmail();
  await setDoc(sDoc(TASK_COL, task.id), sanitizeUndefined({
    ...task,
    createdBy: task.createdBy ?? email,
    updatedAt: Date.now(),
  }));
  invalidar(CHAVE_TAREFAS);
}

export async function deleteTask(id: string) {
  await deleteDoc(sDoc(TASK_COL, id));
  invalidar(CHAVE_TAREFAS);
}

// ── Central de Atenção: alertas dispensados ────────────────────
// Cada dispensa é por (usuário, chave do alerta) — um doc por par, igual ao
// padrão de pushTokens. Guarda o `valorRef` de quando foi dispensado pra dar
// pra comparar depois: se o número piorou, o alerta volta a aparecer sozinho
// (ver alertShouldReappear em lib/domain/alerts.ts) em vez de ficar escondido
// pra sempre.
const ALERTS_COL = "alertasDispensados";

export type AlertDismissEntry = { chave: string; email: string; valorRef: number; dispensadoEm: number };

function alertDismissDocId(email: string, chave: string): string {
  return `${email.replace(/\//g, "_")}__${chave}`;
}

export function watchDismissedAlerts(email: string, cb: (entries: AlertDismissEntry[]) => void): () => void {
  const q = query(sCol(ALERTS_COL), where("email", "==", email));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as AlertDismissEntry));
  });
}

export async function dismissAlert(email: string, chave: string, valorRef: number): Promise<void> {
  await setDoc(sDoc(ALERTS_COL, alertDismissDocId(email, chave)), {
    email, chave, valorRef, dispensadoEm: Date.now(),
  });
}

export async function undismissAlert(email: string, chave: string): Promise<void> {
  await deleteDoc(sDoc(ALERTS_COL, alertDismissDocId(email, chave)));
}

// ── Access Control (global collection) ────────────────────────
export function watchAccessList(
  cb: (entries: AccessEntry[]) => void,
): () => void {
  return assinarComCache("controleAcesso", async () => {
    const snap = await getDocs(query(aCol(), orderBy("email", "asc")));
    return snap.docs.map((d) => d.data() as AccessEntry);
  }, cb);
}

export async function addAccessEntry(entry: AccessEntry) {
  await setDoc(aDoc(entry.email), sanitizeUndefined({
    ...entry,
    email: entry.email.toLowerCase(),
    addedAt: Date.now(),
  }));
  invalidar("controleAcesso");
}

export async function bootstrapAccessOwner(entry: AccessEntry) {
  await setDoc(aDoc(entry.email), sanitizeUndefined({
    ...entry,
    email: entry.email.toLowerCase(),
    addedAt: Date.now(),
  }));
  await setDoc(accessMetaDoc(), {
    ownerEmail: entry.email.toLowerCase(),
    createdAt: Date.now(),
  });
}

export async function updateAccessEntry(
  email: string,
  patch: Partial<AccessEntry>,
) {
  await updateDoc(aDoc(email), sanitizeUndefined(patch));
  invalidar("controleAcesso");
}

export async function removeAccessEntry(email: string) {
  await deleteDoc(aDoc(email));
  invalidar("controleAcesso");
}

export async function checkAccess(email: string): Promise<AccessEntry | null> {
  const snap = await getDoc(aDoc(email));
  return snap.exists() ? (snap.data() as AccessEntry) : null;
}

/** Acompanha em tempo real o registro de acesso de UM e-mail (ex.: a própria foto de perfil). */
export function watchAccessEntry(
  email: string,
  cb: (entry: AccessEntry | null) => void,
): () => void {
  return onSnapshot(aDoc(email), (snap) => {
    cb(snap.exists() ? (snap.data() as AccessEntry) : null);
  });
}

export async function getAccessBootstrap(): Promise<{ ownerEmail: string } | null> {
  const snap = await getDoc(accessMetaDoc());
  return snap.exists() ? (snap.data() as { ownerEmail: string }) : null;
}

export async function isAccessListEmpty(): Promise<boolean> {
  const snap = await getDocs(query(aCol(), limit(1)));
  return snap.empty;
}

// ── Trilha de auditoria (global collection, append-only) ────────
// Registrada explicitamente pelas telas em ações discretas (clique em
// "Salvar"/"Arquivar"/"Excluir"), nunca pelas funções genéricas de
// upsert/patch acima — evita virar ruído com o auto-save por campo do
// Custos. As regras do Firestore proíbem update/delete: uma vez gravado,
// o evento é permanente.
export async function logAudit(evt: {
  acao: AuditAction;
  entidade: AuditEntity;
  entidadeId: string;
  entidadeLabel: string;
  detalhe?: string;
}): Promise<void> {
  const email = getCurrentUserEmail();
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(sDoc("auditLog", id), sanitizeUndefined({ ...evt, id, por: email, em: Date.now() }));
}

/**
 * `onError` não é opcional por capricho: sem ele, uma falha de permissão
 * (regra do Firestore ainda não publicada, papel rebaixado) fazia o
 * onSnapshot nunca chamar o callback de sucesso — e a tela ficava em
 * "Carregando…" pra sempre, sem nenhuma pista do que aconteceu. Era esse o
 * "a trilha de auditoria não funciona": ela não estava vazia, estava travada.
 */
export function watchAuditLog(
  cb: (events: AuditEvent[]) => void,
  max = 200,
  onError?: (msg: string) => void,
): () => void {
  const q = query(sCol("auditLog"), orderBy("em", "desc"), limit(max));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as AuditEvent)),
    (err) => onError?.(err instanceof Error ? err.message : String(err)),
  );
}

// ── Central de Notificações (Fase 7) ────────────────────────────
// O evento em si (criação, classificação, delivery de push) é escrito só
// pelo backend (ver lib/notification-events.ts) — aqui é só leitura +
// marcar lido/dispensado, os dois únicos campos que firestore.rules deixa o
// cliente tocar.
export function watchNotificationEvents(cb: (events: NotificationEvent[]) => void, max = 50): () => void {
  // limit(50) de propósito — sem isso o listener ficaria cada vez mais caro
  // conforme o histórico cresce (é o requisito explícito da Fase 7: nunca um
  // listener global sem limite).
  const q = query(sCol("notification_events"), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as NotificationEvent));
  });
}

export async function markNotificationRead(eventId: string, email: string): Promise<void> {
  await updateDoc(sDoc("notification_events", eventId), { [`readBy.${email}`]: Date.now() }).catch(() => {});
}

export async function markNotificationDismissed(eventId: string, email: string): Promise<void> {
  await updateDoc(sDoc("notification_events", eventId), { [`dismissedBy.${email}`]: Date.now() }).catch(() => {});
}

// ── Preferências de notificação por usuário ──────────────────────
// usuarios/{uid}/preferences/notifications — cada um só lê/escreve a
// própria (ver firestore.rules). uid, não e-mail, porque é assim que o
// backend resolve o destinatário via Admin Auth (ver
// lib/notification-preferences.ts) sem precisar manter um mapa email→uid.
function prefsDoc(uid: string) {
  const { db } = getFirebase();
  return doc(db, "usuarios", uid, "preferences", "notifications");
}

export function watchNotificationPreferences(
  uid: string,
  cb: (prefs: Record<string, unknown> | null) => void,
): () => void {
  return onSnapshot(prefsDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null));
}

export async function saveNotificationPreferences(uid: string, prefs: Record<string, unknown>): Promise<void> {
  await setDoc(prefsDoc(uid), prefs);
}

// ── Últimas alterações de Ads ────────────────────────────────────
// Registro manual (não vem do ML): "alterei o ROAS pra 20x" — serve pra
// saber quando cada campanha foi mexida da última vez. campaignId/productId
// já vêm prontos de quem chama (AdsChangelogPanel), não são recalculados
// aqui — filtrar por produto depois é só uma query direta em productId.
const ADS_LOG_COL = "ads_alteracoes";

/** O cache do changelog é chaveado por `max`, então invalidamos as variações
 *  usadas hoje — mais simples e seguro do que rastrear qual delas está viva. */
function invalidarAdsLog() {
  for (const max of [50, 100, 300]) invalidar(`ads_alteracoes:${max}`);
}

export function watchAdsAlteracoes(cb: (entries: AdsAlteracao[]) => void, max = 300): () => void {
  // limit() desde o primeiro commit desta coleção — lição da cota do
  // Firestore estourada (achado: listener sem teto é o jeito mais fácil de
  // zerar as 50k leituras/dia do plano gratuito). 300 cobre bastante
  // histórico sem custo crescente pra sempre.
  return assinarComCache(`ads_alteracoes:${max}`, async () => {
    const snap = await getDocs(query(sCol(ADS_LOG_COL), orderBy("createdAt", "desc"), limit(max)));
    return snap.docs.map((d) => d.data() as AdsAlteracao);
  }, cb);
}

export async function addAdsAlteracao(entry: Omit<AdsAlteracao, "id" | "createdBy" | "createdAt">): Promise<void> {
  const email = getCurrentUserEmail();
  const id = `adslog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(sDoc(ADS_LOG_COL, id), sanitizeUndefined({ ...entry, id, createdBy: email, createdAt: Date.now() }));
  invalidarAdsLog();
}

export async function deleteAdsAlteracao(id: string): Promise<void> {
  await deleteDoc(sDoc(ADS_LOG_COL, id));
  invalidarAdsLog();
}
