import { describe, expect, it } from "vitest";
import { normalizarParaRender } from "./render";

describe("normalizarParaRender", () => {
  it("tira os espaços dos dados do ^GFA (o avião do ML)", () => {
    const zpl = "^XA^FO647,20^GFA,544,544,8,,: : : :M01E,M03F,: :^FS^XZ";
    expect(normalizarParaRender(zpl)).toBe("^XA^FO647,20^GFA,544,544,8,,::::M01E,M03F,::^FS^XZ");
  });

  it("quebra de linha dentro do gráfico também sai", () => {
    expect(normalizarParaRender("^GFA,4,4,1,\nFF\r\nFF\n^FS")).toBe("^GFA,4,4,1,FFFF^FS");
  });

  it("não mexe em texto fora de gráfico", () => {
    const zpl = "^XA^FO10,10^A0N,24,24^FDRua de Teste 100, Bairro^FS^XZ";
    expect(normalizarParaRender(zpl)).toBe(zpl);
  });

  it("vários gráficos na mesma etiqueta", () => {
    const zpl = "^GFA,2,2,1,F F^FS^FDa b^FS^GFA,2,2,1,0 0^FS";
    expect(normalizarParaRender(zpl)).toBe("^GFA,2,2,1,FF^FS^FDa b^FS^GFA,2,2,1,00^FS");
  });
});
