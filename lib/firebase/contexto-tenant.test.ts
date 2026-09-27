import { describe, expect, it } from "vitest";
import { comTenant, entrarNoTenant, tenantAtual } from "./contexto-tenant";
import { comCaminhosDeDados, empresaDaRequisicao } from "./db-de-dados";
import type { Firestore } from "firebase-admin/firestore";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("a empresa da requisição (segundo cliente)", () => {
  it("duas requisições AO MESMO TEMPO não enxergam a empresa uma da outra", async () => {
    const vistos: string[] = [];
    await Promise.all([
      comTenant("empresa-a", async () => { await espera(20); vistos.push(`a:${tenantAtual()}`); }),
      comTenant("empresa-b", async () => { await espera(5); vistos.push(`b:${tenantAtual()}`); }),
    ]);
    expect(vistos.sort()).toEqual(["a:empresa-a", "b:empresa-b"]);
    expect(tenantAtual()).toBeNull();
  });

  it("entrarNoTenant vale pelo resto da cadeia — o gate autentica e a rota continua dentro da empresa", async () => {
    await comTenant("x-inicial", async () => {
      entrarNoTenant("empresa-c");
      await espera(1);
      expect(tenantAtual()).toBe("empresa-c");
    });
  });

  it("id de empresa torto é recusado", () => {
    expect(() => comTenant("../outra", () => 1)).toThrow();
    expect(() => entrarNoTenant("")).toThrow();
  });

  it("o banco resolve a empresa A CADA caminho, pelo contexto; sem contexto cai na empresa padrão; sem nenhuma, falha alto", () => {
    const caminhos: string[] = [];
    const falso = { collection: (c: string) => { caminhos.push(c); return {}; }, doc: (c: string) => { caminhos.push(c); return {}; } } as unknown as Firestore;
    const db = comCaminhosDeDados(falso, () => empresaDaRequisicao("padrao"));
    comTenant("empresa-a", () => db.collection("ml_orders"));
    comTenant("empresa-b", () => db.doc("ml_tokens/main"));
    db.collection("estoque");
    db.collection("controleAcesso");
    expect(caminhos).toEqual([
      "tenants/empresa-a/ml_orders",
      "tenants/empresa-b/connections/main",
      "tenants/padrao/estoque",
      "controleAcesso",
    ]);
    expect(() => empresaDaRequisicao("")).toThrow(/sem empresa/);
  });
});
