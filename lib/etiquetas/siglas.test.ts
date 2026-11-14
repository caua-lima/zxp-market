import { describe, expect, it } from "vitest";
import { conferirCadastro, normalizarSigla, siglasDoEnvio, totaisPorSigla, type SiglaDoProduto } from "./siglas";

const TT: SiglaDoProduto = { produtoId: "p1", nome: "Trot's Tradicional", sigla: "TT", skus: ["TrotsTradicional"], mlbs: ["MLB111"] };
const TT_AG: SiglaDoProduto = { produtoId: "p2", nome: "Trot's Tradicional Agências", sigla: "TT", skus: ["TrotsTradicionalAgências"], mlbs: ["MLB222"] };
const BM: SiglaDoProduto = { produtoId: "p3", nome: "Boldo & Menta", sigla: "BM", skus: ["BoldoMenta"], mlbs: ["MLB333"] };
const KIT2: SiglaDoProduto = { produtoId: "p4", nome: "Kit 2 Tradicional", sigla: "K2", skus: ["Kit2TT"], mlbs: [], componentes: [{ sigla: "TT", quantidade: 2 }] };
const MISTO: SiglaDoProduto = { produtoId: "p5", nome: "Kit TT+BM", sigla: "KM", skus: ["KitMisto"], mlbs: [], componentes: [{ sigla: "TT", quantidade: 1 }, { sigla: "BM", quantidade: 1 }] };
const SEM_COMP: SiglaDoProduto = { produtoId: "p6", nome: "Kit Sem Composição", sigla: "KX", skus: ["KitX"], mlbs: [], componentes: [] };
const LISTA = [TT, TT_AG, BM, KIT2, MISTO, SEM_COMP];

describe("siglasDoEnvio — as regras do dono", () => {
  it("1 TT → TT; 2 unitários TT → 2TT", () => {
    expect(siglasDoEnvio([{ sku: "TrotsTradicional", quantidade: 1 }], LISTA)).toMatchObject({ ok: true, texto: "TT" });
    expect(siglasDoEnvio([{ sku: "TrotsTradicional", quantidade: 2 }], LISTA)).toMatchObject({ ok: true, texto: "2TT" });
  });
  it("1 kit de 2 → 2TT; 2 kits de 2 → 4TT", () => {
    expect(siglasDoEnvio([{ sku: "Kit2TT", quantidade: 1 }], LISTA)).toMatchObject({ ok: true, texto: "2TT" });
    expect(siglasDoEnvio([{ sku: "Kit2TT", quantidade: 2 }], LISTA)).toMatchObject({ ok: true, texto: "4TT" });
  });
  it("kit misto expande nos componentes", () => {
    expect(siglasDoEnvio([{ sku: "KitMisto", quantidade: 1 }], LISTA)).toMatchObject({ ok: true, texto: "TT + BM" });
  });
  it("Full e Agências do mesmo produto somam na mesma sigla", () => {
    const r = siglasDoEnvio([{ sku: "TrotsTradicional", quantidade: 1 }, { mlb: "MLB222", quantidade: 1 }], LISTA);
    expect(r).toMatchObject({ ok: true, texto: "2TT" });
  });
  it("MLB do anúncio manda antes do SKU", () => {
    expect(siglasDoEnvio([{ mlb: "MLB333", sku: "TrotsTradicional", quantidade: 1 }], LISTA)).toMatchObject({ ok: true, texto: "BM" });
  });
  it("kit sem composição e produto sem cadastro ficam PENDENTES — nunca viram 1 unidade", () => {
    expect(siglasDoEnvio([{ sku: "KitX", quantidade: 1 }], LISTA)).toMatchObject({ ok: false });
    const r = siglasDoEnvio([{ sku: "TrotsTradicional", quantidade: 1 }, { sku: "Desconhecido", quantidade: 1 }], LISTA);
    expect(r.ok).toBe(false);
  });
  it("totais da lista de separação somam por sigla", () => {
    const t = totaisPorSigla([{ porSigla: [{ sigla: "TT", quantidade: 2 }] }, { porSigla: [{ sigla: "TT", quantidade: 1 }, { sigla: "BM", quantidade: 1 }] }]);
    expect(Object.fromEntries(t)).toEqual({ TT: 3, BM: 1 });
  });
});

describe("cadastro", () => {
  it("sigla inválida ou repetida em produtos diferentes acusa; Full + Agências podem dividir", () => {
    expect(conferirCadastro([TT, TT_AG, BM])).toEqual([]);
    expect(conferirCadastro([TT, { ...BM, sigla: "TT" }]).length).toBe(1);
    expect(conferirCadastro([{ ...TT, sigla: "tt^FS" }]).length).toBe(1);
  });
  it("normaliza o que se digita (sem comando ZPL passando)", () => {
    expect(normalizarSigla(" tt^XZ ")).toBe("TTXZ");
    expect(normalizarSigla("açaí")).toBe("ACAI");
  });
});
