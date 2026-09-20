// Puro — tipos e defaults das preferências de notificação. A leitura/escrita
// no Firestore fica em lib/notification-preferences.ts (server-only) e em
// lib/firebase/notification-preferences-client.ts (client, "use client").

import type { NotificationEventType } from "./notifications";

export type NotificationTogglesKey =
  | "sale_paid"
  | "sale_high_value"
  | "sale_low_margin"
  | "sale_negative_margin"
  | "sale_cancelled"
  | "return_completed"
  | "sales_summary"
  | "sync_warning"
  | "task_assigned"
  | "stock_low";

export type NotificationPreferences = {
  toggles: Record<NotificationTogglesKey, boolean>;
  /** "HH:MM" (fuso BR) — fora desse intervalo, notificação não-crítica não dispara push. */
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursEnabled: boolean;
  /** 0=domingo ... 6=sábado. Dias em que o horário silencioso vale — fora desses dias, silencioso não se aplica. */
  quietHoursDays: number[];
  highValueThreshold: number;
  groupFastSales: boolean;
  showFinancialValuesInPush: boolean;
  /** Quando true, só os tipos "críticos" (ver CRITICAL_NOTIFICATION_TYPES) mandam push — o resto só entra na Central. */
  onlyCritical: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  toggles: {
    sale_paid: true,
    sale_high_value: true,
    sale_low_margin: true,
    sale_negative_margin: true,
    sale_cancelled: true,
    return_completed: true,
    sales_summary: true,
    sync_warning: true,
    task_assigned: true,
    stock_low: true,
  },
  quietHoursStart: "22:30",
  quietHoursEnd: "07:30",
  quietHoursEnabled: false, // opt-in — não muda o comportamento de quem já usa notificações
  quietHoursDays: [0, 1, 2, 3, 4, 5, 6],
  highValueThreshold: 250,
  groupFastSales: true,
  showFinancialValuesInPush: true,
  onlyCritical: false,
};

/**
 * Tipos que ignoram horário silencioso e a opção "somente críticas" nunca
 * bloqueia — prejuízo e cancelamento são exatamente o tipo de coisa que vale
 * acordar alguém pra ver. O resto (mesmo venda de alto valor) pode esperar
 * o usuário acordar.
 */
export const CRITICAL_NOTIFICATION_TYPES: ReadonlySet<NotificationEventType> = new Set([
  "sale_negative_margin",
  "sale_cancelled",
  "return_completed",
]);

const TYPE_TO_TOGGLE: Record<NotificationEventType, NotificationTogglesKey | null> = {
  sale_paid: "sale_paid",
  sale_high_value: "sale_high_value",
  sale_low_margin: "sale_low_margin",
  sale_negative_margin: "sale_negative_margin",
  sale_cancelled: "sale_cancelled",
  return_opened: "return_completed",
  return_completed: "return_completed",
  sync_warning: "sync_warning",
  task_assigned: "task_assigned",
  stock_low: "stock_low",
  // Conquista sempre entra: é a única notificação boa do app, e ninguém
  // desliga de propósito o aviso de que bateu meta.
  milestone: null,
  system: null, // sistema não é opcional — sempre entra na Central; não é um push de venda
};

function parseHHMM(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** minutosAtuais/diaSemana já calculados no fuso BR por quem chama — função pura, sem Date/timezone aqui dentro. */
function dentroDoHorarioSilencioso(prefs: NotificationPreferences, minutosAtuais: number, diaSemana: number): boolean {
  if (!prefs.quietHoursEnabled || !prefs.quietHoursDays.includes(diaSemana)) return false;
  const start = parseHHMM(prefs.quietHoursStart);
  const end = parseHHMM(prefs.quietHoursEnd);
  // Janela pode cruzar a meia-noite (22:30 → 07:30): start > end nesse caso.
  if (start <= end) return minutosAtuais >= start && minutosAtuais < end;
  return minutosAtuais >= start || minutosAtuais < end;
}

/**
 * Decide se ESTE destinatário deve receber push pra este tipo de evento,
 * agora. Não decide nada sobre o evento em si (que já foi persistido de
 * qualquer forma) — só filtra a ENTREGA por push.
 *
 * `isSummary` troca o toggle checado de "toggles[type]" pra
 * "toggles.sales_summary" — é o caso do push AGRUPADO de vendas rápidas
 * (ver lib/notification-groups.ts): mesmo que o destinatário tenha
 * desativado o resumo, o tipo em si (ex.: sale_paid) segue regendo se o
 * evento é crítico/ignora horário silencioso, porque a natureza do evento
 * não muda por ele ter sido entregue agrupado.
 */
export function isPushAllowedForRecipient(
  type: NotificationEventType,
  prefs: NotificationPreferences,
  agoraBR: { minutosDoDia: number; diaSemana: number },
  isSummary = false,
): boolean {
  if (isSummary) {
    if (!prefs.toggles.sales_summary) return false;
  } else {
    const toggleKey = TYPE_TO_TOGGLE[type];
    if (toggleKey && !prefs.toggles[toggleKey]) return false;
  }

  const critico = CRITICAL_NOTIFICATION_TYPES.has(type);
  if (prefs.onlyCritical && !critico) return false;
  if (!critico && dentroDoHorarioSilencioso(prefs, agoraBR.minutosDoDia, agoraBR.diaSemana)) return false;

  return true;
}

// ── Leitura das preferências: ausente, inválida e indisponível NÃO são a mesma coisa ──

/**
 * O que a leitura das preferências de uma pessoa encontrou.
 *
 * Antes qualquer falha — documento inexistente, usuário sem conta, erro de
 * rede, campo com tipo errado — devolvia os DEFAULTS, e os defaults têm
 * `showFinancialValuesInPush: true`. Uma queda do Firestore virava, em
 * silêncio, consentimento pra mandar lucro e margem pra tela de bloqueio de
 * quem tinha desligado isso. As quatro situações pedem tratamentos diferentes:
 *
 *  - ausente: a pessoa nunca configurou nada. Os defaults SÃO a preferência
 *    dela, e é o que faz o app continuar como sempre foi pra quem não mexeu.
 *  - ok: preferência lida e válida.
 *  - invalida: o documento existe mas tem campo com tipo errado. Cada campo
 *    ruim cai no default — menos o do financeiro, que cai em NÃO mostrar.
 *  - indisponivel: não deu pra ler (rede, permissão, Auth). Não se sabe o que
 *    a pessoa quer; o envio adia e, esgotadas as tentativas, segue SEM
 *    financeiro.
 */
export type LeituraDePreferencias =
  | { estado: "ok"; prefs: NotificationPreferences }
  | { estado: "ausente"; prefs: NotificationPreferences }
  | { estado: "invalida"; prefs: NotificationPreferences; problemas: string[] }
  | { estado: "indisponivel"; prefs: NotificationPreferences; motivo: string };

function copiaDosDefaults(): NotificationPreferences {
  const base = DEFAULT_NOTIFICATION_PREFERENCES;
  return { ...base, toggles: { ...base.toggles }, quietHoursDays: [...base.quietHoursDays] };
}

/** Defaults com o financeiro DESLIGADO — o que se usa quando não se sabe o que a pessoa quer. */
export function preferenciasSeguras(): NotificationPreferences {
  return { ...copiaDosDefaults(), showFinancialValuesInPush: false };
}

const HHMM = /^([01]d|2[0-3]):[0-5]d$/;

function ehBooleano(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/**
 * Valida o documento cru de preferências, campo a campo.
 *
 * Não é tudo-ou-nada: um `highValueThreshold` corrompido não deve calar os
 * avisos da pessoa. O campo ruim volta ao default e vira um `problema`
 * registrado; o único campo que cai pro lado CONSERVADOR é o financeiro.
 */
export function interpretarPreferencias(cru: unknown): LeituraDePreferencias {
  if (cru === undefined || cru === null) {
    return { estado: "ausente", prefs: copiaDosDefaults() };
  }
  if (typeof cru !== "object" || Array.isArray(cru)) {
    return { estado: "invalida", prefs: preferenciasSeguras(), problemas: ["documento não é um objeto"] };
  }
  const d = cru as Record<string, unknown>;
  const problemas: string[] = [];
  const prefs = copiaDosDefaults();

  if (d.toggles !== undefined) {
    if (typeof d.toggles !== "object" || d.toggles === null || Array.isArray(d.toggles)) {
      problemas.push("toggles");
    } else {
      for (const chave of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.toggles) as NotificationTogglesKey[]) {
        const v = (d.toggles as Record<string, unknown>)[chave];
        if (v === undefined) continue;
        if (ehBooleano(v)) prefs.toggles[chave] = v;
        else problemas.push(`toggles.${chave}`);
      }
    }
  }
  for (const chave of ["quietHoursEnabled", "groupFastSales", "onlyCritical"] as const) {
    if (d[chave] === undefined) continue;
    if (ehBooleano(d[chave])) prefs[chave] = d[chave] as boolean;
    else problemas.push(chave);
  }
  for (const chave of ["quietHoursStart", "quietHoursEnd"] as const) {
    if (d[chave] === undefined) continue;
    if (typeof d[chave] === "string" && HHMM.test(d[chave] as string)) prefs[chave] = d[chave] as string;
    else problemas.push(chave);
  }
  if (d.quietHoursDays !== undefined) {
    const dias = d.quietHoursDays;
    if (Array.isArray(dias) && dias.every((x) => Number.isInteger(x) && x >= 0 && x <= 6)) {
      prefs.quietHoursDays = [...new Set(dias as number[])];
    } else problemas.push("quietHoursDays");
  }
  if (d.highValueThreshold !== undefined) {
    const v = d.highValueThreshold;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) prefs.highValueThreshold = v;
    else problemas.push("highValueThreshold");
  }
  // O financeiro cai pro lado conservador: campo ilegível NÃO é consentimento.
  if (d.showFinancialValuesInPush !== undefined) {
    if (ehBooleano(d.showFinancialValuesInPush)) {
      prefs.showFinancialValuesInPush = d.showFinancialValuesInPush;
    } else {
      prefs.showFinancialValuesInPush = false;
      problemas.push("showFinancialValuesInPush");
    }
  }

  return problemas.length > 0 ? { estado: "invalida", prefs, problemas } : { estado: "ok", prefs };
}

/** Leitura que falhou: nada se sabe da pessoa, então o financeiro fica DESLIGADO. */
export function preferenciasIndisponiveis(motivo: string): LeituraDePreferencias {
  return { estado: "indisponivel", prefs: preferenciasSeguras(), motivo };
}

/** A pessoa aceita valor financeiro no push? Só se a leitura foi limpa (ok/ausente) e ela deixou ligado. */
export function mostrarValoresNoPush(leitura: LeituraDePreferencias): boolean {
  if (leitura.estado === "indisponivel") return false;
  return leitura.prefs.showFinancialValuesInPush === true;
}
