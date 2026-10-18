import { describe, expect, it } from "vitest";
import { calcularCompra, custoComDesconto, descontoValido } from "./preco-com-desconto";

describe("custo com desconto", () => {
  it("o exemplo: R$ 14,50 com 12% de desconto custa R$ 12,76 a unidade", () => {
    expect(custoComDesconto(14.5, 12)).toBe(12.76);
  });
  it("sem desconto (vazio, null, zero), o custo é o preço", () => {
    expect(custoComDesconto(14.5)).toBe(14.5);
    expect(custoComDesconto(14.5, null)).toBe(14.5);
    expect(custoComDesconto(14.5, 0)).toBe(14.5);
  });
  it("não deixa ruído de ponto flutuante", () => {
    expect(String(custoComDesconto(14.5, 12))).toBe("12.76");
    expect(custoComDesconto(10, 33.3333)).toBe(6.6667);
  });
  it("desconto fora de 0–99,99, preço negativo ou inválido: NaN", () => {
    for (const d of [-1, 100, 150, NaN]) expect(custoComDesconto(10, d)).toBeNaN();
    expect(custoComDesconto(-5, 10)).toBeNaN();
    expect(custoComDesconto(NaN, 10)).toBeNaN();
  });
  it("descontoValido", () => {
    expect(descontoValido(undefined)).toBe(true);
    expect(descontoValido(0)).toBe(true);
    expect(descontoValido(99.99)).toBe(true);
    expect(descontoValido(100)).toBe(false);
    expect(descontoValido(-0.1)).toBe(false);
  });
});

describe("calcularCompra", () => {
  it("o exemplo completo: 200 un a R$ 14,50 com 12%", () => {
    const r = calcularCompra({ precoOriginal: 14.5, descontoPct: 12, unidades: 200 });
    expect(r).toEqual({ ok: true, custoUnitario: 12.76, economiaPorUnidade: 1.74, total: 2552, totalSemDesconto: 2900 });
  });
  it("sem desconto, total = preço × unidades e economia zero", () => {
    const r = calcularCompra({ precoOriginal: 10, unidades: 3 });
    expect(r).toMatchObject({ ok: true, custoUnitario: 10, economiaPorUnidade: 0, total: 30, totalSemDesconto: 30 });
  });
  it("recusa preço zero, unidades zero e desconto de 100%", () => {
    expect(calcularCompra({ precoOriginal: 0, unidades: 5 })).toEqual({ ok: false, motivo: "Informe o preço original." });
    expect(calcularCompra({ precoOriginal: 5, unidades: 0 })).toEqual({ ok: false, motivo: "Informe a quantidade de unidades." });
    expect(calcularCompra({ precoOriginal: 5, descontoPct: 100, unidades: 5 })).toMatchObject({ ok: false });
  });
  it("fração de unidade não é recusada aqui (quem chama decide o que aceita)", () => {
    expect(calcularCompra({ precoOriginal: 10, descontoPct: 50, unidades: 2.5 })).toMatchObject({ ok: true, total: 12.5 });
  });
});
