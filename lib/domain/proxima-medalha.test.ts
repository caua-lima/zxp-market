import { describe, expect, it } from "vitest";
import { metricasDeQualidade } from "./proxima-medalha";


/**
 * Numeros reais da conta em 01/09/2026: 937 vendas concluidas em 60 dias,
 * reclamacoes 0% (0 casos), canceladas 0% (0), envios com atraso 0,22% (2).
 */
describe("metricasDeQualidade", () => {
  const m = {
    claims: { rate: 0, value: 0 },
    cancellations: { rate: 0, value: 0 },
    delayed_handling_time: { rate: 0.0022, value: 2 },
  };

  it("traduz a taxa em CASOS que ainda cabem — o que da pra agir", () => {
    /**
     * "0,22% de envios com atraso" nao diz se e perto do limite. "2 de 937, e
     * cabem mais 54" diz. 6% de 937 = 56; menos os 2 ja usados = 54.
     */
    const envios = metricasDeQualidade(m, 937).find((x) => x.id === "envios")!;
    expect(envios.casos).toBe(2);
    expect(envios.folgaEmCasos).toBe(54);
    expect(envios.ok).toBe(true);
  });

  it("reclamacoes zeradas tem a folga inteira", () => {
    // 1% de 937 = 9 (piso), nenhum usado.
    const r = metricasDeQualidade(m, 937).find((x) => x.id === "reclamacoes")!;
    expect(r.folgaEmCasos).toBe(9);
  });

  it("cancelamentos usam limite proprio, mais apertado", () => {
    // 0,5% de 937 = 4.
    const c = metricasDeQualidade(m, 937).find((x) => x.id === "cancelamentos")!;
    expect(c.limite).toBe(0.005);
    expect(c.folgaEmCasos).toBe(4);
  });

  it("acima do limite marca como NAO ok", () => {
    const acima = metricasDeQualidade(
      { ...m, claims: { rate: 0.02, value: 19 } }, 937,
    ).find((x) => x.id === "reclamacoes")!;
    expect(acima.ok).toBe(false);
  });

  it("estourado nao tem folga NEGATIVA, tem zero", () => {
    const est = metricasDeQualidade(
      { ...m, claims: { rate: 0.05, value: 47 } }, 937,
    ).find((x) => x.id === "reclamacoes")!;
    expect(est.folgaEmCasos).toBe(0);
  });

  it("sem dado nao vira zero — vira indisponivel", () => {
    const sem = metricasDeQualidade({ claims: null }, 937).find((x) => x.id === "reclamacoes")!;
    expect(sem.taxa).toBeNull();
    expect(sem.ok).toBeNull();
    expect(sem.folgaEmCasos).toBeNull();
  });

  it("sem base de vendas nao calcula folga", () => {
    expect(metricasDeQualidade(m, 0).find((x) => x.id === "envios")!.folgaEmCasos).toBeNull();
  });

  it("metrics nulo devolve as tres, todas indisponiveis", () => {
    const r = metricasDeQualidade(null, 937);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.ok === null)).toBe(true);
  });
});
