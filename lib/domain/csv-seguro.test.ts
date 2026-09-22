import { describe, expect, it } from "vitest";
import { celulaCsvSegura, linhaCsvSegura } from "./csv-seguro";

describe("celulaCsvSegura — injeção de fórmula em CSV (S30)", () => {
  it("neutraliza texto que começa com =, +, @ ou retorno de carro", () => {
    expect(celulaCsvSegura("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(celulaCsvSegura("+1+1")).toBe("'+1+1");
    expect(celulaCsvSegura("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(celulaCsvSegura("\r\n=malicioso")).toBe("'\r\n=malicioso");
  });

  it("um nome de produto que por acaso começa com hífen (texto, não número) também é neutralizado", () => {
    expect(celulaCsvSegura("-1+1+cmd")).toBe("'-1+1+cmd");
  });

  it("NÃO mexe em número de verdade, positivo ou negativo, string ou number", () => {
    expect(celulaCsvSegura(-42.5)).toBe("-42.5");
    expect(celulaCsvSegura("-42,50")).toBe("-42,50");
    expect(celulaCsvSegura("-42.50")).toBe("-42.50");
    expect(celulaCsvSegura("42")).toBe("42");
    expect(celulaCsvSegura("15,5%")).toBe("15,5%");
  });

  it("texto comum, vazio ou já entre aspas por acaso não é tocado", () => {
    expect(celulaCsvSegura("Camiseta azul P")).toBe("Camiseta azul P");
    expect(celulaCsvSegura("")).toBe("");
    expect(celulaCsvSegura("não disponível")).toBe("não disponível");
  });
});

describe("linhaCsvSegura", () => {
  it("escapa aspas internas E neutraliza fórmula na mesma célula", () => {
    const linha = linhaCsvSegura(['=A1&"x"', "Produto \"especial\"", -10]);
    expect(linha).toBe('"\'=A1&""x""";"Produto ""especial""";"-10"');
  });
});
