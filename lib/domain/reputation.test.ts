import { describe, expect, it } from "vitest";
import { METRIC_LABELS, METRIC_LIMITES, formatTaxaDecimal, getPowerSellerLabel, getProximoNivelLabel, getReputationLevelMeta, situacaoDaMetrica } from "./reputation";

describe("getReputationLevelMeta", () => {
  it("nível conhecido", () => {
    expect(getReputationLevelMeta("5_green").label).toBe("Verde — melhor nível");
  });
  it("sem nível ainda (conta nova)", () => {
    expect(getReputationLevelMeta(null).label).toBe("Sem nível calculado ainda");
  });
  it("nível desconhecido cai pro próprio texto cru, não trava", () => {
    expect(getReputationLevelMeta("novo_nivel_futuro").label).toBe("novo_nivel_futuro");
  });
});

describe("getPowerSellerLabel", () => {
  it("sem selo", () => {
    expect(getPowerSellerLabel(null)).toBe("Ainda sem selo de Mercado Líder");
  });
  it("platinum", () => {
    expect(getPowerSellerLabel("platinum")).toBe("Mercado Líder Platinum");
  });
});

describe("getProximoNivelLabel", () => {
  it("sem selo → próximo é o Mercado Líder básico", () => {
    expect(getProximoNivelLabel(null)).toBe("Mercado Líder");
  });
  it("silver → próximo é Gold", () => {
    expect(getProximoNivelLabel("silver")).toBe("Mercado Líder Gold");
  });
  it("platinum já é o topo → null", () => {
    expect(getProximoNivelLabel("platinum")).toBeNull();
  });
});

describe("formatTaxaDecimal", () => {
  it("converte decimal pra percentual", () => {
    expect(formatTaxaDecimal(0.023)).toBe("2.3%");
  });
  it("undefined/null vira null, não '0%' inventado", () => {
    expect(formatTaxaDecimal(undefined)).toBeNull();
    expect(formatTaxaDecimal(null)).toBeNull();
  });
});

describe("situacaoDaMetrica — o teto e o que da sentido a taxa", () => {
  it("zero e ok em todas", () => {
    expect(situacaoDaMetrica("claims", 0)).toBe("ok");
    expect(situacaoDaMetrica("cancellations", 0)).toBe("ok");
    expect(situacaoDaMetrica("delayed_handling_time", 0)).toBe("ok");
  });

  it("0,28% de atraso e ok — o caso real da conta", () => {
    // Teto de 10%, MercadoLider 6%.
    expect(situacaoDaMetrica("delayed_handling_time", 0.0028)).toBe("ok");
  });

  it("entre o limite de MercadoLider e o permitido vira ATENCAO", () => {
    // Sem esse degrau a tela diria "ok" ate a cor cair — tarde pra agir.
    expect(situacaoDaMetrica("claims", 0.015)).toBe("atencao");        // 1,5%: >1 e <2
    expect(situacaoDaMetrica("cancellations", 0.01)).toBe("atencao");  // 1%: >0,5 e <1,5
    expect(situacaoDaMetrica("delayed_handling_time", 0.08)).toBe("atencao");
  });

  it("acima do permitido e estourado", () => {
    expect(situacaoDaMetrica("claims", 0.03)).toBe("estourado");
    expect(situacaoDaMetrica("cancellations", 0.02)).toBe("estourado");
    expect(situacaoDaMetrica("delayed_handling_time", 0.11)).toBe("estourado");
  });

  it("exatamente no limite de MercadoLider ainda e ok", () => {
    expect(situacaoDaMetrica("claims", 0.01)).toBe("ok");
  });

  it("exatamente no permitido ainda nao estourou", () => {
    expect(situacaoDaMetrica("claims", 0.02)).toBe("atencao");
  });

  it("sem taxa e indisponivel, nunca 'ok'", () => {
    // Falta de dado nao pode virar tranquilidade.
    expect(situacaoDaMetrica("claims", null)).toBe("indisponivel");
    expect(situacaoDaMetrica("claims", undefined)).toBe("indisponivel");
    expect(situacaoDaMetrica("claims", NaN)).toBe("indisponivel");
  });

  it("o limite de MercadoLider e sempre mais apertado que o permitido", () => {
    for (const [, l] of Object.entries(METRIC_LIMITES)) {
      expect(l.mercadoLider).toBeLessThan(l.permitido);
    }
  });

  it("ha um limite pra cada metrica rotulada", () => {
    for (const k of Object.keys(METRIC_LABELS)) {
      expect(METRIC_LIMITES[k as keyof typeof METRIC_LIMITES]).toBeDefined();
    }
  });
});
