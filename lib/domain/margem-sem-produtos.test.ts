import { describe, expect, it } from "vitest";
import { ehProdutoTirado, margemSemProdutos, termosPadraoDoMes } from "./margem-sem-produtos";

const periodo = {
  lucroComCustos: 1000,
  totalRetorno: 10000,
  anuncios: [
    { title: "Açaí Zero 1kg", retorno: 2000, lucro: -560 }, // −28%
    { title: "ACAI com guaraná 500g", retorno: 500, lucro: -140 },
    { title: "Limão Tahiti", retorno: 7500, lucro: 1700 },
  ],
};

describe("ehProdutoTirado", () => {
  it("acha o açaí com ou sem acento, maiúsculo ou não", () => {
    expect(ehProdutoTirado("Açaí Zero 1kg", ["açaí"])).toBe(true);
    expect(ehProdutoTirado("ACAI com guaraná", ["açaí"])).toBe(true);
    expect(ehProdutoTirado("Limão Tahiti", ["açaí"])).toBe(false);
    expect(ehProdutoTirado("qualquer", ["", "  "])).toBe(false);
  });
});

describe("margemSemProdutos", () => {
  it("tira o retorno e o lucro dos açaís e recalcula — os custos da empresa ficam inteiros", () => {
    const r = margemSemProdutos(periodo, ["açaí"])!;
    // (1000 − (−700)) ÷ (10000 − 2500) = 1700 ÷ 7500
    expect(r.margemSem).toBeCloseTo(22.67, 2);
    expect(r.lucroSem).toBe(1700);
    expect(r.retornoSem).toBe(7500);
    expect(r.tirados).toMatchObject({ anuncios: 2, retorno: 2500, lucro: -700 });
    expect(r.tirados.margem).toBeCloseTo(-28, 6);
  });

  it("nada a tirar (sem termo ou sem açaí no período): null, e a tela mostra a margem normal", () => {
    expect(margemSemProdutos(periodo, [])).toBeNull();
    expect(margemSemProdutos({ ...periodo, anuncios: [periodo.anuncios[2]] }, ["açaí"])).toBeNull();
  });

  it("só açaí no período: sem retorno sobrando, a margem 'sem' não existe", () => {
    expect(margemSemProdutos({ lucroComCustos: -700, totalRetorno: 2500, anuncios: periodo.anuncios.slice(0, 2) }, ["açaí"])!.margemSem).toBeNull();
  });
});

describe("termosPadraoDoMes", () => {
  it("novembro/2026 tira os açaís (o pedido); os outros meses, nada", () => {
    expect(termosPadraoDoMes("2026-11-01")).toEqual(["açaí"]);
    expect(termosPadraoDoMes("2026-12")).toEqual([]);
  });
});
