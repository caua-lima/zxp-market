import { describe, expect, it } from "vitest";
import {
  CRITICAL_NOTIFICATION_TYPES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  avaliarPush,
  dentroDoHorarioSilencioso,
  fusoValido,
  interpretarPreferencias,
  relogioNoFuso,
  type NotificationPreferences,
} from "./notification-preferences";
import type { NotificationEventType } from "./notifications";

/**
 * Horário silencioso: limites exatos, virada da meia-noite, dias, fuso e a
 * mistura de críticos com comuns — o que a auditoria pede pra N14.
 */

function prefs(over: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles }, quietHoursEnabled: true, ...over };
}
const hm = (h: number, m = 0) => h * 60 + m;
// Os dias: 0 dom, 1 seg, 2 ter, 3 qua…

describe("janela no mesmo dia (09:00–17:00)", () => {
  const p = prefs({ quietHoursStart: "09:00", quietHoursEnd: "17:00" });

  it("o início é INCLUSIVO", () => expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(9), diaSemana: 2 })).toBe(true));
  it("o fim é EXCLUSIVO", () => expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(17), diaSemana: 2 })).toBe(false));
  it("um minuto antes do fim ainda é silêncio", () => expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(16, 59), diaSemana: 2 })).toBe(true));
  it("um minuto antes do início não é", () => expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(8, 59), diaSemana: 2 })).toBe(false));

  it("respeita os dias marcados", () => {
    const so_terca = prefs({ quietHoursStart: "09:00", quietHoursEnd: "17:00", quietHoursDays: [2] });
    expect(dentroDoHorarioSilencioso(so_terca, { minutosDoDia: hm(12), diaSemana: 2 })).toBe(true);
    expect(dentroDoHorarioSilencioso(so_terca, { minutosDoDia: hm(12), diaSemana: 3 })).toBe(false);
  });
});

describe("janela que CRUZA a meia-noite (22:30–07:30)", () => {
  const p = prefs({ quietHoursStart: "22:30", quietHoursEnd: "07:30", quietHoursDays: [1] }); // só a noite de SEGUNDA

  it("segunda 22:30 começa o silêncio (início inclusivo)", () => {
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(22, 30), diaSemana: 1 })).toBe(true);
  });

  it("segunda 22:29 ainda não", () => {
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(22, 29), diaSemana: 1 })).toBe(false);
  });

  it("TERÇA 02:00 ainda é a noite de segunda — o dia que conta é o do INÍCIO da janela", () => {
    // A regra antiga olhava o dia corrente (terça, não marcada) e deixava de silenciar a madrugada.
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(2), diaSemana: 2 })).toBe(true);
  });

  it("terça 07:29 ainda é silêncio; 07:30 já não é (fim exclusivo)", () => {
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(7, 29), diaSemana: 2 })).toBe(true);
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(7, 30), diaSemana: 2 })).toBe(false);
  });

  it("terça 22:30 é a noite de TERÇA — não marcada, sem silêncio", () => {
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(23), diaSemana: 2 })).toBe(false);
  });

  it("segunda 02:00 é a madrugada da noite de DOMINGO — não marcada", () => {
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(2), diaSemana: 1 })).toBe(false);
  });

  it("domingo → segunda atravessa a semana: a madrugada de domingo pertence ao sábado", () => {
    const sabado = prefs({ quietHoursStart: "22:30", quietHoursEnd: "07:30", quietHoursDays: [6] });
    expect(dentroDoHorarioSilencioso(sabado, { minutosDoDia: hm(3), diaSemana: 0 })).toBe(true);
  });

  it("de tarde não há silêncio", () => {
    expect(dentroDoHorarioSilencioso(p, { minutosDoDia: hm(15), diaSemana: 1 })).toBe(false);
  });
});

describe("casos degenerados", () => {
  it("desativado: nunca silencia", () => {
    expect(dentroDoHorarioSilencioso(prefs({ quietHoursEnabled: false }), { minutosDoDia: hm(2), diaSemana: 2 })).toBe(false);
  });
  it("início = fim não é 'o dia todo': nunca silencia", () => {
    expect(dentroDoHorarioSilencioso(prefs({ quietHoursStart: "08:00", quietHoursEnd: "08:00" }), { minutosDoDia: hm(8), diaSemana: 2 })).toBe(false);
  });
  it("nenhum dia marcado: nunca silencia", () => {
    expect(dentroDoHorarioSilencioso(prefs({ quietHoursDays: [] }), { minutosDoDia: hm(23), diaSemana: 2 })).toBe(false);
  });
  it("dias corrompidos no documento não derrubam o cálculo (viram o default, com o problema anotado)", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true, quietHoursDays: null });
    expect(leitura.estado).toBe("invalida");
    expect(() => dentroDoHorarioSilencioso(leitura.prefs, { minutosDoDia: hm(23), diaSemana: 2 })).not.toThrow();
  });
});

describe("relogioNoFuso", () => {
  // 2026-09-22 15:30 UTC — terça-feira.
  const T = Date.UTC(2026, 8, 22, 15, 30);

  it("Brasília: 12:30 de terça", () => {
    expect(relogioNoFuso(T, "America/Sao_Paulo")).toEqual({ minutosDoDia: hm(12, 30), diaSemana: 2 });
  });

  it("outro fuso, outra hora: Lisboa (UTC+1 no verão) 16:30", () => {
    expect(relogioNoFuso(T, "Europe/Lisbon")).toEqual({ minutosDoDia: hm(16, 30), diaSemana: 2 });
  });

  it("o DIA da semana também vem do fuso: 02:00 UTC de terça ainda é segunda à noite em Brasília", () => {
    expect(relogioNoFuso(Date.UTC(2026, 8, 22, 2, 0), "America/Sao_Paulo")).toEqual({ minutosDoDia: hm(23), diaSemana: 1 });
  });

  it("meia-noite é 0, não 24", () => {
    expect(relogioNoFuso(Date.UTC(2026, 8, 22, 3, 0), "America/Sao_Paulo").minutosDoDia).toBe(0);
  });

  it("fuso inválido cai no da operação, sem lançar", () => {
    expect(relogioNoFuso(T, "Marte/Olympus")).toEqual(relogioNoFuso(T, "America/Sao_Paulo"));
  });

  it("fusoValido", () => {
    expect(fusoValido("America/Sao_Paulo")).toBe(true);
    expect(fusoValido("Europe/Lisbon")).toBe(true);
    expect(fusoValido("Marte/Olympus")).toBe(false);
    expect(fusoValido("")).toBe(false);
    expect(fusoValido(42)).toBe(false);
  });

  it("a mesma pessoa em fusos diferentes cai em janelas diferentes", () => {
    const p = prefs({ quietHoursStart: "22:00", quietHoursEnd: "07:00" });
    const instante = Date.UTC(2026, 8, 22, 1, 30); // 22:30 em Brasília (segunda) / 02:30 em Lisboa
    expect(dentroDoHorarioSilencioso(p, relogioNoFuso(instante, "America/Sao_Paulo"))).toBe(true);
    expect(dentroDoHorarioSilencioso(p, relogioNoFuso(instante, "Asia/Tokyo"))).toBe(false); // 10:30 em Tóquio: fora do silêncio
  });
});

describe("avaliarPush — críticos e comuns juntos", () => {
  const madrugada = { minutosDoDia: hm(3), diaSemana: 2 };
  const tarde = { minutosDoDia: hm(15), diaSemana: 2 };
  const silencioso = prefs({ quietHoursStart: "22:30", quietHoursEnd: "07:30" });

  it("todos os críticos atravessam o silêncio; todos os comuns esperam", () => {
    const tipos: NotificationEventType[] = [
      "sale_paid", "sale_high_value", "sale_low_margin", "sale_negative_margin", "sale_cancelled",
      "return_opened", "return_completed", "sync_warning", "task_assigned", "stock_low", "milestone",
    ];
    for (const t of tipos) {
      const critico = CRITICAL_NOTIFICATION_TYPES.has(t);
      const r = avaliarPush(t, silencioso, madrugada);
      expect(r.permitido, t).toBe(critico);
      if (!r.permitido) expect(r.motivo, t).toBe("horario_silencioso");
    }
  });

  it("de tarde, tudo passa", () => {
    expect(avaliarPush("sale_paid", silencioso, tarde).permitido).toBe(true);
  });

  it("'somente críticas' bloqueia o comum com o motivo certo, dentro e fora do silêncio", () => {
    const so_criticas = prefs({ onlyCritical: true, quietHoursEnabled: false });
    expect(avaliarPush("sale_paid", so_criticas, tarde)).toEqual({ permitido: false, motivo: "preferencia_somente_criticas" });
    expect(avaliarPush("sale_cancelled", so_criticas, tarde).permitido).toBe(true);
  });

  it("todos bloqueados: silêncio + só críticas + tudo desligado = nenhum push", () => {
    const tudo_off = prefs({ onlyCritical: true, toggles: Object.fromEntries(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.toggles).map((k) => [k, false])) as NotificationPreferences["toggles"] });
    for (const t of ["sale_paid", "sale_cancelled", "sale_negative_margin", "milestone", "return_opened"] as const) {
      expect(avaliarPush(t, tudo_off, madrugada).permitido, t).toBe(false);
    }
  });

  it("o toggle vence a travessia do silêncio", () => {
    const p = prefs({ toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, sale_cancelled: false } });
    expect(avaliarPush("sale_cancelled", p, madrugada)).toEqual({ permitido: false, motivo: "preferencia_toggle" });
  });

  it("devolução ABERTA e concluída têm toggles próprios; marco também", () => {
    const p = prefs({ quietHoursEnabled: false, toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, return_completed: false } });
    expect(avaliarPush("return_opened", p, tarde).permitido).toBe(true);
    expect(avaliarPush("return_completed", p, tarde).permitido).toBe(false);
    const semMarco = prefs({ quietHoursEnabled: false, toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, milestone: false } });
    expect(avaliarPush("milestone", semMarco, tarde)).toEqual({ permitido: false, motivo: "preferencia_toggle" });
  });

  it("o resumo usa o toggle de resumo, não o do tipo", () => {
    const p = prefs({ quietHoursEnabled: false, toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, sales_summary: false } });
    expect(avaliarPush("sale_paid", p, tarde, true)).toEqual({ permitido: false, motivo: "preferencia_resumo_desligado" });
    expect(avaliarPush("sale_paid", p, tarde, false).permitido).toBe(true);
  });

  it("'system' nunca depende de toggle", () => {
    expect(avaliarPush("system", prefs({ quietHoursEnabled: false }), tarde).permitido).toBe(true);
  });
});
