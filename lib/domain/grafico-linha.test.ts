import { describe, expect, it } from "vitest";
import { caminhoSuave, escalaRedonda } from "./grafico-linha";

describe("escalaRedonda", () => {
  it("723 vai a 800 em marcas de 200 (como no painel do ML)", () => {
    expect(escalaRedonda(723)).toEqual({ max: 800, passos: [0, 200, 400, 600, 800] });
  });
  it("valores pequenos e grandes ficam redondos", () => {
    expect(escalaRedonda(9).max).toBe(10);
    expect(escalaRedonda(1260).passos.at(-1)).toBe(1500);
    expect(escalaRedonda(48).passos).toEqual([0, 20, 40, 60]);
  });
  it("o máximo exato não ganha uma marca a mais", () => {
    expect(escalaRedonda(800)).toEqual({ max: 800, passos: [0, 200, 400, 600, 800] });
  });
  it("sem venda (zero, NaN, negativo) ainda devolve uma escala desenhável", () => {
    for (const v of [0, NaN, -5, Infinity]) {
      const e = escalaRedonda(v);
      expect(e.max).toBeGreaterThan(0);
      expect(e.passos[0]).toBe(0);
      expect(e.passos.length).toBeGreaterThanOrEqual(2);
    }
  });
  it("o último passo é sempre o máximo, e o máximo cobre o valor", () => {
    for (const v of [1, 7, 33, 99, 101, 555, 1234, 98765]) {
      const e = escalaRedonda(v);
      expect(e.passos.at(-1)).toBe(e.max);
      expect(e.max).toBeGreaterThanOrEqual(v);
    }
  });
});

describe("caminhoSuave", () => {
  it("vazio e ponto único", () => {
    expect(caminhoSuave([])).toBe("");
    expect(caminhoSuave([{ x: 1, y: 2 }])).toBe("M1 2");
  });
  it("começa e termina nos pontos dados", () => {
    const d = caminhoSuave([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 5 }]);
    expect(d.startsWith("M0 10")).toBe(true);
    expect(d.endsWith("20 5")).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(2);
  });
  it("não passa do vale: curva entre 5 e 5 com 0 no meio não afunda do eixo", () => {
    // y cresce pra baixo no SVG; o ponto mais "baixo" é o maior y. Nada pode passar do maior y dos pontos.
    const pontos = [{ x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 40 }, { x: 30, y: 100 }];
    const d = caminhoSuave(pontos);
    const nums = [...d.matchAll(/C([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) /g)].flatMap((m) => [Number(m[2]), Number(m[4])]);
    expect(Math.max(...nums)).toBeLessThanOrEqual(100 + 1e-6);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(40 - 1e-6);
  });
  it("trecho reto (mesmo y) fica reto", () => {
    const d = caminhoSuave([{ x: 0, y: 7 }, { x: 5, y: 7 }, { x: 10, y: 7 }]);
    expect([...d.matchAll(/C[\d.\-]+ ([\d.\-]+) [\d.\-]+ ([\d.\-]+) /g)].flatMap((m) => [m[1], m[2]]).every((v) => Number(v) === 7)).toBe(true);
  });
  it("x repetido não gera NaN", () => {
    expect(caminhoSuave([{ x: 0, y: 1 }, { x: 0, y: 5 }, { x: 4, y: 2 }])).not.toMatch(/NaN|Infinity/);
  });
});
