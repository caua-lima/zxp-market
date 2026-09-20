import { describe, expect, it } from "vitest";
import { personalizarPayload, tipoEfetivoParaDestinatario } from "./personalizacao-push";
import {
  TITULO_ALTO_VALOR,
  TITULO_VENDA_PADRAO,
  buildSaleContent,
  type SalePushPayload,
} from "./notifications";

const payloadDe = (type: SalePushPayload["type"], gross: number, extra: Partial<SalePushPayload> = {}): SalePushPayload => {
  const c = buildSaleContent({ type, grossAmount: gross, estimatedProfit: gross * 0.3, estimatedMargin: 30, metaMargem: null, productName: "Menta", itemCount: 1 });
  return { eventId: "e", type, title: c.title, body: c.body, tag: "t", deepLink: "/", grossAmount: gross.toFixed(2), financialState: "estimated", timestamp: "1", ...extra };
};

describe("tipoEfetivoParaDestinatario", () => {
  it("R$ 250 pra A e R$ 1.000 pra B: a mesma venda de R$ 300 é alto valor pra A e comum pra B", () => {
    const p = payloadDe("sale_high_value", 300);
    expect(tipoEfetivoParaDestinatario(p, { highValueThreshold: 250 })).toBe("sale_high_value");
    expect(tipoEfetivoParaDestinatario(p, { highValueThreshold: 1000 })).toBe("sale_paid");
  });

  it("o limite é inclusivo: exatamente o limiar já é alto valor", () => {
    expect(tipoEfetivoParaDestinatario(payloadDe("sale_paid", 250), { highValueThreshold: 250 })).toBe("sale_high_value");
    expect(tipoEfetivoParaDestinatario(payloadDe("sale_paid", 249.99), { highValueThreshold: 250 })).toBe("sale_paid");
  });

  it("limiar zero: toda venda com dado financeiro vira alto valor", () => {
    expect(tipoEfetivoParaDestinatario(payloadDe("sale_paid", 1), { highValueThreshold: 0 })).toBe("sale_high_value");
  });

  it("margem baixa, prejuízo e demais tipos passam intactos", () => {
    for (const t of ["sale_low_margin", "sale_negative_margin", "sale_cancelled", "return_completed", "task_assigned", "milestone"] as const) {
      expect(tipoEfetivoParaDestinatario(payloadDe(t, 5000), { highValueThreshold: 1 }), t).toBe(t);
    }
  });

  it("sem valor ou sem dado financeiro: mantém o tipo do evento", () => {
    expect(tipoEfetivoParaDestinatario({ type: "sale_paid", grossAmount: undefined, financialState: "estimated" }, { highValueThreshold: 1 })).toBe("sale_paid");
    expect(tipoEfetivoParaDestinatario({ type: "sale_paid", grossAmount: "500.00", financialState: "unavailable" }, { highValueThreshold: 1 })).toBe("sale_paid");
    expect(tipoEfetivoParaDestinatario({ type: "sale_paid", grossAmount: "abc", financialState: "estimated" }, { highValueThreshold: 1 })).toBe("sale_paid");
  });
});

describe("personalizarPayload", () => {
  it("alto valor → comum: troca o título e o type, mantém o resto", () => {
    const p = payloadDe("sale_high_value", 300);
    const r = personalizarPayload(p, "sale_paid");
    expect(r.title).toBe(TITULO_VENDA_PADRAO);
    expect(r.type).toBe("sale_paid");
    expect(r.body).toBe(p.body);
    expect(r.grossAmount).toBe(p.grossAmount);
  });

  it("comum → alto valor", () => {
    const r = personalizarPayload(payloadDe("sale_paid", 300), "sale_high_value");
    expect(r.title).toBe(TITULO_ALTO_VALOR);
    expect(r.type).toBe("sale_high_value");
  });

  it("mesmo tipo: devolve o próprio payload", () => {
    const p = payloadDe("sale_paid", 10);
    expect(personalizarPayload(p, "sale_paid")).toBe(p);
  });

  it("um título ESPECIAL (sem cadastro, frete) não é apagado por um limiar", () => {
    const p = { ...payloadDe("sale_paid", 300), title: "Venda de produto sem cadastro" };
    const r = personalizarPayload(p, "sale_high_value");
    expect(r.title).toBe("Venda de produto sem cadastro");
    expect(r.type).toBe("sale_high_value");
  });
});
