import { describe, expect, it } from "vitest";
import { gruposQueBatem, perguntaDeEstoque, respostaDeEstoque, resumirGrupo, type ProdutoConsulta } from "./estoque-consulta";

const PRODUTOS: ProdutoConsulta[] = [
  { id: "ml-full", name: "Trot´s Menta Limão", grupo: "Trot´s Menta Limão", mlbs: ["MLB1", "MLB2"] },
  { id: "ml-ag", name: "Trot´s Menta Limão Agências", grupo: "Trot´s Menta Limão", mlbs: ["MLB3"] },
  { id: "lc", name: "Trot´s Limão Caipira", grupo: "Trot´s Limão Caipira", mlbs: ["MLB4"] },
  { id: "ms", name: "Trot´s Menta Stronger", grupo: "Trot´s Menta Stronger", mlbs: ["MLB5"] },
];
const ANUNCIOS = {
  // Dois anúncios do Full no MESMO pool: o mesmo estoque, conta uma vez.
  MLB1: { available: 57, logistic: "fulfillment", inventoryId: "INV1" },
  MLB2: { available: 57, logistic: "fulfillment", inventoryId: "INV1" },
  MLB3: { available: 183, logistic: "xd_drop_off" },
  MLB4: { available: 100, logistic: "fulfillment", inventoryId: "INV4" },
};

describe("perguntaDeEstoque", () => {
  it("reconhece e tira o produto da pergunta", () => {
    expect(perguntaDeEstoque("Quanto de estoque tenho hoje do Menta Limão?")).toEqual(["menta", "limao"]);
    expect(perguntaDeEstoque("como altero o custo?")).toBeNull();
  });
});

describe("gruposQueBatem", () => {
  it("Menta Limão não confunde com Limão Caipira nem Menta Stronger", () => {
    expect(gruposQueBatem(["menta", "limao"], PRODUTOS)).toEqual(["Trot´s Menta Limão"]);
    expect(gruposQueBatem(["limao"], PRODUTOS)).toEqual(["Trot´s Menta Limão", "Trot´s Limão Caipira"]);
  });
});

describe("resumirGrupo e resposta", () => {
  it("agências + Full (pool contado uma vez) e cobertura", () => {
    const r = resumirGrupo("Trot´s Menta Limão", PRODUTOS, ANUNCIOS, { "ml-full": 150, "ml-ag": 30 }, 30);
    expect(r).toMatchObject({ agencias: 183, full: 57, total: 240, mediaDia: 6, diasDeCobertura: 40 });
    expect(respostaDeEstoque(r)).toMatch(/240 un no total — 183 un em casa .* 57 un no Full/);
    expect(respostaDeEstoque(r)).toMatch(/Não precisa repor/);
  });
  it("cobertura curta pede reposição com a quantidade que falta", () => {
    const r = resumirGrupo("Trot´s Menta Limão", PRODUTOS, ANUNCIOS, { "ml-full": 600 }, 30);
    expect(r.diasDeCobertura).toBe(12);
    expect(respostaDeEstoque(r)).toMatch(/Precisa repor: pra durar 30 dias faltam ~360 un/);
  });
  it("sem venda não inventa cobertura", () => {
    const r = resumirGrupo("Trot´s Menta Stronger", PRODUTOS, ANUNCIOS, {}, 30);
    expect(r.diasDeCobertura).toBeNull();
    expect(respostaDeEstoque(r)).toMatch(/não dá pra dizer/);
  });
});
