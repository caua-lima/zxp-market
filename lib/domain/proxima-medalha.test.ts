import { describe, expect, it } from "vitest";
import { metricasDeQualidade, progressoDaMedalha } from "./proxima-medalha";

const HOJE = "2026-09-01";

describe("progressoDaMedalha", () => {
  it("mede o que falta e o ritmo, com os numeros reais da conta", () => {
    // R$ 42.013 em 60 dias, alvo hipotetico de R$ 76.490.
    const p = progressoDaMedalha(42013, 76490, 60, HOJE);
    expect(p.falta).toBeCloseTo(34477, 0);
    expect(p.pct).toBeCloseTo(54.9, 1);
    expect(p.porDia).toBeCloseTo(700.2, 1);
    expect(p.diasNoRitmo).toBe(50);
  });

  it("projeta a data somando os dias do ritmo a hoje", () => {
    // 700,2/dia, faltam 34.477 → 50 dias → 21/10.
    expect(progressoDaMedalha(42013, 76490, 60, HOJE).chegaEm).toBe("2026-10-21");
  });

  it("alvo alcancado nao pede mais nada", () => {
    const p = progressoDaMedalha(80000, 76490, 60, HOJE);
    expect(p.alcancado).toBe(true);
    expect(p.falta).toBe(0);
    expect(p.diasNoRitmo).toBe(0);
  });

  it("sem ritmo NAO projeta data — null e diferente de 'chega hoje'", () => {
    // Dizer que chega hoje quando nao se vende nada e a pior forma de errar.
    const p = progressoDaMedalha(0, 76490, 60, HOJE);
    expect(p.porDia).toBe(0);
    expect(p.diasNoRitmo).toBeNull();
    expect(p.chegaEm).toBeNull();
  });

  it("sem alvo informado nao inventa percentual", () => {
    const p = progressoDaMedalha(42013, 0, 60, HOJE);
    expect(p.pct).toBe(0);
    expect(p.alcancado).toBe(false);
  });

  it("valores invalidos nao viram numero negativo", () => {
    const p = progressoDaMedalha(-5, -10, 0, HOJE);
    expect(p.atual).toBe(0);
    expect(p.alvo).toBe(0);
    expect(p.falta).toBe(0);
    expect(p.porDia).toBe(0);
  });

  it("a data projetada atravessa a virada do mes", () => {
    // 100/dia, faltam 1000 → 10 dias a partir de 25/12 → 04/01/2027.
    expect(progressoDaMedalha(3000, 4000, 30, "2026-12-25").chegaEm).toBe("2027-01-04");
  });
});

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
