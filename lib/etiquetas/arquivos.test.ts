import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { lerBytes } from "./arquivos";

const ZPL = "^XA^FO10,10^A0N,24,24^FDSão Paulo^FS^XZ";

describe("lerBytes", () => {
  it("ZIP do ML com o .txt dentro", () => {
    const zip = zipSync({ "Etiqueta de envio.txt": strToU8(ZPL), "__MACOSX/._x": strToU8("lixo") });
    const r = lerBytes("lote.zip", zip);
    expect(r.textos).toEqual([{ nome: "lote.zip › Etiqueta de envio.txt", texto: ZPL }]);
    expect(r.ignorados).toEqual([]);
  });

  it("txt solto (UTF-8 com acento)", () => {
    expect(lerBytes("a.txt", strToU8(ZPL)).textos[0].texto).toBe(ZPL);
  });

  it("Latin-1 não vira lixo", () => {
    const latin = new Uint8Array([...strToU8("^XA^FD"), 0xe3, ...strToU8("^FS^XZ")]);
    expect(lerBytes("a.zpl", latin).textos[0].texto).toBe("^XA^FDã^FS^XZ");
  });

  it("PDF renomeado é recusado com motivo", () => {
    const r = lerBytes("etiqueta.txt", strToU8("%PDF-1.4 ..."));
    expect(r.textos).toEqual([]);
    expect(r.ignorados[0].motivo).toMatch(/PDF/);
  });

  it("ZIP sem ZPL lista o que ignorou", () => {
    const r = lerBytes("x.zip", zipSync({ "leia.txt": strToU8("oi") }));
    expect(r.textos).toEqual([]);
    expect(r.ignorados).toEqual([{ nome: "x.zip › leia.txt", motivo: "não é ZPL" }]);
  });
});
