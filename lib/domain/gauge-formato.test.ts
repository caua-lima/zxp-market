import { describe, expect, it } from "vitest";
import { abreviarValor, formatarPercentualDaMeta, rawGoalPercent } from "./gauge";

describe("formatarPercentualDaMeta — 100% só quando chegou", () => {
  it("o caso da tela: R$ 23.429,31 de R$ 23.500 é 99,6%, não 100%", () => {
    expect(formatarPercentualDaMeta(rawGoalPercent(23429.31, 23500))).toBe("99,6%");
  });

  it("trunca, nunca arredonda pra cima", () => {
    expect(formatarPercentualDaMeta(99.99)).toBe("99,9%");
    expect(formatarPercentualDaMeta(59.96)).toBe("59,9%");
  });

  it("inteiro sai sem ',0'; acima de 100 continua mostrando", () => {
    expect(formatarPercentualDaMeta(100)).toBe("100%");
    expect(formatarPercentualDaMeta(50)).toBe("50%");
    expect(formatarPercentualDaMeta(118.34)).toBe("118,3%");
  });

  it("sem dado ou negativo é 0%", () => {
    expect(formatarPercentualDaMeta(Number.NaN)).toBe("0%");
    expect(formatarPercentualDaMeta(-3)).toBe("0%");
  });
});

describe("abreviarValor — a meta como ela é", () => {
  it("R$ 23.500 é 23,5k, não 24k", () => {
    expect(abreviarValor(23500)).toBe("R$ 23,5k");
  });

  it("redondo fica redondo; até duas casas do milhar, truncadas", () => {
    expect(abreviarValor(24000)).toBe("R$ 24k");
    expect(abreviarValor(23456)).toBe("R$ 23,45k");
    expect(abreviarValor(1_250_000)).toBe("R$ 1,25M");
  });

  it("abaixo de mil mostra o valor inteiro", () => {
    expect(abreviarValor(0)).toBe("R$ 0,00");
    expect(abreviarValor(850.5)).toBe("R$ 850,50");
  });
});
