import { describe, expect, it } from "vitest";
import { diaRelativoBR, diasNaJanela, janelaDeDias } from "./janela-dias";

// 14/09/2026, 12:00 em São Paulo (15:00 UTC) — longe da virada do dia.
const AGORA = Date.parse("2026-09-14T15:00:00Z");

describe("janelaDeDias — o dia a mais que a reputação contava", () => {
  it("60 dias cobre 60 datas, não 61", () => {
    /**
     * Era `de = diaBR(-60)` com `ate = diaBR(0)`, inclusivo nas duas pontas:
     * os 60 dias anteriores MAIS hoje. E /api/ml/desempenho, que recebe o
     * MESMO parâmetro da mesma tela, já fazia -(dias-1) — os dois painéis
     * contavam bases diferentes pro mesmo filtro.
     */
    const j = janelaDeDias(60, AGORA);
    expect(j.de).toBe("2026-07-17");
    expect(j.ate).toBe("2026-09-14");
    expect(diasNaJanela(j.de, j.ate)).toBe(60);
  });

  it("1 dia é só hoje", () => {
    const j = janelaDeDias(1, AGORA);
    expect(j.de).toBe("2026-09-14");
    expect(j.ate).toBe("2026-09-14");
    expect(diasNaJanela(j.de, j.ate)).toBe(1);
  });

  it("o tamanho bate para qualquer N", () => {
    for (const n of [1, 2, 7, 15, 30, 60, 90, 180, 365]) {
      expect(diasNaJanela(janelaDeDias(n, AGORA).de, janelaDeDias(n, AGORA).ate), `n=${n}`).toBe(n);
    }
  });

  it("atravessa virada de mês e de ano", () => {
    const j = janelaDeDias(30, Date.parse("2027-01-10T15:00:00Z"));
    expect(j.de).toBe("2026-12-12");
    expect(diasNaJanela(j.de, j.ate)).toBe(30);
  });

  it("entrada torta vira 1 dia, nunca zero nem negativo", () => {
    expect(janelaDeDias(0, AGORA).dias).toBe(1);
    expect(janelaDeDias(-5, AGORA).dias).toBe(1);
    expect(janelaDeDias(Number.NaN, AGORA).dias).toBe(1);
    expect(janelaDeDias(7.9, AGORA).dias).toBe(7);
  });
});

describe("diaRelativoBR — o fuso de São Paulo", () => {
  it("00:30 UTC ainda é o dia anterior no Brasil", () => {
    // 15/09 00:30 UTC = 14/09 21:30 em São Paulo.
    expect(diaRelativoBR(0, Date.parse("2026-09-15T00:30:00Z"))).toBe("2026-09-14");
  });

  it("03:30 UTC já virou o dia no Brasil", () => {
    expect(diaRelativoBR(0, Date.parse("2026-09-15T03:30:00Z"))).toBe("2026-09-15");
  });
});

describe("diasNaJanela", () => {
  it("mesma data conta 1", () => {
    expect(diasNaJanela("2026-09-14", "2026-09-14")).toBe(1);
  });

  it("período invertido conta 0", () => {
    expect(diasNaJanela("2026-09-14", "2026-09-01")).toBe(0);
  });

  it("data inválida conta 0", () => {
    expect(diasNaJanela("", "2026-09-14")).toBe(0);
    expect(diasNaJanela("ontem", "hoje")).toBe(0);
  });

  it("mês inteiro de setembro conta 30", () => {
    expect(diasNaJanela("2026-09-01", "2026-09-30")).toBe(30);
  });
});
