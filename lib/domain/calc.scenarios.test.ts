import { describe, expect, it } from "vitest";
import { projetarMes, scenariosDeProjecao } from "./calc";

/**
 * `scenariosDeProjecao` — achado S18 da auditoria SaaS.
 */
describe("scenariosDeProjecao", () => {
  it("no ULTIMO dia do mes, sem nada mais a projetar, os tres cenarios sao o mesmo numero", () => {
    /**
     * Reproducao exata do achado: R$3.000 realizados no dia 30 de um mes de
     * 30 dias. `esperado === valorAcumulado` (nada mais a acontecer), e a
     * versao com bug ainda assim devolvia 2550/3450 — 15% de um mes que ja
     * fechou.
     */
    const r = scenariosDeProjecao(3000, 30, 30);
    expect(r.esperado).toBe(3000);
    expect(r.conservador).toBe(3000);
    expect(r.agressivo).toBe(3000);
  });

  it("no MEIO do mes, a variacao incide so sobre o que falta, nao sobre o total projetado", () => {
    // dia 10 de 30, R$1000 acumulados: projetado = 1000/10*30 = 3000, resto = 2000.
    const r = scenariosDeProjecao(1000, 10, 30, 0.15);
    const esperado = projetarMes(1000, 10, 30);
    expect(r.esperado).toBe(esperado);
    const resto = esperado - 1000;
    expect(r.conservador).toBeCloseTo(1000 + resto * 0.85, 6);
    expect(r.agressivo).toBeCloseTo(1000 + resto * 1.15, 6);
    // O realizado (R$1000) é piso comum aos três cenários — não varia.
    expect(r.conservador).toBeGreaterThan(1000);
  });

  it("no PRIMEIRO dia, quase tudo e projecao — a variacao ainda assim nao mexe no que ja foi realizado", () => {
    const r = scenariosDeProjecao(100, 1, 30, 0.15);
    expect(r.conservador).toBeGreaterThanOrEqual(100);
  });
});
