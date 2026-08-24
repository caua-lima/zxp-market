import { describe, expect, it } from "vitest";
import { diffCustos, parseCusto, totalInformado, type LinhaCusto } from "./custo-coleta";

const LINHAS: LinhaCusto[] = [
  { remessa: "73306199", custo: 97.38 },
  { remessa: "73690129", custo: null },
  { remessa: "74265340", custo: null },
];

describe("parseCusto", () => {
  it("aceita vírgula decimal — é o teclado brasileiro", () => {
    expect(parseCusto("97,38")).toEqual({ ok: true, valor: 97.38 });
  });

  it("aceita ponto também", () => {
    expect(parseCusto("97.38")).toEqual({ ok: true, valor: 97.38 });
  });

  it("vazio vira null (não informado), NÃO zero", () => {
    // null = "não sabemos"; 0 = coleta grátis. Confundir infla o lucro.
    expect(parseCusto("")).toEqual({ ok: true, valor: null });
    expect(parseCusto("   ")).toEqual({ ok: true, valor: null });
  });

  it("zero explícito é aceito — coleta grátis é informação de verdade", () => {
    expect(parseCusto("0")).toEqual({ ok: true, valor: 0 });
  });

  it("texto não numérico é recusado", () => {
    expect(parseCusto("abc")).toEqual({ ok: false });
  });

  it("negativo é recusado — viraria crédito falso no resultado", () => {
    expect(parseCusto("-10")).toEqual({ ok: false });
  });
});

describe("diffCustos — o que de fato mudou", () => {
  it("linha não tocada NÃO entra no lote", () => {
    // Sem isto, salvar em lote gravaria null por cima de custo já informado.
    expect(diffCustos(LINHAS, {}).alteracoes).toEqual([]);
  });

  it("valor novo numa linha vazia entra", () => {
    const r = diffCustos(LINHAS, { "73690129": "45,20" });
    expect(r.alteracoes).toEqual([{ remessa: "73690129", valor: 45.2 }]);
  });

  it("valor igual ao salvo NÃO conta como mudança", () => {
    expect(diffCustos(LINHAS, { "73306199": "97,38" }).alteracoes).toEqual([]);
  });

  it("vazio onde JÁ HAVIA custo é uma alteração (limpar)", () => {
    const r = diffCustos(LINHAS, { "73306199": "" });
    expect(r.alteracoes).toEqual([{ remessa: "73306199", valor: null }]);
  });

  it("vazio onde NÃO havia custo não muda nada", () => {
    expect(diffCustos(LINHAS, { "73690129": "" }).alteracoes).toEqual([]);
  });

  it("várias de uma vez — é o ponto do lote", () => {
    const r = diffCustos(LINHAS, { "73690129": "45,20", "74265340": "31,00" });
    expect(r.alteracoes).toHaveLength(2);
  });

  it("uma inválida não impede as válidas de serem identificadas", () => {
    const r = diffCustos(LINHAS, { "73690129": "45,20", "74265340": "abc" });
    expect(r.alteracoes).toEqual([{ remessa: "73690129", valor: 45.2 }]);
    expect(r.invalidas).toEqual(["74265340"]);
  });

  it("mudar de valor informado para outro entra", () => {
    const r = diffCustos(LINHAS, { "73306199": "120,00" });
    expect(r.alteracoes).toEqual([{ remessa: "73306199", valor: 120 }]);
  });

  it("ignora remessa do rascunho que não existe na lista", () => {
    expect(diffCustos(LINHAS, { "99999999": "10,00" }).alteracoes).toEqual([]);
  });

  it("diferença de centésimo de centavo não vira alteração", () => {
    // Compara centavos: evita gravação inútil por ruído de float.
    expect(diffCustos(LINHAS, { "73306199": "97.380000001" }).alteracoes).toEqual([]);
  });

  it("zero sobre custo existente É alteração — coleta virou grátis", () => {
    const r = diffCustos(LINHAS, { "73306199": "0" });
    expect(r.alteracoes).toEqual([{ remessa: "73306199", valor: 0 }]);
  });
});

describe("totalInformado", () => {
  it("soma só o que tem custo", () => {
    expect(totalInformado(LINHAS)).toBeCloseTo(97.38, 2);
  });

  it("lista vazia é zero", () => {
    expect(totalInformado([])).toBe(0);
  });

  it("null nunca entra como zero na conta de quantos informaram", () => {
    const so_nulos: LinhaCusto[] = [{ remessa: "a", custo: null }];
    expect(totalInformado(so_nulos)).toBe(0);
  });
});
