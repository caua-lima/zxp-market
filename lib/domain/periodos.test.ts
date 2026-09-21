import { describe, it, expect } from "vitest";
import {
  hojeNaOperacao, msAteAVirada, somarDias, limitesDoMes, mesAnterior, presetsDePeriodo,
  dataBR, dataPorExtenso, diasDesdeInicioDoMes, diasCobrindoMesPassado, rotuloDesdeMesPassado,
} from "./periodos";

// 2026-09-30 23:30 em Brasília = 2026-10-01 02:30 UTC
const ANTES_DA_VIRADA = Date.UTC(2026, 9, 1, 2, 30);  // 30/09 23:30 BRT (UTC-3)
const DEPOIS_DA_VIRADA = Date.UTC(2026, 9, 1, 3, 30);                    // 01/10 00:30 BRT

describe("hojeNaOperacao — o dia em Brasília, não no relógio de quem olha", () => {
  it("23:30 de 30/09 em Brasília ainda é 30/09 (embora em UTC já seja 01/10)", () => {
    expect(hojeNaOperacao(ANTES_DA_VIRADA)).toBe("2026-09-30");
  });
  it("depois da meia-noite em Brasília é 01/10", () => {
    expect(hojeNaOperacao(DEPOIS_DA_VIRADA)).toBe("2026-10-01");
  });
});

describe("virada do dia (U13): os atalhos precisam mudar, e os do dia velho não podem sobrar", () => {
  it("abrir em 30/09 e usar depois da meia-noite: 'Hoje' e 'Ontem' andam um dia", () => {
    const antes = presetsDePeriodo(hojeNaOperacao(ANTES_DA_VIRADA));
    const depois = presetsDePeriodo(hojeNaOperacao(DEPOIS_DA_VIRADA));
    const p = (l: ReturnType<typeof presetsDePeriodo>, c: string) => l.find((x) => x.chave === c)!;
    expect(p(antes, "hoje")).toMatchObject({ de: "2026-09-30", ate: "2026-09-30" });
    expect(p(depois, "hoje")).toMatchObject({ de: "2026-10-01", ate: "2026-10-01" });
    expect(p(depois, "ontem")).toMatchObject({ de: "2026-09-30", ate: "2026-09-30" });
  });
  it("na virada do mês, 'Mês atual' e 'Mês passado' trocam", () => {
    const depois = presetsDePeriodo("2026-10-01");
    expect(depois.find((x) => x.chave === "mes")).toMatchObject({ de: "2026-10-01", ate: "2026-10-31" });
    expect(depois.find((x) => x.chave === "mespas")).toMatchObject({ de: "2026-09-01", ate: "2026-09-30" });
  });
  it("msAteAVirada: às 23:30 faltam ~30 min; nunca dispara antes da virada", () => {
    const ms = msAteAVirada(ANTES_DA_VIRADA);
    expect(ms).toBeGreaterThan(30 * 60 * 1000);
    expect(ms).toBeLessThan(31 * 60 * 1000 + 5000);
    // Ao meio-dia faltam ~12h.
    const meioDia = Date.UTC(2026, 8, 20, 15, 0, 0); // 12:00 BRT
    expect(Math.round(msAteAVirada(meioDia) / 3600000)).toBe(12);
  });
});

describe("aritmética de datas em UTC puro", () => {
  it("somarDias atravessa mês, ano e fevereiro bissexto", () => {
    expect(somarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(somarDias("2026-01-01", -1)).toBe("2025-12-31");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("limites do mês", () => {
    expect(limitesDoMes("2026-02-10")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(limitesDoMes("2028-02-10")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });
  it("mês anterior em janeiro é dezembro do ano passado", () => {
    expect(mesAnterior("2026-01-15")).toEqual({ de: "2025-12-01", ate: "2025-12-31" });
  });
  it("presets: últimos 7 dias inclui hoje", () => {
    const p = presetsDePeriodo("2026-09-20").find((x) => x.chave === "7d")!;
    expect(p).toMatchObject({ de: "2026-09-14", ate: "2026-09-20" });
  });
});

describe("datas por extenso (o que o leitor de tela precisa ouvir)", () => {
  it("dataBR e dataPorExtenso", () => {
    expect(dataBR("2026-09-05")).toBe("05/09/2026");
    expect(dataPorExtenso("2026-09-05")).toBe("5 de setembro de 2026");
  });
});

describe("Desempenho: 'Mês passado' não é o mês passado (U13)", () => {
  it("em 20/09 a janela pede 20 + 31 = 51 dias, e isso cobre agosto INTEIRO mais setembro até hoje", () => {
    expect(diasDesdeInicioDoMes("2026-09-20")).toBe(20);
    expect(diasCobrindoMesPassado("2026-09-20")).toBe(51);
    // 51 dias contando hoje: o primeiro é 01/08.
    expect(somarDias("2026-09-20", -(51 - 1))).toBe("2026-08-01");
  });
  it("o rótulo diz 'Desde', com a data, e o tooltip diz o que vem junto", () => {
    const r = rotuloDesdeMesPassado("2026-09-20");
    expect(r.curto).toBe("Desde 1º/ago");
    expect(r.longo).toContain("01/08");
    expect(r.longo).toContain("20/09/2026");
    expect(r.longo).toMatch(/mês atual até agora/);
  });
  it("em março o mês passado (fevereiro) tem 28 dias", () => {
    expect(diasCobrindoMesPassado("2026-03-10")).toBe(10 + 28);
  });
});
