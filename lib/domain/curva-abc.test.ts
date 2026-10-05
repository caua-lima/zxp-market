import { describe, expect, it } from "vitest";
import { classificarABC } from "./curva-abc";

const v = (valores: number[]) => classificarABC(valores.map((valor, i) => ({ id: `i${i}`, valor })), (x) => x.valor);
const classes = (valores: number[]) => v(valores).linhas.map((l) => l.classe).join("");

describe("curva ABC — a classificação", () => {
  it("o caso de manual: 50/30/10/5/5 → A A B B C (A até 80%, B até 95%)", () => {
    expect(classes([50, 30, 10, 5, 5])).toBe("AABBC");
    const { resumo } = v([50, 30, 10, 5, 5]);
    expect(resumo.A).toMatchObject({ itens: 2, share: 80 });
    expect(resumo.B).toMatchObject({ itens: 2, share: 15 });
    expect(resumo.C).toMatchObject({ itens: 1, share: 5 });
  });

  it("o item que CRUZA o corte é A: o maior vendedor com 90% do total não vira B", () => {
    // Antes (acumulado depois do item <= 80) o primeiro, com 90%, caía em B.
    expect(classes([90, 6, 4])).toBe("ABC");
    expect(v([90, 6, 4]).linhas[0]).toMatchObject({ classe: "A", share: 90, acumulado: 90 });
  });

  it("um item só é A e fecha em 100%", () => {
    const l = v([123.45]).linhas;
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ classe: "A", share: 100, acumulado: 100 });
  });

  it("dez iguais: 8 A, 2 B, nenhum C (cada um vale 10%)", () => {
    expect(classes(Array(10).fill(10))).toBe("AAAAAAAABB");
  });

  it("ordena do maior pro menor, ignorando a ordem de entrada; empate mantém a de entrada", () => {
    const { linhas } = classificarABC(
      [{ id: "x", valor: 10 }, { id: "y", valor: 30 }, { id: "z", valor: 10 }, { id: "w", valor: 50 }],
      (i) => i.valor,
    );
    expect(linhas.map((l) => l.item.id)).toEqual(["w", "y", "x", "z"]);
  });

  it("soma de decimais não desloca o corte (80,00000001 contra 79,9999999)", () => {
    // 0,1 + 0,2 + … em ponto flutuante: o acumulado antes do 3º item é 80 "quase".
    expect(classes([0.4, 0.4, 0.1, 0.1])).toBe("AABB");
  });

  it("acumulado nunca passa de 100 e os shares fecham em 100", () => {
    const { linhas } = v([33.33, 33.33, 33.34]);
    expect(Math.max(...linhas.map((l) => l.acumulado))).toBeLessThanOrEqual(100);
    expect(linhas.reduce((s, l) => s + l.share, 0)).toBeCloseTo(100, 9);
  });

  it("zero e negativo ficam em C e não entram no total (prejuízo no topo da lista não é A)", () => {
    const { linhas, total, resumo } = v([100, 0, -50]);
    expect(total).toBe(100);
    expect(linhas.map((l) => [l.valor, l.classe])).toEqual([[100, "A"], [0, "C"], [-50, "C"]]);
    expect(resumo.C.valor).toBe(0);
  });

  it("lista vazia ou sem nada positivo: sem linhas A/B e sem divisão por zero", () => {
    expect(v([]).linhas).toEqual([]);
    const sem = v([0, -3]);
    expect(sem.total).toBe(0);
    expect(sem.linhas.every((l) => l.classe === "C" && l.share === 0 && l.acumulado === 0)).toBe(true);
    expect(sem.resumo.A.share).toBe(0);
  });

  it("valor que não é número vira zero em vez de contaminar o total com NaN", () => {
    const { total, linhas } = classificarABC([{ valor: 10 }, { valor: Number.NaN }], (x) => x.valor);
    expect(total).toBe(10);
    expect(linhas.map((l) => l.classe)).toEqual(["A", "C"]);
  });
});
