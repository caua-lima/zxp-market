import { describe, it, expect } from "vitest";
import { faixaAtiva, faixaInvertida, resumoDaFaixa } from "./ads-faixas";

describe("faixaAtiva", () => {
  it("vazia ou só espaços não filtra", () => {
    expect(faixaAtiva({ min: "", max: "" })).toBe(false);
    expect(faixaAtiva({ min: "  ", max: "" })).toBe(false);
  });
  it("basta um lado", () => {
    expect(faixaAtiva({ min: "2", max: "" })).toBe(true);
    expect(faixaAtiva({ min: "", max: "0" })).toBe(true);
  });
  it("texto que não é número não conta", () => {
    expect(faixaAtiva({ min: "abc", max: "" })).toBe(false);
  });
});

describe("faixaInvertida — o filtro que zera a tabela sem avisar", () => {
  it("mínimo maior que o máximo", () => {
    expect(faixaInvertida({ min: "5", max: "2" })).toBe(true);
  });
  it("igual não é invertido", () => {
    expect(faixaInvertida({ min: "3", max: "3" })).toBe(false);
  });
  it("com um lado só nunca é invertido", () => {
    expect(faixaInvertida({ min: "5", max: "" })).toBe(false);
  });
  it("aceita vírgula decimal", () => {
    expect(faixaInvertida({ min: "2,5", max: "2,4" })).toBe(true);
  });
});

describe("resumoDaFaixa", () => {
  it("as duas pontas", () => {
    expect(resumoDaFaixa("ROAS", { min: "2", max: "5" }, { depois: "x" })).toBe("ROAS de 2x a 5x");
  });
  it("só o mínimo, com a moeda antes", () => {
    expect(resumoDaFaixa("Investido", { min: "100", max: "" }, { antes: "R$ " })).toBe("Investido a partir de R$ 100");
  });
  it("só o máximo", () => {
    expect(resumoDaFaixa("ACOS", { min: "", max: "15" }, { depois: "%" })).toBe("ACOS até 15%");
  });
  it("inativa devolve vazio", () => {
    expect(resumoDaFaixa("ROAS", { min: "", max: "" }, { depois: "x" })).toBe("");
  });
});
