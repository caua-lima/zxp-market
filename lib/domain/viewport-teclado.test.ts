import { describe, it, expect } from "vitest";
import { ajusteDoViewport, LIMIAR_DO_TECLADO_PX } from "./viewport-teclado";

const base = { alturaDaJanela: 844, alturaVisivel: 844, topoVisivel: 0, escala: 1 };

describe("ajusteDoViewport — teclado virtual (U15)", () => {
  it("sem teclado: não age (nada muda nos diálogos)", () => {
    expect(ajusteDoViewport(base)).toEqual({ ativo: false });
  });

  it("iPhone com teclado de ~300px: a área visível vira a altura dos diálogos", () => {
    expect(ajusteDoViewport({ ...base, alturaVisivel: 544 })).toEqual({ ativo: true, altura: 544, topo: 0, teclado: 300 });
  });

  it("página empurrada pelo iOS (offsetTop): o teclado é o que sobra abaixo da área visível", () => {
    const r = ajusteDoViewport({ ...base, alturaVisivel: 500, topoVisivel: 40 });
    expect(r).toEqual({ ativo: true, altura: 500, topo: 40, teclado: 304 });
  });

  it("barra de endereço que recolhe (~60px) não é teclado", () => {
    expect(ajusteDoViewport({ ...base, alturaVisivel: 784 })).toEqual({ ativo: false });
  });

  it("o limiar separa barra de endereço de teclado", () => {
    expect(ajusteDoViewport({ ...base, alturaVisivel: 844 - (LIMIAR_DO_TECLADO_PX - 1) }).ativo).toBe(false);
    expect(ajusteDoViewport({ ...base, alturaVisivel: 844 - LIMIAR_DO_TECLADO_PX }).ativo).toBe(true);
  });

  it("zoom por pinça não conta: a área visível encolhe sem haver teclado", () => {
    expect(ajusteDoViewport({ ...base, alturaVisivel: 400, escala: 2 })).toEqual({ ativo: false });
  });

  it("medidas inválidas (NaN, zero) nunca ativam", () => {
    expect(ajusteDoViewport({ ...base, alturaVisivel: NaN })).toEqual({ ativo: false });
    expect(ajusteDoViewport({ ...base, alturaDaJanela: 0 })).toEqual({ ativo: false });
  });

  it("landscape com teclado (tela baixa): ainda calcula", () => {
    expect(ajusteDoViewport({ alturaDaJanela: 390, alturaVisivel: 190, topoVisivel: 0, escala: 1 })).toEqual({ ativo: true, altura: 190, topo: 0, teclado: 200 });
  });
});
