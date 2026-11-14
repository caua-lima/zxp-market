import { describe, expect, it } from "vitest";
import { formatarBRL, paraCentavos, parcelar, somar } from "./dinheiro";

describe("paraCentavos", () => {
  it("os jeitos de digitar em pt-BR", () => {
    expect(paraCentavos("1.234,56")).toBe(123456);
    expect(paraCentavos("1234,56")).toBe(123456);
    expect(paraCentavos("1234.56")).toBe(123456);
    expect(paraCentavos("R$ 10")).toBe(1000);
    expect(paraCentavos("12,5")).toBe(1250);
    expect(paraCentavos("-12,50")).toBe(-1250);
    expect(paraCentavos("0")).toBe(0);
  });
  it("texto que não é valor vira null, nunca 0", () => {
    expect(paraCentavos("")).toBeNull();
    expect(paraCentavos("abc")).toBeNull();
    expect(paraCentavos("1,234")).toBeNull();
  });
});

describe("contas exatas", () => {
  it("0,10 + 0,20 = 0,30 em centavos", () => {
    expect(somar([10, 20])).toBe(30);
  });
  it("formata com milhar e sinal", () => {
    expect(formatarBRL(123456)).toBe("R$ 1.234,56");
    expect(formatarBRL(-1250)).toBe("-R$ 12,50");
    expect(formatarBRL(5)).toBe("R$ 0,05");
  });
  it("parcelas somam o total exato", () => {
    expect(parcelar(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(somar(parcelar(10000, 3))).toBe(10000);
  });
});
