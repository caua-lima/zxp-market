import { describe, expect, it } from "vitest";
import { calcularMetaDiaria, idealAteHoje, type EntradaMetaDiaria } from "./meta-diaria";

function entrada(over: Partial<EntradaMetaDiaria> = {}): EntradaMetaDiaria {
  return {
    metaAtiva: 22000,
    faturamentoMes: 19125.91,
    faturamentoHoje: 1218.86,
    diasRestantes: 8,
    diasNoMes: 31,
    ...over,
  };
}

describe("calcularMetaDiaria — persegue a meta VIGENTE", () => {
  it("o caso real: Meta 3 em 22k não anuncia meta batida", () => {
    // Bug corrigido: com meta1 (já batida) o alvo dava 0 e a tela mostrava
    // "meta do mês batida" com 100%, enquanto a Meta 3 estava em 87%.
    const { diaria } = calcularMetaDiaria(entrada());
    const ateOntem = 19125.91 - 1218.86;
    expect(diaria).toBeCloseTo((22000 - ateOntem) / 8, 2);
    expect(diaria).toBeGreaterThan(0);
  });

  it("meta MENOR já batida daria zero — é a diferença que o bug escondia", () => {
    const comMeta1 = calcularMetaDiaria(entrada({ metaAtiva: 15000 }));
    const comMeta3 = calcularMetaDiaria(entrada({ metaAtiva: 22000 }));
    expect(comMeta1.diaria).toBe(0);
    expect(comMeta3.diaria).toBeGreaterThan(0);
  });

  it("meta do mês de fato batida devolve 0, não negativo", () => {
    const { diaria } = calcularMetaDiaria(entrada({ metaAtiva: 10000, faturamentoMes: 19000 }));
    expect(diaria).toBe(0);
  });
});

describe("calcularMetaDiaria — usa o acumulado até ONTEM", () => {
  it("venda de hoje não reduz o alvo de hoje", () => {
    // Se usasse o acumulado com hoje, o alvo cairia a cada venda e o
    // ponteiro nunca sairia do lugar.
    const semVenda = calcularMetaDiaria(entrada({ faturamentoMes: 17907.05, faturamentoHoje: 0 }));
    const comVenda = calcularMetaDiaria(entrada({ faturamentoMes: 19125.91, faturamentoHoje: 1218.86 }));
    expect(comVenda.diaria).toBeCloseTo(semVenda.diaria!, 2);
  });

  it("faturamento de hoje maior que o do mês não vira acumulado negativo", () => {
    const { diaria } = calcularMetaDiaria(entrada({ faturamentoMes: 100, faturamentoHoje: 500 }));
    expect(diaria).toBeCloseTo(22000 / 8, 2);
  });
});

describe("calcularMetaDiaria — meta plana e períodos fora do mês", () => {
  it("a plana é a meta ÷ dias do mês", () => {
    expect(calcularMetaDiaria(entrada()).plana).toBeCloseTo(22000 / 31, 4);
  });

  it("a plana também segue a meta ativa, não a primeira", () => {
    expect(calcularMetaDiaria(entrada({ metaAtiva: 22000 })).plana).toBeCloseTo(22000 / 31, 4);
    expect(calcularMetaDiaria(entrada({ metaAtiva: 15000 })).plana).toBeCloseTo(15000 / 31, 4);
  });

  it("período que não é o mês atual cai na plana", () => {
    const r = calcularMetaDiaria(entrada({ diasRestantes: null }));
    expect(r.diaria).toBeCloseTo(r.plana!, 4);
  });

  it("último dia do mês concentra tudo que falta", () => {
    const r = calcularMetaDiaria(entrada({ diasRestantes: 1, faturamentoMes: 20000, faturamentoHoje: 0 }));
    expect(r.diaria).toBeCloseTo(2000, 2);
  });
});

describe("calcularMetaDiaria — sem meta", () => {
  it("meta zero ou negativa não inventa alvo", () => {
    expect(calcularMetaDiaria(entrada({ metaAtiva: 0 })).diaria).toBeNull();
    expect(calcularMetaDiaria(entrada({ metaAtiva: -5 })).diaria).toBeNull();
  });

  it("mês sem dias não divide por zero", () => {
    expect(calcularMetaDiaria(entrada({ diasNoMes: 0 })).diaria).toBeNull();
  });
});

describe("idealAteHoje — o ritmo esperado até agora", () => {
  it("o caso real do painel: 22k em 31 dias, dia 24", () => {
    expect(idealAteHoje(22000, 24, 31)).toBeCloseTo(17032.26, 2);
  });

  it("segue a meta ativa: Meta 3 dá um ideal maior que a Meta 1", () => {
    expect(idealAteHoje(22000, 24, 31)).toBeGreaterThan(idealAteHoje(15000, 24, 31));
  });

  it("no último dia o ideal é a meta inteira", () => {
    expect(idealAteHoje(22000, 31, 31)).toBeCloseTo(22000, 2);
  });

  it("dia além do mês não passa da meta", () => {
    expect(idealAteHoje(22000, 45, 31)).toBeCloseTo(22000, 2);
  });

  it("sem meta é zero, sem divisão por zero", () => {
    expect(idealAteHoje(0, 24, 31)).toBe(0);
    expect(idealAteHoje(22000, 24, 0)).toBe(0);
  });
});
