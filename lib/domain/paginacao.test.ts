import { describe, it, expect } from "vitest";
import { paginar, janelaDePaginas, rotuloDaPagina, POR_PAGINA_PADRAO } from "./paginacao";

const lista = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginar", () => {
  it("fatia na página pedida", () => {
    const p = paginar(lista(100), 2, 10);
    expect(p.itens).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(p.atual).toBe(2);
    expect(p.total).toBe(10);
  });

  it("a última página pode vir incompleta", () => {
    const p = paginar(lista(25), 3, 10);
    expect(p.itens).toEqual([21, 22, 23, 24, 25]);
    expect(p.temProxima).toBe(false);
  });

  it("página além do fim volta pra última, não pra tela vazia", () => {
    const p = paginar(lista(25), 99, 10);
    expect(p.atual).toBe(3);
    expect(p.itens).toHaveLength(5);
  });

  it("página zero ou negativa vira a primeira", () => {
    expect(paginar(lista(25), 0, 10).atual).toBe(1);
    expect(paginar(lista(25), -4, 10).atual).toBe(1);
  });

  it("lista vazia ainda tem uma página", () => {
    const p = paginar([], 1, 10);
    expect(p.total).toBe(1);
    expect(p.itens).toEqual([]);
    expect(p.primeiro).toBe(0);
    expect(p.ultimo).toBe(0);
  });

  it("o intervalo é base 1 — é o que a pessoa lê", () => {
    const p = paginar(lista(100), 3, 10);
    expect(p.primeiro).toBe(21);
    expect(p.ultimo).toBe(30);
  });

  it("tamanho de página inválido cai no padrão", () => {
    expect(paginar(lista(100), 1, 0).itens).toHaveLength(POR_PAGINA_PADRAO);
    expect(paginar(lista(100), 1, NaN).itens).toHaveLength(POR_PAGINA_PADRAO);
  });

  it("tamanho negativo não inverte a fatia", () => {
    expect(paginar(lista(100), 1, -5).itens.length).toBeGreaterThan(0);
  });

  it("temAnterior e temProxima descrevem as pontas", () => {
    const primeira = paginar(lista(30), 1, 10);
    const meio = paginar(lista(30), 2, 10);
    const fim = paginar(lista(30), 3, 10);
    expect([primeira.temAnterior, primeira.temProxima]).toEqual([false, true]);
    expect([meio.temAnterior, meio.temProxima]).toEqual([true, true]);
    expect([fim.temAnterior, fim.temProxima]).toEqual([true, false]);
  });

  it("uma página só não tem nem anterior nem próxima", () => {
    const p = paginar(lista(4), 1, 10);
    expect(p.temAnterior).toBe(false);
    expect(p.temProxima).toBe(false);
  });

  it("não modifica a lista original", () => {
    const l = lista(30);
    const copia = [...l];
    paginar(l, 2, 10);
    expect(l).toEqual(copia);
  });
});

describe("janelaDePaginas", () => {
  it("poucas páginas, todas aparecem", () => {
    expect(janelaDePaginas(1, 3)).toEqual([1, 2, 3]);
  });

  it("uma página só devolve só ela", () => {
    expect(janelaDePaginas(1, 1)).toEqual([1]);
    expect(janelaDePaginas(1, 0)).toEqual([1]);
  });

  it("no meio de muitas, corta dos dois lados", () => {
    expect(janelaDePaginas(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
  });

  it("no começo, corta só do lado direito", () => {
    expect(janelaDePaginas(2, 20)).toEqual([1, 2, 3, null, 20]);
  });

  it("no fim, corta só do esquerdo", () => {
    expect(janelaDePaginas(19, 20)).toEqual([1, null, 18, 19, 20]);
  });

  it("não esconde uma página só — o '…' gastaria o mesmo espaço", () => {
    // entre 1 e 3 há só a 2: mostra a 2 em vez de reticências
    expect(janelaDePaginas(4, 20, 1)).toEqual([1, 2, 3, 4, 5, null, 20]);
  });

  it("mais vizinhos alargam a janela", () => {
    expect(janelaDePaginas(10, 20, 2)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
  });

  it("nunca repete uma página", () => {
    const j = janelaDePaginas(1, 20).filter((x): x is number => x !== null);
    expect(new Set(j).size).toBe(j.length);
  });

  it("vem sempre em ordem crescente", () => {
    const j = janelaDePaginas(10, 20).filter((x): x is number => x !== null);
    expect(j).toEqual([...j].sort((a, b) => a - b));
  });
});

describe("rotuloDaPagina", () => {
  it("lista vazia diz que está vazia", () => {
    expect(rotuloDaPagina(paginar([], 1, 10), "movimento")).toBe("nenhum movimento");
  });

  it("uma página só não fala de páginas", () => {
    expect(rotuloDaPagina(paginar(lista(4), 1, 10), "movimento")).toBe("4 movimento(s)");
  });

  it("várias páginas dizem QUANTO já se viu, não só onde se está", () => {
    const r = rotuloDaPagina(paginar(lista(100), 3, 10), "movimento");
    expect(r).toContain("21–30 de 100");
    expect(r).toContain("página 3 de 10");
  });
});
