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
