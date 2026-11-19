import { describe, expect, it } from "vitest";
import { avaliarConsolidacao, contarAnunciosPorCampanha, diaBR, periodoIncluiOntem } from "./ads-consolidacao";

// 19/11/2026 06:45 em Brasília = 09:45 UTC — o momento da conferência.
const AGORA = Date.parse("2026-11-19T09:45:00Z");

describe("avaliarConsolidacao — o dia de ontem já está na API pública?", () => {
  it("caso medido: campanha sem o dia 18, anúncio com R$ 132,01 → pendente", () => {
    const c = avaliarConsolidacao("2026-11-18", 0, 132.01);
    expect(c.pendente).toBe(true);
  });

  it("dia consolidado: as duas fontes batem → não pendente", () => {
    expect(avaliarConsolidacao("2026-11-12", 71.41, 71.41).pendente).toBe(false);
  });

  it("diferença pequena (anúncio que mudou de campanha) não é pendência", () => {
    // 95% do gasto já está nas campanhas: o resto é redistribuição, não dia faltando.
    expect(avaliarConsolidacao("2026-11-18", 125.5, 132.01).pendente).toBe(false);
  });

  it("ontem sem gasto nenhum não sustenta conclusão — não pendente", () => {
    expect(avaliarConsolidacao("2026-11-18", 0, 0.2).pendente).toBe(false);
  });
});

describe("periodoIncluiOntem", () => {
  it("ontem é calculado no fuso de Brasília", () => {
    expect(diaBR(AGORA, 1)).toBe("2026-11-18");
    // 01:30 UTC do dia 20 ainda é 22:30 do dia 19 em Brasília.
    expect(diaBR(Date.parse("2026-11-20T01:30:00Z"), 0)).toBe("2026-11-19");
  });

  it("últimos 7 dias (13–19) inclui ontem", () => {
    expect(periodoIncluiOntem("2026-11-13", "2026-11-19", AGORA)).toBe("2026-11-18");
  });

  it("hoje (19–19) não inclui ontem — nada a conferir", () => {
    expect(periodoIncluiOntem("2026-11-19", "2026-11-19", AGORA)).toBeNull();
  });

  it("período fechado (06–12) não inclui ontem", () => {
    expect(periodoIncluiOntem("2026-11-06", "2026-11-12", AGORA)).toBeNull();
  });
});

describe("contarAnunciosPorCampanha — o '3 anúncios patrocinados' do painel", () => {
  it("conta o anúncio que não gastou (MS, LC, TT: 3, não 2)", () => {
    const m = contarAnunciosPorCampanha([
      { campaignId: "7469663", status: "active" }, // Tradicional, gastou
      { campaignId: "7469663", status: "active" }, // Menta Stronger, gastou
      { campaignId: "7469663", status: "active" }, // 248 impressões, R$ 0
      { campaignId: "7261128", status: "active" },
    ]);
    expect(m.get("7469663")).toBe(3);
    expect(m.get("7261128")).toBe(1);
  });

  it("anúncio fora de campanha (idle) ou sem campanha não conta", () => {
    const m = contarAnunciosPorCampanha([
      { campaignId: "", status: "active" },
      { campaignId: "c1", status: "idle" },
      { campaignId: "c1", status: "PAUSED" },
    ]);
    expect(m.get("c1")).toBe(1);
    expect(m.has("")).toBe(false);
  });
});
