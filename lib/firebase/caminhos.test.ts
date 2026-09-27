import { describe, expect, it } from "vitest";
import { lerConfigDeDados, traduzirCaminho } from "./caminhos";

const T = { modo: "tenant" as const, tenantId: "vazxpress" };

describe("a chave da virada (Etapa 3)", () => {
  it("desligada (o padrão): TODO caminho sai idêntico — é o que deixa isto em produção antes da migração", () => {
    const raiz = lerConfigDeDados(undefined, undefined);
    for (const c of ["ml_orders/1", "estoque", "ml_tokens/main", "usuarios/u/preferences/x", "notification_feed/a@b.com/itens/1"]) {
      expect(traduzirCaminho(c, raiz)).toBe(c);
    }
    expect(lerConfigDeDados("raiz", "")).toEqual({ modo: "raiz" });
  });

  it("ligada: dado da empresa vai pra tenants/{id}, inclusive subcoleção", () => {
    expect(traduzirCaminho("ml_orders/123", T)).toBe("tenants/vazxpress/ml_orders/123");
    expect(traduzirCaminho("estoque", T)).toBe("tenants/vazxpress/estoque");
    expect(traduzirCaminho("notification_feed/a@b.com/itens/9", T)).toBe("tenants/vazxpress/notification_feed/a@b.com/itens/9");
  });

  it("ligada: a conexão do ML vira connections; o que é da pessoa ou do sistema fica", () => {
    expect(traduzirCaminho("ml_tokens/main", T)).toBe("tenants/vazxpress/connections/main");
    expect(traduzirCaminho("usuarios/u1/preferences/n", T)).toBe("usuarios/u1/preferences/n");
    expect(traduzirCaminho("pushTokens/x", T)).toBe("pushTokens/x");
    expect(traduzirCaminho("controleAcesso/a@b.com", T)).toBe("controleAcesso/a@b.com");
    expect(traduzirCaminho("tenants/vazxpress/members/a", T)).toBe("tenants/vazxpress/members/a");
  });

  it("falha alto com configuração torta — nunca grava no lugar errado em silêncio", () => {
    expect(() => lerConfigDeDados("tenant", "")).toThrow(/TENANT_ID/);
    expect(() => lerConfigDeDados("tenant", "../x")).toThrow();
    expect(() => lerConfigDeDados("empresa", "vazxpress")).toThrow(/inválido/);
    expect(lerConfigDeDados("TENANT", "vazxpress")).toEqual(T);
  });
});
