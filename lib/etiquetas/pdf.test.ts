import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { descreverTexto, partesDoTexto, pdfDaListaDeSeparacao, pdfDasEtiquetas, textoPdf } from "./pdf";

// PNG 1x1 preto.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("pdfDasEtiquetas", () => {
  it("uma página 4x6 pol. por etiqueta", async () => {
    const doc = await PDFDocument.load(await pdfDasEtiquetas([PNG, PNG, PNG]));
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: 288, height: 432 });
  });
});

describe("pdfDaListaDeSeparacao", () => {
  it("gera com prontas, pendentes e acentos sem quebrar", async () => {
    const linhas = Array.from({ length: 80 }, (_, i) => ({
      ordem: i + 1,
      envio: String(48513000000 + i),
      texto: i % 7 === 0 ? null : i % 2 ? "2TT" : "TT + BM",
      itens: [{ titulo: "Tererê Trot’s Limão Caipira — 500 g → kit", quantidade: 1, sku: "TT-500" }],
      problema: i % 7 === 0 ? "produto sem cadastro de sigla" : null,
    }));
    const bytes = await pdfDaListaDeSeparacao({ linhas, geradoEm: new Date("2026-11-18T10:00:00-03:00"), arquivo: "lote.zip › Etiqueta.txt" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("textoPdf troca o que a fonte padrão não escreve", () => {
    expect(textoPdf("Trot’s — a → b “x” ✓")).toBe("Trot's - a > b \"x\" ");
    expect(textoPdf("ação")).toBe("ação");
  });
});

describe("sigla + nome", () => {
  const nomes = { TT: "Trot's Tradicional", BM: "Trot's Boldo & Menta" };
  it("partesDoTexto e descreverTexto", () => {
    expect(partesDoTexto("2TT + BM")).toEqual([{ sigla: "TT", quantidade: 2 }, { sigla: "BM", quantidade: 1 }]);
    expect(descreverTexto("2TT + BM", nomes)).toBe("2x Trot's Tradicional + 1x Trot's Boldo & Menta");
    expect(descreverTexto("MS", nomes)).toBe("1x MS");
  });
  it("a lista sai com os nomes", async () => {
    const bytes = await pdfDaListaDeSeparacao({ linhas: [{ ordem: 1, envio: "1", texto: "2TT", itens: [] }], geradoEm: new Date(), nomes });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
