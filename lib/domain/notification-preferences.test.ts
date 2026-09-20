import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  interpretarPreferencias,
  mostrarValoresNoPush,
  preferenciasIndisponiveis,
  preferenciasSeguras,
} from "./notification-preferences";

describe("interpretarPreferencias — ausente, válida e inválida não são a mesma coisa", () => {
  it("documento inexistente: 'ausente' e os defaults são a preferência da pessoa", () => {
    const r = interpretarPreferencias(undefined);
    expect(r.estado).toBe("ausente");
    expect(r.prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(mostrarValoresNoPush(r)).toBe(true);
  });

  it("documento válido: 'ok' com os valores da pessoa", () => {
    const r = interpretarPreferencias({ showFinancialValuesInPush: false, highValueThreshold: 500, toggles: { sale_paid: false } });
    expect(r.estado).toBe("ok");
    expect(r.prefs.highValueThreshold).toBe(500);
    expect(r.prefs.toggles.sale_paid).toBe(false);
    expect(r.prefs.toggles.sale_cancelled).toBe(true);
    expect(mostrarValoresNoPush(r)).toBe(false);
  });

  it("financeiro com tipo errado NÃO é consentimento", () => {
    for (const ruim of ["false", 0, null, "sim", {}]) {
      const r = interpretarPreferencias({ showFinancialValuesInPush: ruim });
      expect(r.estado, String(ruim)).toBe("invalida");
      expect(mostrarValoresNoPush(r), String(ruim)).toBe(false);
    }
  });

  it("campo ruim não derruba o resto: cai no default e é reportado", () => {
    const r = interpretarPreferencias({ highValueThreshold: "muito", quietHoursStart: "25:99", toggles: { sale_paid: "nao" }, onlyCritical: true });
    expect(r.estado).toBe("invalida");
    if (r.estado !== "invalida") return;
    expect(r.problemas).toEqual(expect.arrayContaining(["highValueThreshold", "quietHoursStart", "toggles.sale_paid"]));
    expect(r.prefs.onlyCritical).toBe(true);
    expect(r.prefs.highValueThreshold).toBe(DEFAULT_NOTIFICATION_PREFERENCES.highValueThreshold);
    expect(r.prefs.toggles.sale_paid).toBe(true);
  });

  it("dias fora de 0–6 invalidam o campo", () => {
    expect(interpretarPreferencias({ quietHoursDays: [1, 9] }).estado).toBe("invalida");
    expect(interpretarPreferencias({ quietHoursDays: [1, 2, 2] }).estado).toBe("ok");
  });

  it("limiar negativo ou infinito é inválido", () => {
    expect(interpretarPreferencias({ highValueThreshold: -1 }).estado).toBe("invalida");
    expect(interpretarPreferencias({ highValueThreshold: Infinity }).estado).toBe("invalida");
  });

  it("documento que não é objeto é inválido e seguro", () => {
    for (const cru of ["texto", 3, [], true]) {
      const r = interpretarPreferencias(cru);
      expect(r.estado).toBe("invalida");
      expect(mostrarValoresNoPush(r)).toBe(false);
    }
  });

  it("não devolve o objeto de defaults compartilhado — mutar não contamina", () => {
    const r = interpretarPreferencias(undefined);
    r.prefs.toggles.sale_paid = false;
    expect(DEFAULT_NOTIFICATION_PREFERENCES.toggles.sale_paid).toBe(true);
  });
});

describe("leitura indisponível", () => {
  it("nunca vira consentimento pra mostrar dinheiro", () => {
    const r = preferenciasIndisponiveis("firestore: 14");
    expect(r.estado).toBe("indisponivel");
    expect(mostrarValoresNoPush(r)).toBe(false);
    expect(r.prefs.showFinancialValuesInPush).toBe(false);
  });

  it("as preferências seguras só mudam o financeiro", () => {
    const s = preferenciasSeguras();
    expect({ ...s, showFinancialValuesInPush: true }).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });
});
