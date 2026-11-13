import { describe, expect, it } from "vitest";
import { custoDoVendedor } from "./frete-vendedor";

describe("custoDoVendedor — a parte do frete que fica com o vendedor", () => {
  it("comprador paga uma parte: o vendedor paga o resto (Abacaxi de 12/11: 12,94 − 5,99)", () => {
    expect(custoDoVendedor(12.94, 0, 5.99)).toBe(6.95);
  });
  it("frete grátis pro comprador: o vendedor paga a tarifa inteira", () => {
    expect(custoDoVendedor(12.94, 10, 0)).toBe(12.94);
  });
  it("sem list_cost, usa o base_cost", () => {
    expect(custoDoVendedor(0, 9.5, 2)).toBe(7.5);
  });
  it("comprador pagou tudo: zero de verdade, nunca negativo", () => {
    expect(custoDoVendedor(12.94, 0, 12.94)).toBe(0);
    expect(custoDoVendedor(5, 0, 8)).toBe(0);
  });
});
