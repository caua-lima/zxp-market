import { describe, expect, it } from "vitest";
import { chaveDoSku, transformar, transformacaoVazia, validarEdicao, type LinhaDeEdicao } from "./edicao-em-massa";

describe("transformar", () => {
  it("sufixo e prefixo", () => {
    expect(transformar("Limão Caipira", { sufixo: " Agências" })).toBe("Limão Caipira Agências");
    expect(transformar("Limão", { prefixo: "Kit " })).toBe("Kit Limão");
  });
  it("troca TODAS as ocorrências, sem diferenciar maiúscula", () => {
    expect(transformar("Erva Mate erva mate ERVA", { localizar: "erva", substituir: "Chá" })).toBe("Chá Mate Chá mate Chá");
  });
  it("trecho com caracteres especiais é literal, não regex", () => {
    expect(transformar("Kit (500g) + brinde", { localizar: "(500g)", substituir: "1kg" })).toBe("Kit 1kg + brinde");
    expect(transformar("a.b", { localizar: ".", substituir: "-" })).toBe("a-b");
  });
  it("substituir vazio apaga o trecho; localizar vazio não faz nada", () => {
    expect(transformar("Menta Full", { localizar: " Full", substituir: "" })).toBe("Menta");
    expect(transformar("Menta", { localizar: "", substituir: "x" })).toBe("Menta");
  });
  it("a ordem é trocar, depois prefixo, depois sufixo; espaço duplicado some", () => {
    expect(transformar("Limão  Full", { localizar: "Full", substituir: "Agências", prefixo: "A ", sufixo: " 500g" })).toBe("A Limão Agências 500g");
  });
  it("SKU: sufixo colado, sem espaço", () => {
    expect(transformar("LimaoCaipira", { sufixo: "Ag" })).toBe("LimaoCaipiraAg");
  });
  it("transformacaoVazia", () => {
    expect(transformacaoVazia({})).toBe(true);
    expect(transformacaoVazia({ substituir: "x" })).toBe(true);
    expect(transformacaoVazia({ sufixo: "x" })).toBe(false);
  });
});

const l = (id: string, nome: string, sku: string, novoNome = nome, novoSku = sku): LinhaDeEdicao => ({ id, nome, sku, novoNome, novoSku });

describe("validarEdicao", () => {
  it("só entram as linhas que mudaram", () => {
    const r = validarEdicao([l("a", "A", "1"), l("b", "B", "2", "B novo")]);
    expect(r.mudancas.map((x) => x.id)).toEqual(["b"]);
    expect(r.erros.size).toBe(0);
  });
  it("nome vazio ou comprido demais bloqueia", () => {
    const r = validarEdicao([l("a", "A", "1", "  "), l("b", "B", "2", "x".repeat(301))]);
    expect(r.erros.get("a")?.nome).toMatch(/vazio/);
    expect(r.erros.get("b")?.nome).toMatch(/300/);
  });
  it("SKU repetido entre as linhas editadas bloqueia as duas", () => {
    const r = validarEdicao([l("a", "A", "1", "A", "X"), l("b", "B", "2", "B", "x")]);
    expect(r.erros.get("a")?.sku).toBeDefined();
    expect(r.erros.get("b")?.sku).toBeDefined();
  });
  it("SKU novo igual ao de um produto que NÃO está sendo editado bloqueia", () => {
    const r = validarEdicao([l("a", "A", "1", "A", "Menta")], [{ id: "m", sku: " menta " }]);
    expect(r.erros.get("a")?.sku).toMatch(/outro produto/);
  });
  it("trocar dois SKUs entre si é válido (nenhum colide no resultado final)", () => {
    const r = validarEdicao([l("a", "A", "1", "A", "2"), l("b", "B", "2", "B", "1")]);
    expect(r.erros.size).toBe(0);
  });
  it("o produto que sai do SKU antigo libera ele pra outro", () => {
    const r = validarEdicao([l("a", "A", "1", "A", "9"), l("b", "B", "2", "B", "1")]);
    expect(r.erros.size).toBe(0);
  });
  it("vários produtos sem SKU não colidem (vazio não é SKU)", () => {
    const r = validarEdicao([l("a", "A", "", "A novo", ""), l("b", "B", "", "B novo", "")], [{ id: "c", sku: "" }]);
    expect(r.erros.size).toBe(0);
  });
  it("SKU alterado vai pro aviso; só mudar o nome não", () => {
    const r = validarEdicao([l("a", "A", "1", "A2", "1"), l("b", "B", "2", "B", "22")]);
    expect(r.skusAlterados.map((x) => x.id)).toEqual(["b"]);
  });
  it("mudar só a caixa do SKU não é alterar a chave", () => {
    const r = validarEdicao([l("a", "A", "abc", "A", "ABC")]);
    expect(r.mudancas).toHaveLength(1);
    expect(r.skusAlterados).toHaveLength(0);
  });
  it("SKU comprido demais bloqueia", () => {
    expect(validarEdicao([l("a", "A", "1", "A", "x".repeat(61))]).erros.get("a")?.sku).toMatch(/60/);
  });
  it("chaveDoSku ignora caixa e borda", () => {
    expect(chaveDoSku("  AbC ")).toBe("abc");
  });
});
