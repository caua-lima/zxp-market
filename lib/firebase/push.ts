"use client";

import { doc, getDoc } from "firebase/firestore";
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { authedFetch } from "@/lib/api/authed-fetch";
import {
  decidirReconciliacao,
  idDoRegistro,
  lerVinculoLocal,
  situacaoDoVinculo,
  type VinculoLocal,
} from "@/lib/domain/push-registro";
import { getFirebase } from "./client";

const SW_PATH = "/firebase-messaging-sw.js";
const DEVICE_ID_KEY = "push_device_id";
/** Vínculo DESTE navegador com uma pessoa. Substitui a antiga chave global `push_enabled`. */
const VINCULO_KEY = "push_vinculo";
/** Chave antiga: valia pro navegador, não pra pessoa. Só é lida pra migrar. */
const FLAG_LEGADO = "push_enabled";
/** Intenção da PESSOA de receber push neste navegador. Sobrevive ao logout, morre no "desativar". */
const OPTIN_PREFIXO = "push_optin:";
/** Tokens cujo desvínculo no servidor ainda não foi confirmado (sem rede ao sair, por exemplo). */
const PENDENTES_KEY = "push_desvinculos_pendentes";
const EVENTO_MUDOU = "push-vinculo-mudou";

// localStorage pode lançar (modo privado, cota, dados bloqueados): nada aqui
// pode derrubar o app por causa disso.
function ler(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravar(chave: string, valor: string): void {
  try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: o app segue, só não lembra */ }
}
function remover(chave: string): void {
  try { localStorage.removeItem(chave); } catch { /* idem */ }
}

/**
 * Id estável desta INSTALAÇÃO (navegador/PWA), guardado no localStorage.
 *
 * Existe porque o token do FCM ROTACIONA (reinstalação do app, limpeza de
 * dados, renovação automática do Firebase). O documento é identificado por
 * (pessoa, instalação), então renovar o token sobrescreve o mesmo registro em
 * vez de criar outro — a origem da notificação duplicada.
 */
export function getDeviceId(): string {
  let id = ler(DEVICE_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `d${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, "");
    if (id.length < 8) id = id.padEnd(8, "0");
    gravar(DEVICE_ID_KEY, id);
  }
  return id;
}

function lerVinculo(): VinculoLocal | null {
  return lerVinculoLocal(ler(VINCULO_KEY));
}

function definirVinculo(v: VinculoLocal | null): void {
  if (v) gravar(VINCULO_KEY, JSON.stringify(v)); else remover(VINCULO_KEY);
  remover(FLAG_LEGADO);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_MUDOU));
}

/** Avisa quem mostra o estado do push que ele mudou (login, logout, reconciliação). */
export function aoMudarVinculoDoPush(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENTO_MUDOU, cb);
  return () => window.removeEventListener(EVENTO_MUDOU, cb);
}

const optin = {
  tem: (email: string) => ler(OPTIN_PREFIXO + email.toLowerCase()) === "1",
  liga: (email: string) => gravar(OPTIN_PREFIXO + email.toLowerCase(), "1"),
  desliga: (email: string) => remover(OPTIN_PREFIXO + email.toLowerCase()),
};

function lerPendentes(): string[] {
  try {
    const v = JSON.parse(ler(PENDENTES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch { return []; }
}
function gravarPendentes(tokens: string[]): void {
  if (tokens.length === 0) remover(PENDENTES_KEY); else gravar(PENDENTES_KEY, JSON.stringify([...new Set(tokens)]));
}

export type PushStatus = "unsupported" | "off" | "on" | "denied";

function suportado(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

/**
 * Estado das notificações PARA A PESSOA QUE ESTÁ NA TELA, neste aparelho.
 *
 * Antes lia uma chave global do navegador: quem entrava depois de outra
 * pessoa via "ativas" sem ter registro nenhum. Agora "on" exige que o vínculo
 * deste navegador seja do e-mail atual.
 */
export async function getPushStatus(email?: string | null): Promise<PushStatus> {
  if (!suportado()) return "unsupported";
  if (!(await isSupported().catch(() => false))) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return situacaoDoVinculo(lerVinculo(), email) === "ativo" ? "on" : "off";
}

type ResultadoDaAcao = { ok: true; pendente?: boolean } | { ok: false; error: string };

/**
 * Registra o Service Worker e GARANTE que a versão publicada é a que está
 * tratando os pushes.
 *
 * `register()` sozinho não basta. O navegador guarda o Service Worker em
 * cache e, mesmo quando baixa um novo, o antigo continua no comando até todas
 * as janelas do app fecharem — num PWA de celular, que vive em segundo plano,
 * isso pode não acontecer por dias. O resultado é uma correção publicada que
 * simplesmente não entra em vigor, sem nada indicando o porquê.
 *
 * `update()` força a checagem agora; o `skipWaiting`/`clients.claim` do lado
 * do Service Worker (ver app/firebase-messaging-sw.js/route.ts) faz o novo
 * assumir na hora. Ativar as notificações passa a ser também o botão de
 * "aplicar a versão nova", que é o gesto que o usuário já faz quando algo
 * não chega.
 */
async function registrarServiceWorkerAtualizado(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SW_PATH, { updateViaCache: "none" });
  // Best-effort: falha de rede aqui não pode impedir o registro do token.
  await registration.update().catch(() => {});
  return registration;
}

/** Versão do Service Worker ATIVO — pergunta direto a ele, não ao servidor. */
export async function versaoServiceWorkerAtivo(): Promise<string | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    const sw = reg?.active;
    if (!sw) return null;
    return await new Promise<string | null>((resolve) => {
      const canal = new MessageChannel();
      // Service Worker antigo não conhece esta mensagem e nunca responde —
      // o timeout é o que transforma esse silêncio em "versão antiga".
      const timer = setTimeout(() => resolve(null), 1500);
      canal.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data?.versao ?? null);
      };
      sw.postMessage({ tipo: "versao" }, [canal.port2]);
    });
  } catch {
    return null;
  }
}

/** Gera (ou lê) o token FCM deste navegador. Não pede permissão. */
async function obterToken(): Promise<string | null> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) return null;
  const registration = await registrarServiceWorkerAtualizado();
  const { app } = getFirebase();
  return (await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration })) || null;
}

async function vincularNoServidor(token: string): Promise<ResultadoDaAcao> {
  try {
    const res = await authedFetch("/api/push/vincular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, deviceId: getDeviceId(), userAgent: navigator.userAgent }),
    });
    if (res.ok) return { ok: true };
    const json = await res.json().catch(() => null) as { details?: string } | null;
    return { ok: false, error: json?.details ?? `O servidor recusou o registro (${res.status}).` };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor — não consegui registrar este aparelho." };
  }
}

/**
 * Desfaz o registro no servidor. `comSessao: false` usa só a posse do token
 * (ver app/api/push/desvincular) — é o que funciona depois de sair da conta.
 */
async function desvincularNoServidor(
  criterio: { token?: string; deviceId?: string },
  comSessao: boolean,
): Promise<boolean> {
  try {
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(criterio),
    };
    const res = comSessao ? await authedFetch("/api/push/desvincular", init) : await fetch("/api/push/desvincular", init);
    return res.ok;
  } catch {
    return false;
  }
}

/** Invalida o token no FCM. Sem rede falha em silêncio — o que importa é o servidor ter parado de mandar. */
async function apagarTokenLocal(): Promise<boolean> {
  try {
    const { app } = getFirebase();
    return await deleteToken(getMessaging(app));
  } catch {
    return false;
  }
}

/** Refaz os desvínculos que não foram confirmados antes (sem rede ao sair). Não exige sessão. */
async function descarregarPendentes(): Promise<void> {
  const pendentes = lerPendentes();
  if (pendentes.length === 0) return;
  const restantes: string[] = [];
  for (const token of pendentes) {
    if (!(await desvincularNoServidor({ token }, false))) restantes.push(token);
  }
  gravarPendentes(restantes);
}

/**
 * Pede permissão, registra o Service Worker, gera o token FCM e o vincula a
 * ESTA pessoa no servidor — é essa lista que o backend usa pra saber pra
 * quem mandar. Só marca "ativo" depois que o servidor confirmou.
 */
export async function enablePushNotifications(email: string): Promise<ResultadoDaAcao> {
  if (!suportado()) return { ok: false, error: "Este navegador não suporta notificações." };
  if (!(await isSupported().catch(() => false))) {
    return { ok: false, error: "Este navegador não suporta notificações push." };
  }
  if (!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY) {
    return { ok: false, error: "Notificações ainda não configuradas neste projeto (falta a chave VAPID)." };
  }

  // No iOS (PWA na Tela de Início) o pedido de permissão só funciona a partir
  // de um gesto do usuário — este método é chamado pelo clique do botão.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Permissão negada — ative notificações para este site nas configurações do navegador." };
  }

  try {
    const token = await obterToken();
    if (!token) return { ok: false, error: "Não consegui gerar o token de notificação." };

    const r = await vincularNoServidor(token);
    if (!r.ok) return r;

    definirVinculo({ email: email.toLowerCase(), deviceId: getDeviceId(), token, em: Date.now() });
    optin.liga(email);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao ativar notificações." };
  }
}

/**
 * Desativa neste aparelho e conta o que REALMENTE aconteceu.
 *
 * Antes o erro era engolido e o botão voltava a "desligado" com o registro
 * ainda no servidor — a pessoa achava que tinha parado e o push continuava.
 * Agora:
 *  - servidor confirmou: desligado de verdade;
 *  - servidor não respondeu mas o token local foi invalidado: também parou
 *    (um token morto é recusado pelo FCM e o servidor limpa o registro), e a
 *    limpeza fica pendente pra próxima conexão — `pendente: true`;
 *  - nenhuma das duas: continua ATIVO, com o erro na tela.
 */
export async function disablePushNotifications(email: string): Promise<ResultadoDaAcao> {
  const vinculo = lerVinculo();
  const token = vinculo?.token;

  const noServidor = await desvincularNoServidor({ deviceId: getDeviceId(), token }, true);
  if (noServidor) {
    await apagarTokenLocal();
    definirVinculo(null);
    optin.desliga(email);
    return { ok: true };
  }

  if (await apagarTokenLocal()) {
    if (token) gravarPendentes([...lerPendentes(), token]);
    definirVinculo(null);
    optin.desliga(email);
    return { ok: true, pendente: true };
  }

  return { ok: false, error: "Sem conexão — não consegui desativar. Nada mudou; tente de novo quando estiver online." };
}

/**
 * Chamado ANTES de encerrar a sessão: solta o push desta pessoa deste
 * aparelho. Nunca lança e nunca trava a saída.
 *
 * O token é anotado como pendente ANTES de qualquer chamada: se a aba fechar
 * no meio, ou a rede cair, o desvínculo é refeito na próxima abertura. A
 * intenção da pessoa (`optin`) é mantida — entrar de novo neste navegador
 * reativa o push sozinho, sem pedir nada.
 */
export async function soltarPushAoSair(): Promise<void> {
  const vinculo = lerVinculo();
  if (!vinculo) return;

  gravarPendentes([...lerPendentes(), vinculo.token]);
  const confirmou = await Promise.race([
    desvincularNoServidor({ deviceId: vinculo.deviceId, token: vinculo.token }, true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
  ]);
  if (confirmou) gravarPendentes(lerPendentes().filter((t) => t !== vinculo.token));
  // Invalida o token no FCM: mesmo sem rede pro servidor, ele para de valer.
  await Promise.race([apagarTokenLocal(), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);
  definirVinculo(null);
}

let emailDoPush: string | null = null;
let reconciliando: Promise<void> | null = null;

/** Diz ao módulo quem está na tela. Vale pro filtro do primeiro plano e pra reconciliação. */
export function definirUsuarioDoPush(email: string | null | undefined): void {
  emailDoPush = email ? email.toLowerCase() : null;
}

/**
 * Alinha este navegador com a pessoa que está na tela: login, troca de conta,
 * rotação de token, migração da chave antiga.
 *
 * Roda a cada mudança de usuário e é idempotente — chamar duas vezes seguidas
 * é seguro (a segunda espera a primeira).
 */
export function reconciliarPush(email: string): Promise<void> {
  if (reconciliando) return reconciliando;
  reconciliando = executarReconciliacao(email.toLowerCase()).finally(() => { reconciliando = null; });
  return reconciliando;
}

async function executarReconciliacao(email: string): Promise<void> {
  try {
    if (!suportado() || !(await isSupported().catch(() => false))) return;
    await descarregarPendentes();

    let vinculo = lerVinculo();

    // Migração: a chave antiga dizia "ativo" pro navegador, sem dizer de quem.
    // Só se herda quando o servidor PROVA que esta pessoa registrou esta
    // instalação — o registro antigo tinha o id (e-mail, instalação).
    if (!vinculo && ler(FLAG_LEGADO) === "1" && Notification.permission === "granted") {
      try {
        const { db } = getFirebase();
        const snap = await getDoc(doc(db, "pushTokens", idDoRegistro(email, getDeviceId())));
        const token = snap.exists() ? String(snap.data()?.token ?? "") : "";
        if (token) {
          vinculo = { email, deviceId: getDeviceId(), token, em: Date.now() };
          definirVinculo(vinculo);
          optin.liga(email);
        }
      } catch { /* sem leitura: tenta na próxima */ }
      remover(FLAG_LEGADO);
    }

    const permissao = typeof Notification !== "undefined" ? Notification.permission : "indisponivel";
    const querPush = optin.tem(email);
    let tokenAtual: string | null = null;
    if (permissao === "granted" && querPush) {
      tokenAtual = await obterToken().catch(() => null);
    }

    const decisao = decidirReconciliacao({ permissao, vinculo, emailAtual: email, querPush, tokenAtual });

    if (decisao.acao === "soltar_do_anterior" && vinculo) {
      await desvincularNoServidor({ token: vinculo.token }, false);
      definirVinculo(null);
    } else if (decisao.acao === "reativar" && tokenAtual) {
      const r = await vincularNoServidor(tokenAtual);
      if (r.ok) definirVinculo({ email, deviceId: getDeviceId(), token: tokenAtual, em: Date.now() });
    }
  } catch {
    /* reconciliar é oportunista: falhar aqui não pode afetar o login */
  }
}

let foregroundInited = false;

/** Mesmos campos que lib/push-send.ts serializa em `data` — ver SalePushPayload em lib/domain/notifications.ts. */
export type ForegroundPushEvent = {
  eventId: string;
  type: string;
  title: string;
  body: string;
  tag: string;
  orderId?: string;
  deepLink: string;
  productName?: string;
  grossAmount?: string;
  estimatedProfit?: string;
  estimatedMargin?: string;
  financialState?: string;
  /** JSON de { title, quantity }[] — ver o campo homônimo em SalePushPayload. */
  itensJson?: string;
  timestamp: string;
};

const foregroundListeners = new Set<(evt: ForegroundPushEvent) => void>();

/**
 * Assina eventos de push chegando com o app ABERTO — é o que alimenta o
 * toast premium (SaleNotificationProvider). Retorna a função de cancelar a
 * assinatura, padrão useEffect.
 */
export function onForegroundPush(cb: (evt: ForegroundPushEvent) => void): () => void {
  foregroundListeners.add(cb);
  return () => foregroundListeners.delete(cb);
}

/**
 * Com o app ABERTO em primeiro plano, o FCM não mostra notificação nativa
 * sozinho (isso só acontece em segundo plano, via Service Worker) — sem
 * isto, uma venda que chega com o dashboard aberto na tela passaria em
 * silêncio. Chamado uma vez na raiz do app; idempotente.
 *
 * NÃO abre mais um `new Notification()` nativo aqui: o toast premium (ver
 * components/SaleNotificationProvider.tsx) é a experiência de foreground —
 * mostrar os dois ao mesmo tempo duplicaria o aviso pro usuário com a aba
 * focada, o mesmo princípio de "nunca duas notificações pro mesmo evento"
 * que já rege a deduplicação por dispositivo.
 *
 * O listener é único e global, mas descarta a mensagem quando o vínculo do
 * navegador não é da pessoa que está na tela: o conteúdo foi projetado pro
 * dono do registro (com ou sem financeiro), e mostrá-lo a outra pessoa
 * anularia a redação por nível de acesso.
 */
export async function initForegroundPush(): Promise<void> {
  if (foregroundInited || typeof window === "undefined") return;
  if (!(await isSupported().catch(() => false))) return;
  foregroundInited = true;

  const { app } = getFirebase();
  const messaging = getMessaging(app);
  onMessage(messaging, (payload) => {
    if (situacaoDoVinculo(lerVinculo(), emailDoPush) !== "ativo") return;
    // Lê de "data", não "notification" — o envio manda só "data" de
    // propósito (ver lib/push-send.ts) pra nunca correr o risco do próprio
    // Firebase exibir a notificação em paralelo com este código.
    const d = payload.data;
    if (!d?.title) return;
    const evt: ForegroundPushEvent = {
      eventId: d.eventId ?? "", type: d.type ?? "system", title: d.title, body: d.body ?? "",
      tag: d.tag ?? "", orderId: d.orderId || undefined, deepLink: d.deepLink ?? "/",
      productName: d.productName || undefined, grossAmount: d.grossAmount || undefined,
      estimatedProfit: d.estimatedProfit || undefined, estimatedMargin: d.estimatedMargin || undefined,
      financialState: d.financialState || undefined,
      itensJson: d.itensJson || undefined,
      timestamp: d.timestamp ?? new Date().toISOString(),
    };
    foregroundListeners.forEach((cb) => cb(evt));
  });
}
