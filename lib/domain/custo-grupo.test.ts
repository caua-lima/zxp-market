import { describe, expect, it } from "vitest";
import type { EstoqueMovimento } from "@/lib/domain/types";
import { custoInicialDoGrupo, membrosDoCusto, reconstruirCustoDoGrupo } from "./custo-grupo";

const full = { id: "f", name: "Trot´s Menta Limão", grupo: "Trot´s Menta Limão", canal: "full" as const, custo: "12.94" };
const ag = { id: "a", name: "Trot´s Menta Limão Agências", grupo: "Trot´s Menta Limão", canal: "agencias" as const, custo: "12.9423" };

function mov(p: Partial<EstoqueMovimento> & { id: string; productId: string }): EstoqueMovimento {
  return { tipo: "entrada", quantidade: 0, data: "2026-11-01", createdAt: 0, ...p } as EstoqueMovimento;
}

describe("membrosDoCusto", () => {
  it("o par Full + Agências do mesmo grupo divide o custo", () => {
    expect(membrosDoCusto(ag, [full, ag]).map((p) => p.id)).toEqual(["a", "f"]);
    expect(membrosDoCusto(full, [full, ag]).map((p) => p.id)).toEqual(["f", "a"]);
  });

  it("sem grupo, inativo ou dois do mesmo canal: fica sozinho", () => {
    expect(membrosDoCusto({ ...full, grupo: "" }, [full, ag])).toHaveLength(1);
    expect(membrosDoCusto(full, [full, { ...ag, ativo: false }])).toHaveLength(1);
    expect(membrosDoCusto(full, [full, { ...ag, canal: "full" as const }])).toHaveLength(1);
  });

  it("o custo inicial é o do cadastro do Full", () => {
    expect(custoInicialDoGrupo([ag, full])).toBe(12.94);
  });
});

describe("reconstruirCustoDoGrupo — Menta Limão, nov/2026", () => {
  const livros = new Map<string, EstoqueMovimento[]>([
    ["f", [
      mov({ id: "f1", productId: "f", quantidade: 400, custoUnit: 12.9423, estoqueAntes: 0, data: "2026-10-15" }),
      // Transferência pras Agências: as duas pernas somem do livro juntado.
      mov({ id: "tr-s", productId: "f", tipo: "ajuste", quantidade: -200, data: "2026-11-17", transferenciaCom: "a" }),
    ]],
    ["a", [
      mov({ id: "tr-e", productId: "a", quantidade: 200, custoUnit: 99, estoqueAntes: 0, data: "2026-11-17", transferenciaCom: "f" }),
      // A compra de 22/11 contra o sabor inteiro (145 em casa + 33 no Full).
      mov({ id: "a1", productId: "a", quantidade: 110, custoUnit: 13.1818, estoqueAntes: 178, data: "2026-11-22" }),
    ]],
  ]);

  it("um custo só pros dois, e a transferência não mexe nele", () => {
    const r = reconstruirCustoDoGrupo(livros, 12.94);
    const esperado = (178 * 12.9423 + 110 * 13.1818) / 288;
    expect(r.custoMedio).toBeCloseTo(esperado, 4);
    expect(r.faixas.at(-1)).toEqual({ desde: "2026-11-22", custo: Math.round(esperado * 10000) / 10000 });
  });

  it("a quantidade em casa continua de cada um", () => {
    const r = reconstruirCustoDoGrupo(livros, 12.94);
    expect(r.qtdLocal.get("f")).toBe(200);
    expect(r.qtdLocal.get("a")).toBe(310);
  });
});
