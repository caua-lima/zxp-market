import { describe, expect, it } from "vitest";
import { calcularEntradaMassa, custoMedioAposEntrada, type ProdutoParaEntrada } from "./entrada-massa";

const prod = (over: Partial<ProdutoParaEntrada> = {}): ProdutoParaEntrada => ({
  id: "p1", nome: "Erva Tradicional", custoMedio: 10, full: 20, casa: 0, proprio: 0, ehFull: true, ...over,
});

describe("custoMedioAposEntrada — a média ponderada", () => {
  it("20 un a R$ 10 + 20 un a R$ 20 = R$ 15", () => {
    expect(custoMedioAposEntrada(20, 10, 20, 20)).toBeCloseTo(15, 4);
  });

  it("sem estoque anterior, o custo da compra VIRA o custo médio", () => {
    expect(custoMedioAposEntrada(0, 0, 50, 8.5)).toBeCloseTo(8.5, 4);
  });

  it("comprar mais barato derruba o custo médio", () => {
    // 100 a 10 + 100 a 6 = 8
    expect(custoMedioAposEntrada(100, 10, 100, 6)).toBeCloseTo(8, 4);
  });

  it("quantidade zero não mexe no custo médio", () => {
    expect(custoMedioAposEntrada(30, 12, 0, 99)).toBe(12);
  });

  it("compra pequena mal move o custo médio — o peso é do estoque", () => {
    // 1000 a 10 + 1 a 100 → 10,09, não 55. Média ponderada, não aritmética.
    expect(custoMedioAposEntrada(1000, 10, 1, 100)).toBeCloseTo(10.0899, 3);
  });
});

describe("calcularEntradaMassa", () => {
  it("calcula o total da nota, que é o que dá pra conferir antes de gravar", () => {
    const r = calcularEntradaMassa(
      [prod({ id: "a", nome: "A" }), prod({ id: "b", nome: "B" })],
      [
        { produtoId: "a", quantidade: 10, custoUnitario: 5 },
        { produtoId: "b", quantidade: 4, custoUnitario: 2.5 },
      ],
    );
    expect(r.totalGeral).toBeCloseTo(60, 2);
    expect(r.unidadesTotais).toBe(14);
    expect(r.erros).toEqual([]);
  });

  it("linha em branco é ignorada — a tela lista tudo e você preenche só alguns", () => {
    const r = calcularEntradaMassa([prod()], [
      { produtoId: "p1", quantidade: null, custoUnitario: null },
    ]);
    expect(r.linhas).toEqual([]);
    expect(r.erros).toEqual([]);
  });

  it("preenchida pela METADE é erro — isso é engano, não omissão", () => {
    const soQtd = calcularEntradaMassa([prod()], [{ produtoId: "p1", quantidade: 5, custoUnitario: null }]);
    expect(soQtd.erros[0]).toMatch(/custo unitário/);

    const soCusto = calcularEntradaMassa([prod()], [{ produtoId: "p1", quantidade: null, custoUnitario: 9 }]);
    expect(soCusto.erros[0]).toMatch(/quantidade/);
  });

  it("o mesmo produto em duas linhas é barrado", () => {
    /**
     * Cada linha blenda contra o estoque de ANTES. Duas linhas do mesmo
     * produto ignorariam uma à outra e o custo médio final não corresponderia
     * a nada — barrar é mais honesto que gravar um número inventado.
     */
    const r = calcularEntradaMassa([prod()], [
      { produtoId: "p1", quantidade: 5, custoUnitario: 10 },
      { produtoId: "p1", quantidade: 5, custoUnitario: 20 },
    ]);
    expect(r.erros.some((e) => /duas linhas|2 linhas/.test(e))).toBe(true);
  });

  it("quantidade negativa é recusada — entrada não dá baixa", () => {
    const r = calcularEntradaMassa([prod()], [{ produtoId: "p1", quantidade: -5, custoUnitario: 10 }]);
    expect(r.erros[0]).toMatch(/Ajuste/);
    expect(r.linhas).toEqual([]);
  });

  it("avisa quando a compra ENCARECE o custo médio", () => {
    const r = calcularEntradaMassa([prod({ custoMedio: 10, full: 20 })], [
      { produtoId: "p1", quantidade: 20, custoUnitario: 20 },
    ]);
    expect(r.linhas[0].custoMedioNovo).toBeCloseTo(15, 2);
    expect(r.linhas[0].encarece).toBe(true);
  });

  it("comprar mais barato NÃO marca encarecimento", () => {
    const r = calcularEntradaMassa([prod({ custoMedio: 10, full: 100 })], [
      { produtoId: "p1", quantidade: 100, custoUnitario: 6 },
    ]);
    expect(r.linhas[0].encarece).toBe(false);
  });

  it("produto novo (sem custo) não é 'encarecimento'", () => {
    // Sair de 0 pra 8 não é a compra piorando nada — é o primeiro custo.
    const r = calcularEntradaMassa([prod({ custoMedio: 0, full: 0, casa: 0 })], [
      { produtoId: "p1", quantidade: 10, custoUnitario: 8 },
    ]);
    expect(r.linhas[0].encarece).toBe(false);
    expect(r.linhas[0].custoMedioNovo).toBeCloseTo(8, 2);
  });

  it("o blend usa Full + o que está fora do Full", () => {
    const r = calcularEntradaMassa([prod({ custoMedio: 10, full: 30, casa: 20, ehFull: true })], [
      { produtoId: "p1", quantidade: 50, custoUnitario: 20 },
    ]);
    expect(r.linhas[0].estoqueAntes).toBe(50);
    expect(r.linhas[0].custoMedioNovo).toBeCloseTo(15, 2); // 50×10 + 50×20 / 100
  });

  it("produto inexistente vira erro nomeado, não some calado", () => {
    const r = calcularEntradaMassa([prod()], [{ produtoId: "fantasma", quantidade: 1, custoUnitario: 1 }]);
    expect(r.erros[0]).toMatch(/fantasma/);
  });

  it("lista vazia devolve vazio", () => {
    const r = calcularEntradaMassa([], []);
    expect(r).toEqual({ linhas: [], totalGeral: 0, unidadesTotais: 0, erros: [] });
  });
});
