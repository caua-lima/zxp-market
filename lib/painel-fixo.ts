"use client";

import { authedFetch } from "@/lib/api/authed-fetch";
import { enablePushNotifications, getDeviceId, getPushStatus } from "@/lib/firebase/push";
import { conteudoPainelFixo, desenharPainelFixo, TAG_PAINEL_FIXO, type PincelDoPainel, type PlacarFixo } from "@/lib/domain/painel-fixo";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";

/**
 * O mini painel FIXO das vendas ao vivo, do lado do app: ligar, desligar e
 * reescrever a notificação enquanto o app está aberto. Com o app fechado, quem
 * reescreve é o Service Worker, a cada push "ao_vivo" (ver
 * app/firebase-messaging-sw.js/route.ts) — o texto e o desenho são os MESMOS
 * (lib/domain/painel-fixo.ts).
 *
 * Fixar depende das notificações deste aparelho: o placar chega por push. Por
 * isso ligar o painel ativa as notificações primeiro, se ainda não estiverem.
 */

const SW_PATH = "/firebase-messaging-sw.js";
const CHAVE = "painel-fixo";

type OpcoesDaNotificacao = NotificationOptions & { image?: string; renotify?: boolean; timestamp?: number; requireInteraction?: boolean };

export function painelFixoSuportado(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

/** O painel está fixado NESTE navegador (para a empresa e a pessoa atuais — a chave tem escopo). */
export function painelFixoLigado(): boolean {
  return lerChaveApp(CHAVE) === "1";
}

const EVENTO = "painel-fixo-mudou";
/** Avisa quem mostra o botão que o estado mudou (outra aba, ou o próprio botão). */
export function aoMudarPainelFixo(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENTO, cb);
  return () => window.removeEventListener(EVENTO, cb);
}
function avisarMudanca() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO));
}

async function registro(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration(SW_PATH)) ?? null;
  } catch {
    return null;
  }
}

async function pedirAoServidor(ligado: boolean): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const r = await authedFetch("/api/push/painel-fixo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId(), ligado }),
    });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { mensagem?: string };
    return { ok: false, erro: j.mensagem ?? "Não deu pra fixar agora. Tente de novo." };
  } catch {
    return { ok: false, erro: "Sem conexão. Tente de novo." };
  }
}

/** Fixa o painel: ativa as notificações se preciso, marca este aparelho no servidor e lembra aqui. */
export async function ligarPainelFixo(email: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!painelFixoSuportado()) return { ok: false, erro: "Este navegador não mostra notificações. No iPhone, adicione o app à Tela de Início primeiro." };
  const status = await getPushStatus(email);
  if (status === "denied") return { ok: false, erro: "As notificações deste site estão bloqueadas. Libere nas configurações do navegador e tente de novo." };
  if (status !== "on") {
    const r = await enablePushNotifications(email);
    if (!r.ok) return { ok: false, erro: r.error };
  }
  const r = await pedirAoServidor(true);
  if (!r.ok) return r;
  gravarChaveApp(CHAVE, "1");
  ultimaAssinatura = "";
  avisarMudanca();
  return { ok: true };
}

/** Desafixa: some da barra agora e o servidor para de mandar o placar pra este aparelho. */
export async function desligarPainelFixo(): Promise<void> {
  gravarChaveApp(CHAVE, "0");
  ultimaAssinatura = "";
  avisarMudanca();
  const reg = await registro();
  try {
    for (const n of (await reg?.getNotifications({ tag: TAG_PAINEL_FIXO })) ?? []) n.close();
  } catch { /* sem acesso às notificações: o servidor ainda para de mandar */ }
  await pedirAoServidor(false);
}

/** O desenho do painel num canvas da página, como imagem (o Android mostra ao expandir). */
function imagemDoPainel(placar: PlacarFixo, agora: number): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    desenharPainelFixo(ctx as unknown as PincelDoPainel, placar, agora, 720, 360);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

let ultimaAssinatura = "";

/**
 * Reescreve o painel com o número que a barra mostra agora. Não faz nada se o
 * painel não está fixado, sem permissão, ou se nada que aparece mudou (a barra
 * se atualiza o tempo todo e cada reescrita é trabalho do sistema).
 */
export async function mostrarPainelFixo(placar: PlacarFixo): Promise<void> {
  if (!painelFixoSuportado() || !painelFixoLigado() || Notification.permission !== "granted") return;
  const agora = Date.now();
  const c = conteudoPainelFixo(placar, agora);
  const assinatura = [c.title, c.body, placar.porHora.join(","), placar.meta?.pct ?? ""].join("|");
  if (assinatura === ultimaAssinatura) return;
  ultimaAssinatura = assinatura;

  const reg = await registro();
  if (!reg) return;
  const opcoes: OpcoesDaNotificacao = {
    body: c.body, tag: c.tag, timestamp: c.timestamp,
    icon: "/manifest-icon-192", badge: "/manifest-icon-192",
    silent: true, renotify: false, requireInteraction: true,
    data: { deepLink: "/?tipo=ao_vivo", eventId: "", tipo: "ao_vivo" },
  };
  const imagem = imagemDoPainel(placar, agora);
  try {
    await reg.showNotification(c.title, imagem ? { ...opcoes, image: imagem } : opcoes);
  } catch {
    try { await reg.showNotification(c.title, opcoes); } catch { ultimaAssinatura = ""; }
  }
}
