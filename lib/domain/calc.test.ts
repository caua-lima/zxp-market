import { describe, expect, it } from "vitest";
import { parseBRNumber, fmtPct } from "./calc";

describe("parseBRNumber — o erro de mil vezes", () => {
  it("le o formato brasileiro com milhar E centavos", () => {
    /**
     * A aba Estoque tinha o proprio parser:
     *
     *   parseFloat(String(s).replace(",", "."))
     *
     * Uma troca so, da PRIMEIRA virgula. Com "1.234,56" isso vira "1.234.56" e
     * o parseFloat para no segundo ponto: 1,234. Mil vezes menos.
     *
     * E ele alimentava o custo do produto — que vira valor de estoque, valor em
     * risco e custo unitario do plano de reposicao. O resto do app usava esta
     * funcao e lia 1234,56. Duas telas, dois custos, pro mesmo produto.
     */
    expect(parseBRNumber("1.234,56")).toBe(1234.56);
    expect(parseBRNumber("12.345.678,90")).toBe(12345678.9);
  });

  it("virgula sozinha e decimal", () => {
    expect(parseBRNumber("1234,56")).toBe(1234.56);
    expect(parseBRNumber("0,5")).toBe(0.5);
  });

  it("ponto sozinho e decimal — e o formato que custoDe GRAVA", () => {
    // `custoDe` escreve com toFixed(2): o ponto ali e decimal de verdade.
    expect(parseBRNumber("1234.56")).toBe(1234.56);
    expect(parseBRNumber("12.50")).toBe(12.5);
  });

  it("numero inteiro passa direto", () => {
    expect(parseBRNumber("1234")).toBe(1234);
  });

  it("entrada vazia ou ilegivel vira zero, nao NaN", () => {
    // NaN somado contamina o total inteiro, e o total some da tela.
    expect(parseBRNumber("")).toBe(0);
    expect(parseBRNumber("abc")).toBe(0);
    expect(parseBRNumber(null)).toBe(0);
    expect(parseBRNumber(undefined)).toBe(0);
  });
});

describe("fmtPct — percentual em português", () => {
  it("usa vírgula decimal, como fmtBRL", () => {
    expect(fmtPct(37.8)).toBe("37,8%");
    expect(fmtPct(17.1)).toBe("17,1%");
  });

  it("negativo mantém o sinal", () => {
    expect(fmtPct(-0.1)).toBe("-0,1%");
  });

  it("zero não vira vazio", () => {
    expect(fmtPct(0)).toBe("0,0%");
  });

  it("milhar usa ponto, como a moeda", () => {
    expect(fmtPct(1234.5)).toBe("1.234,5%");
  });

  it("casas configuráveis", () => {
    expect(fmtPct(37.85, 2)).toBe("37,85%");
    expect(fmtPct(37.85, 0)).toBe("38%");
  });

  it("valor que não é número vira travessão, não NaN%", () => {
    expect(fmtPct(NaN)).toBe("—");
    expect(fmtPct(Infinity)).toBe("—");
  });
});
