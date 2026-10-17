import { describe, expect, it } from "vitest";
import {
  agruparProdutos,
  canalDaLogistica,
  canalDoAnuncio,
  canalOposto,
  canalValido,
  chaveDoGrupo,
  gruposExistentes,
  irmaosDe,
  normalizarGrupo,
  sugerirCanal,
  sobraNosIrmaos,
  sugerirGrupo,
  sugerirVersao,
  type ProdutoComGrupo,
} from "./grupo-produto";

const p = (id: string, x: Partial<ProdutoComGrupo> = {}): ProdutoComGrupo => ({ id, name: id, ...x });

describe("normalizarGrupo", () => {
  it("ignora acento, caixa e espaços repetidos", () => {
    expect(normalizarGrupo("  Limão   CAIPIRA ")).toBe("limao caipira");
    expect(normalizarGrupo(undefined)).toBe("");
  });
});

describe("canal do anúncio: o fato do ML vale mais que o cadastro", () => {
  it("fulfillment é Full; qualquer outra logística é agências", () => {
    expect(canalDaLogistica("fulfillment")).toBe("full");
    expect(canalDaLogistica("xd_drop_off")).toBe("agencias");
    expect(canalDaLogistica("cross_docking")).toBe("agencias");
  });
  it("logística vazia ou ausente não vira canal nenhum", () => {
    expect(canalDaLogistica("")).toBeNull();
    expect(canalDaLogistica(undefined)).toBeNull();
  });
  it("produto marcado agências com anúncio Full: vale o Full", () => {
    expect(canalDoAnuncio("fulfillment", "agencias")).toBe("full");
  });
  it("sem resposta do ML, cai no canal do cadastro; sem nenhum, null (não chuta)", () => {
    expect(canalDoAnuncio(undefined, "agencias")).toBe("agencias");
    expect(canalDoAnuncio(undefined, undefined)).toBeNull();
    expect(canalDoAnuncio(undefined, "qualquer")).toBeNull();
  });
  it("canalValido só aceita os dois", () => {
    expect(canalValido("full")).toBe("full");
    expect(canalValido("Full")).toBeNull();
  });
});

describe("agrupamento", () => {
  const lista = [
    p("a", { grupo: "Limão Caipira", canal: "full" }),
    p("b", { grupo: "limao caipira", canal: "agencias" }),
    p("c", { name: "Menta" }),
    p("d", { grupo: "  " }),
  ];
  it("mesmo grupo (sem acento nem caixa) vira um só; sem grupo é um grupo de um", () => {
    const g = agruparProdutos(lista);
    expect(g.map((x) => x.produtos.map((y) => y.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(g[0].nome).toBe("Limão Caipira");
    expect(g[1].nome).toBe("Menta");
  });
  it("grupo em branco não junta produtos que não têm nada a ver", () => {
    expect(chaveDoGrupo(lista[2])).not.toBe(chaveDoGrupo(lista[3]));
  });
  it("irmãos: os outros do grupo; avulso não tem", () => {
    expect(irmaosDe(lista[0], lista).map((x) => x.id)).toEqual(["b"]);
    expect(irmaosDe(lista[2], lista)).toEqual([]);
  });
  it("grupos existentes: sem repetir, ordenados, como foram digitados", () => {
    expect(gruposExistentes(lista)).toEqual(["Limão Caipira"]);
    expect(gruposExistentes([p("x", { grupo: "Zeta" }), p("y", { grupo: "Alfa" })])).toEqual(["Alfa", "Zeta"]);
  });
});

describe("sugestões a partir do nome", () => {
  it("tira o sufixo do canal pra achar o grupo", () => {
    expect(sugerirGrupo("Limão Caipira Agências")).toBe("Limão Caipira");
    expect(sugerirGrupo("Limão Caipira - Full")).toBe("Limão Caipira");
    expect(sugerirGrupo("Limão Caipira (Agencias)")).toBe("Limão Caipira");
    expect(sugerirGrupo("Menta Limão")).toBe("Menta Limão");
  });
  it("nome que é só o sufixo não vira vazio", () => {
    expect(sugerirGrupo("Full")).toBe("Full");
  });
  it("canal que o nome insinua", () => {
    expect(sugerirCanal("Limão Caipira Agências")).toBe("agencias");
    expect(sugerirCanal("Limão Caipira Full")).toBe("full");
    expect(sugerirCanal("Limão Caipira")).toBeNull();
  });
  it("canal oposto", () => {
    expect(canalOposto("full")).toBe("agencias");
    expect(canalOposto("agencias")).toBe("full");
  });
  it("versão do outro canal: nome, SKU e o mesmo grupo", () => {
    const v = sugerirVersao(p("a", { name: "Limão Caipira", sku: "LimaoCaipira", canal: "full" }), "agencias");
    expect(v).toEqual({ nome: "Limão Caipira Agências", sku: "LimaoCaipiraAgencias", grupo: "Limão Caipira" });
  });
  it("a versão nunca repete o SKU do original, mesmo se o original já termina em Full", () => {
    const v = sugerirVersao(p("a", { name: "Menta Full", sku: "MentaFull", grupo: "Menta" }), "agencias");
    expect(v.sku).toBe("MentaAgencias");
    expect(v.grupo).toBe("Menta");
    expect(v.nome).toBe("Menta Agências");
  });
  it("sem SKU no original, o SKU sai do nome sem espaços", () => {
    expect(sugerirVersao(p("a", { name: "Erva Mate" }), "full").sku).toBe("ErvaMateFull");
  });
});

describe("sobraNosIrmaos", () => {
  type P = ProdutoComGrupo & { qtdLocal?: number };
  const lista: P[] = [
    { id: "a", name: "A", grupo: "G", qtdLocal: 0 },
    { id: "b", name: "B", grupo: "G", qtdLocal: 40 },
    { id: "c", name: "C", grupo: "G", qtdLocal: 90 },
    { id: "d", name: "D", grupo: "G", qtdLocal: 70, ativo: false },
    { id: "e", name: "E", grupo: "Outro", qtdLocal: 500 },
    { id: "f", name: "F", qtdLocal: -3 },
  ];
  it("só os irmãos com algo em casa, do maior pro menor; inativo e outro grupo ficam de fora", () => {
    expect(sobraNosIrmaos(lista[0], lista).map((x) => [x.produto.id, x.emCasa])).toEqual([["c", 90], ["b", 40]]);
  });
  it("produto sem grupo não tem irmãos; saldo negativo não conta como sobra", () => {
    expect(sobraNosIrmaos(lista[5], lista)).toEqual([]);
    expect(sobraNosIrmaos({ id: "z", grupo: "G" }, [{ id: "n", grupo: "G", qtdLocal: -5 }])).toEqual([]);
  });
});
