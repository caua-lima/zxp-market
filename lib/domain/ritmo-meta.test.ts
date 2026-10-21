import { describe, expect, it } from "vitest";
import { calcularRitmoDaMeta, preenchimento } from "./ritmo-meta";

describe("ritmo da meta", () => {
  it("o exemplo: R$ 294.804 no dia em que o ideal era R$ 238.609 → 124%, à frente", () => {
    // Meta de 410.937,62 num mês de 31 dias, dia 18: 410.937,62 / 31 × 18 ≈ 238.609
    const r = calcularRitmoDaMeta({ faturamento: 294804, meta: 410937.62, diaAtual: 18, diasNoMes: 31 })!;
    expect(Math.round(r.idealHoje)).toBe(238609);
    expect(Math.round(r.pctIdeal)).toBe(124);
    expect(r.noRitmo).toBe(true);
    expect(Math.round(r.diferenca)).toBe(56195);
  });

  it("a marquinha do ideal na barra do mês e o % da meta", () => {
    const r = calcularRitmoDaMeta({ faturamento: 50000, meta: 100000, diaAtual: 15, diasNoMes: 30 })!;
    expect(r.marcoIdealPct).toBe(50);
    expect(r.pctMeta).toBe(50);
    expect(r.pctIdeal).toBe(100);
    expect(r.noRitmo).toBe(true);
  });

  it("atrás do ritmo: diferença negativa e quanto precisa por dia até o fim", () => {
    const r = calcularRitmoDaMeta({ faturamento: 30000, meta: 100000, diaAtual: 15, diasNoMes: 30 })!;
    expect(r.noRitmo).toBe(false);
    expect(r.diferenca).toBe(-20000);
    expect(r.faltaMeta).toBe(70000);
    expect(r.porDiaParaBater).toBe(70000 / 16); // do dia 15 (incluído) ao 30
  });

  it("meta batida: nada falta, e a barra não passa de 100", () => {
    const r = calcularRitmoDaMeta({ faturamento: 120000, meta: 100000, diaAtual: 25, diasNoMes: 30 })!;
    expect(r.faltaMeta).toBe(0);
    expect(r.porDiaParaBater).toBe(0);
    expect(r.pctMeta).toBe(120);
    expect(preenchimento(r.pctMeta)).toBe(100);
  });

  it("dia fora do mês é travado", () => {
    expect(calcularRitmoDaMeta({ faturamento: 0, meta: 300, diaAtual: 40, diasNoMes: 30 })!.idealHoje).toBe(300);
    const zero = calcularRitmoDaMeta({ faturamento: 0, meta: 300, diaAtual: -2, diasNoMes: 30 })!;
    expect(zero.idealHoje).toBe(0);
    expect(zero.pctIdeal).toBe(0);
  });

  it("sem meta (ou mês sem dias): null — a tela não inventa barra", () => {
    expect(calcularRitmoDaMeta({ faturamento: 10, meta: 0, diaAtual: 5, diasNoMes: 30 })).toBeNull();
    expect(calcularRitmoDaMeta({ faturamento: 10, meta: 100, diaAtual: 5, diasNoMes: 0 })).toBeNull();
  });

  it("faturamento negativo ou inválido conta como zero", () => {
    expect(calcularRitmoDaMeta({ faturamento: NaN, meta: 100, diaAtual: 10, diasNoMes: 10 })!.pctMeta).toBe(0);
  });
});

describe("preenchimento", () => {
  it("fica entre 0 e 100", () => {
    expect(preenchimento(124)).toBe(100);
    expect(preenchimento(74.3)).toBe(74.3);
    expect(preenchimento(-1)).toBe(0);
    expect(preenchimento(NaN)).toBe(0);
  });
});
