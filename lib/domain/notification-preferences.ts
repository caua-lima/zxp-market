// Puro — tipos, defaults e regras das preferências de notificação. A leitura/
// escrita no Firestore fica em lib/notification-preferences.ts (server-only) e
// em lib/firebase/data.ts (cliente).

import type { NotificationEventType } from "./notifications";

export type NotificationTogglesKey =
  | "sale_paid"
  | "sale_high_value"
  | "sale_low_margin"
  | "sale_negative_margin"
  | "sale_cancelled"
  | "return_opened"
  | "return_completed"
  | "sales_summary"
  | "sync_warning"
  | "task_assigned"
  | "stock_low"
  | "milestone";

export type NotificationPreferences = {
  toggles: Record<NotificationTogglesKey, boolean>;
  /** "HH:MM" no fuso `quietHoursTimezone` — dentro desse intervalo, aviso comum NÃO vira push. */
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursEnabled: boolean;
  /**
   * 0=domingo ... 6=sábado. O dia em que a JANELA COMEÇA: "segunda" com
   * 22:30–07:30 cobre de segunda 22:30 até terça 07:30 — inclusive as 02:00 de
   * terça, que é quando de fato se está dormindo.
   */
  quietHoursDays: number[];
  /** Fuso IANA em que o horário acima é lido. Fixo no deslocamento −3h, quem viajasse ficava com o silêncio errado. */
  quietHoursTimezone: string;
  /** Os avisos críticos (prejuízo, cancelamento, devolução concluída) atravessam o silêncio? */
  quietHoursCriticalBypass: boolean;
  /**
   * A partir de que valor bruto ESTA PESSOA quer o aviso de "alto valor". É uma
   * preferência de apresentação: não altera o evento nem a Central, que
   * guardam a classificação da operação.
   */
  highValueThreshold: number;
  /** Vendas em rajada viram um resumo pra esta pessoa (as demais recebem uma a uma). */
  groupFastSales: boolean;
  showFinancialValuesInPush: boolean;
  /** Quando true, só os tipos "críticos" (ver CRITICAL_NOTIFICATION_TYPES) mandam push — o resto só entra na Central. */
  onlyCritical: boolean;
};

/** O fuso da operação. Antes era um −3h espalhado pelo código; o Brasil não tem horário de verão desde 2019, mas o fuso é uma escolha, não uma constante aritmética. */
export const FUSO_DA_OPERACAO = "America/Sao_Paulo";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  toggles: {
    sale_paid: true,
    sale_high_value: true,
    sale_low_margin: true,
    sale_negative_margin: true,
    sale_cancelled: true,
    return_opened: true,
    return_completed: true,
    sales_summary: true,
    sync_warning: true,
    task_assigned: true,
    stock_low: true,
    milestone: true,
  },
  quietHoursStart: "22:30",
  quietHoursEnd: "07:30",
  quietHoursEnabled: false, // opt-in — não muda o comportamento de quem já usa notificações
  quietHoursDays: [0, 1, 2, 3, 4, 5, 6],
  quietHoursTimezone: FUSO_DA_OPERACAO,
  quietHoursCriticalBypass: true,
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
 *
 * "Atravessar o silêncio" continua sujeito ao toggle do próprio tipo: quem
 * desligou "Pedido cancelado" não recebe, crítico ou não.
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
  // Antes "devolução aberta" usava o toggle da concluída, e marco não tinha
  // toggle nenhum — a pessoa que desligava "Devolução concluída" perdia sem
  // saber também o aviso de devolução aberta, e ninguém podia silenciar um marco.
  return_opened: "return_opened",
  return_completed: "return_completed",
  sync_warning: "sync_warning",
  task_assigned: "task_assigned",
  stock_low: "stock_low",
  milestone: "milestone",
  system: null, // sistema não é opcional — sempre entra na Central; não é um push de venda
};

// ── O relógio da pessoa ─────────────────────────────────────────────────

export type RelogioLocal = { minutosDoDia: number; diaSemana: number };

/** O fuso existe? (`Intl` lança RangeError pra nome inválido.) */
export function fusoValido(fuso: unknown): fuso is string {
  if (typeof fuso !== "string" || fuso.length === 0 || fuso.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

const DIAS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Minutos desde 00:00 e dia da semana (0=domingo) EM `fuso`, num instante.
 *
 * Usa o banco de fusos do próprio ambiente em vez de somar um deslocamento
 * fixo: pra quem está em outro fuso, o "22:30" das preferências é 22:30 dele.
 * Fuso inválido cai no da operação — nunca lança, porque o cálculo roda no
 * meio do envio de todos os destinatários.
 */
export function relogioNoFuso(agora: number, fuso: string): RelogioLocal {
  const tz = fusoValido(fuso) ? fuso : FUSO_DA_OPERACAO;
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(new Date(agora));
  const pega = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return {
    minutosDoDia: (Number(pega("hour")) % 24) * 60 + Number(pega("minute")),
    diaSemana: Math.max(0, DIAS_EN.indexOf(pega("weekday"))),
  };
}

function parseHHMM(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * O horário silencioso está valendo AGORA?
 *
 * Início inclusivo, fim exclusivo. Janela que cruza a meia-noite (22:30 → 07:30)
 * pertence ao dia em que COMEÇA: às 02:00 de terça, o que decide é se SEGUNDA
 * está marcada. Olhar o dia corrente fazia a madrugada de terça sumir do
 * silêncio de quem marcou só a noite de segunda. Início = fim não define
 * janela nenhuma (nunca silencia) — não vale como "o dia inteiro".
 */
export function dentroDoHorarioSilencioso(prefs: NotificationPreferences, relogio: RelogioLocal): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const inicio = parseHHMM(prefs.quietHoursStart);
  const fim = parseHHMM(prefs.quietHoursEnd);
  const { minutosDoDia: m, diaSemana } = relogio;

  if (inicio === fim) return false;
  if (inicio < fim) return m >= inicio && m < fim && prefs.quietHoursDays.includes(diaSemana);

  // Cruza a meia-noite.
  if (m >= inicio) return prefs.quietHoursDays.includes(diaSemana);
  if (m < fim) return prefs.quietHoursDays.includes((diaSemana + 6) % 7);
  return false;
}

/** Por que um push NÃO sai — vira o `motivo` do destino suprimido, pra a pessoa (e o diagnóstico) saberem qual regra agiu. */
export type MotivoDoBloqueio =
  | "preferencia_toggle"
  | "preferencia_resumo_desligado"
  | "preferencia_somente_criticas"
  | "horario_silencioso";

export type AvaliacaoDoPush = { permitido: true } | { permitido: false; motivo: MotivoDoBloqueio };

/**
 * Decide se ESTE destinatário deve receber push pra este tipo de evento,
 * agora. Não decide nada sobre o evento em si (que já foi persistido de
 * qualquer forma) — só filtra a ENTREGA por push.
 *
 * `isSummary` troca o toggle checado de "toggles[type]" pra
 * "toggles.sales_summary" — é o caso do push AGRUPADO de vendas rápidas
 * (ver lib/domain/janela-de-vendas.ts): mesmo que o destinatário tenha
 * desativado o resumo, o tipo em si (ex.: sale_paid) segue regendo se o
 * evento é crítico/ignora horário silencioso, porque a natureza do evento
 * não muda por ele ter sido entregue agrupado.
 *
 * Ordem dos filtros: toggle do tipo → "somente críticas" → horário silencioso.
 * Um crítico atravessa os DOIS últimos (se `quietHoursCriticalBypass`), mas
 * nunca o primeiro.
 */
export function avaliarPush(
  type: NotificationEventType,
  prefs: NotificationPreferences,
  relogio: RelogioLocal,
  isSummary = false,
): AvaliacaoDoPush {
  if (isSummary) {
    if (!prefs.toggles.sales_summary) return { permitido: false, motivo: "preferencia_resumo_desligado" };
  } else {
    const toggleKey = TYPE_TO_TOGGLE[type];
    if (toggleKey && !prefs.toggles[toggleKey]) return { permitido: false, motivo: "preferencia_toggle" };
  }

  const critico = CRITICAL_NOTIFICATION_TYPES.has(type);
  if (prefs.onlyCritical && !critico) return { permitido: false, motivo: "preferencia_somente_criticas" };

  const atravessa = critico && prefs.quietHoursCriticalBypass;
  if (!atravessa && dentroDoHorarioSilencioso(prefs, relogio)) return { permitido: false, motivo: "horario_silencioso" };

  return { permitido: true };
}

/** Compatibilidade: a mesma decisão como booleano. */
export function isPushAllowedForRecipient(
  type: NotificationEventType,
  prefs: NotificationPreferences,
  relogio: RelogioLocal,
  isSummary = false,
): boolean {
  return avaliarPush(type, prefs, relogio, isSummary).permitido;
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

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  for (const chave of ["quietHoursEnabled", "quietHoursCriticalBypass", "groupFastSales", "onlyCritical"] as const) {
    if (d[chave] === undefined) continue;
    if (ehBooleano(d[chave])) prefs[chave] = d[chave] as boolean;
    else problemas.push(chave);
  }
  for (const chave of ["quietHoursStart", "quietHoursEnd"] as const) {
    if (d[chave] === undefined) continue;
    if (typeof d[chave] === "string" && HHMM.test(d[chave] as string)) prefs[chave] = d[chave] as string;
    else problemas.push(chave);
  }
  if (d.quietHoursTimezone !== undefined) {
    if (fusoValido(d.quietHoursTimezone)) prefs.quietHoursTimezone = d.quietHoursTimezone;
    else problemas.push("quietHoursTimezone");
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
