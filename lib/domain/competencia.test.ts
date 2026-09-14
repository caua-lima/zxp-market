import { describe, expect, it } from "vitest";
import { custoMensalNoPeriodo, diasDoMes, mesesCompletosNoPeriodo } from "./competencia";

describe("diasDoMes", () => {
  it("sabe o tamanho de cada mês, inclusive fevereiro bissexto", () => {
    expect(diasDoMes(2026, 9)).toBe(30);
    expect(diasDoMes(2026, 1)).toBe(31);
    expect(diasDoMes(2026, 2)).toBe(28);
    expect(diasDoMes(2028, 2)).toBe(29);
  });
});

describe("mesesCompletosNoPeriodo — o bug do intervalo de dois meses", () => {
  it("dois meses inteiros contam DOIS — era zero", () => {
    /**
     * `isFullMonth` exigia fy===ty && fm===tm (o mesmo mês), então 01/07 a
     * 31/08 era "não é mês inteiro" e o custo mensal sumia. Qualquer DRE de
     * mais de um mês perdia pró-labore, contador e aluguel.
     */
    expect(mesesCompletosNoPeriodo("2026-07-01", "2026-08-31")).toBe(2);
  });

  it("um mês inteiro continua contando um", () => {
    expect(mesesCompletosNoPeriodo("2026-09-01", "2026-09-30")).toBe(1);
    expect(mesesCompletosNoPeriodo("2026-02-01", "2026-02-28")).toBe(1);
  });

  it("três meses contam três", () => {
    expect(mesesCompletosNoPeriodo("2026-06-01", "2026-08-31")).toBe(3);
  });

  it("vira o ano", () => {
    expect(mesesCompletosNoPeriodo("2025-12-01", "2026-01-31")).toBe(2);
    expect(mesesCompletosNoPeriodo("2025-11-01", "2026-02-28")).toBe(4);
  });

  it("fevereiro bissexto só fecha no dia 29", () => {
    expect(mesesCompletosNoPeriodo("2028-02-01", "2028-02-28")).toBe(0);
    expect(mesesCompletosNoPeriodo("2028-02-01", "2028-02-29")).toBe(1);
  });
});

describe("mesesCompletosNoPeriodo — mês pela metade não conta", () => {
  it("mês em andamento conta zero", () => {
    /**
     * Mantido de propósito: o bloco "Vendas do Dia" pede as métricas de UM
     * dia, e ratear faria 1/30 do aluguel entrar no lucro de hoje.
     */
    expect(mesesCompletosNoPeriodo("2026-09-01", "2026-09-15")).toBe(0);
  });

  it("um dia só conta zero", () => {
    expect(mesesCompletosNoPeriodo("2026-09-10", "2026-09-10")).toBe(0);
  });

  it("período que começa no meio só conta os meses fechados depois", () => {
    // Julho começou no dia 15 — só agosto está inteiro dentro.
    expect(mesesCompletosNoPeriodo("2026-07-15", "2026-08-31")).toBe(1);
  });

  it("período que termina no meio só conta os meses fechados antes", () => {
    expect(mesesCompletosNoPeriodo("2026-07-01", "2026-08-20")).toBe(1);
  });

  it("começa e termina no meio, com um mês inteiro no meio", () => {
    expect(mesesCompletosNoPeriodo("2026-07-10", "2026-09-05")).toBe(1);
  });
});

describe("mesesCompletosNoPeriodo — entrada torta", () => {
  it("período invertido conta zero, não negativo", () => {
    expect(mesesCompletosNoPeriodo("2026-09-30", "2026-09-01")).toBe(0);
    expect(mesesCompletosNoPeriodo("2026-09-01", "2026-07-01")).toBe(0);
  });

  it("data inválida conta zero", () => {
    expect(mesesCompletosNoPeriodo("", "2026-09-30")).toBe(0);
    expect(mesesCompletosNoPeriodo("2026-13-01", "2026-14-01")).toBe(0);
    expect(mesesCompletosNoPeriodo("ontem", "hoje")).toBe(0);
  });
});

describe("custoMensalNoPeriodo", () => {
  it("multiplica pelo número de meses fechados", () => {
    expect(custoMensalNoPeriodo(250, "2026-07-01", "2026-08-31")).toBe(500);
    expect(custoMensalNoPeriodo(250, "2026-09-01", "2026-09-30")).toBe(250);
    expect(custoMensalNoPeriodo(250, "2026-09-01", "2026-09-15")).toBe(0);
  });

  it("valor inválido ou não positivo vira zero, não NaN", () => {
    // Number("12,50") é NaN, e um NaN somado contamina o total inteiro.
    expect(custoMensalNoPeriodo(Number.NaN, "2026-09-01", "2026-09-30")).toBe(0);
    expect(custoMensalNoPeriodo(0, "2026-09-01", "2026-09-30")).toBe(0);
    expect(custoMensalNoPeriodo(-250, "2026-09-01", "2026-09-30")).toBe(0);
  });
});
