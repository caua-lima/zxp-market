import { describe, expect, it } from "vitest";
import { comSkuAnterior, registrarSkus, skusAnterioresDe } from "./indice-sku";

const norm = (s: string) => s.trim().toLowerCase();
function montar(docs: { id: string; sku?: string; skusAnteriores?: string[] }[]) {
  const indice = new Map<string, string>();
  const atuais = new Set<string>();
  for (const d of docs) registrarSkus(indice, d, d.id, norm, atuais);
  return indice;
}

describe("índice SKU → produto com SKUs anteriores", () => {
  it("venda antiga, com o SKU de antes da troca, continua achando o produto", () => {
    const i = montar([{ id: "limao", sku: "LimaoCaipiraFull", skusAnteriores: ["LimaoCaipira"] }]);
    expect(i.get("limaocaipirafull")).toBe("limao");
    expect(i.get("limaocaipira")).toBe("limao");
  });
  it("o SKU ATUAL de outro produto vence o anterior — vindo antes ou depois", () => {
    expect(montar([
      { id: "a", sku: "Novo", skusAnteriores: ["Reaproveitado"] },
      { id: "b", sku: "Reaproveitado" },
    ]).get("reaproveitado")).toBe("b");
    expect(montar([
      { id: "b", sku: "Reaproveitado" },
      { id: "a", sku: "Novo", skusAnteriores: ["Reaproveitado"] },
    ]).get("reaproveitado")).toBe("b");
  });
  it("dois anteriores iguais: fica o primeiro", () => {
    expect(montar([
      { id: "a", sku: "A2", skusAnteriores: ["X"] },
      { id: "b", sku: "B2", skusAnteriores: ["X"] },
    ]).get("x")).toBe("a");
  });
  it("sem SKU e sem anteriores: nada entra", () => {
    expect(montar([{ id: "a" }]).size).toBe(0);
  });
  it("skusAnteriores inválido é ignorado", () => {
    expect(skusAnterioresDe({ skusAnteriores: "nao-e-lista" })).toEqual([]);
    expect(skusAnterioresDe({ skusAnteriores: [" a ", "", null] })).toEqual(["a"]);
  });
});

describe("comSkuAnterior", () => {
  it("junta o que sai, sem repetir", () => {
    expect(comSkuAnterior(["A"], "B", "C")).toEqual(["A", "B"]);
    expect(comSkuAnterior(["A", "b"], "B", "C")).toEqual(["A", "b"]);
  });
  it("voltar pra um SKU antigo tira ele da lista de anteriores", () => {
    expect(comSkuAnterior(["A", "B"], "C", "a")).toEqual(["B", "C"]);
  });
  it("sem SKU saindo (produto sem SKU antes): lista igual", () => {
    expect(comSkuAnterior(undefined, "", "Novo")).toEqual([]);
  });
  it("só mudou a caixa: não é SKU anterior", () => {
    expect(comSkuAnterior([], "abc", "ABC")).toEqual([]);
  });
});
