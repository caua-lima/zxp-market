import { describe, expect, it } from "vitest";
import {
  caminhoColecaoDoTenant,
  caminhoConexao,
  caminhoMembership,
  caminhoMembro,
  caminhoTenant,
  capacidadesDoPapel,
} from "./tenant";

describe("caminhos do Firestore — convenção tenants/{id}/...", () => {
  it("cada caminho segue tenants/{tenantId}/...", () => {
    expect(caminhoTenant("t1")).toBe("tenants/t1");
    expect(caminhoMembro("t1", "Dono@Exemplo.com")).toBe("tenants/t1/members/dono@exemplo.com");
    expect(caminhoConexao("t1", "conn-ml-1")).toBe("tenants/t1/connections/conn-ml-1");
    expect(caminhoColecaoDoTenant("t1", "produtos")).toBe("tenants/t1/produtos");
  });

  it("membro normaliza o e-mail pra minusculo — mesmo comportamento de controleAcesso hoje", () => {
    expect(caminhoMembro("t1", "MAIUSCULO@X.COM")).toBe("tenants/t1/members/maiusculo@x.com");
  });

  it("membership e o ponteiro reverso, fora do tenant — so email, sem tenantId no caminho", () => {
    expect(caminhoMembership("Dono@Exemplo.com")).toBe("memberships/dono@exemplo.com");
  });
});

describe("capacidadesDoPapel", () => {
  it("owner tem tudo, inclusive administrar o tenant e a billing", () => {
    const c = capacidadesDoPapel("owner");
    expect(c.has("tenant:administrar")).toBe(true);
    expect(c.has("membros:gerir")).toBe(true);
    expect(c.has("billing:gerir")).toBe(true);
    expect(c.has("dados:editar-tudo")).toBe(true);
  });

  it("member nunca ganha permissao granular, mesmo se alguem passar permissoesEdicao pra ele", () => {
    // Mesma regra que ja existe em AccessGuard.tsx (canEditTab): "o papel manda
    // sobre a lista" — um member rebaixado que ainda tenha permissoesEdicao
    // sobrando nao pode editar nada.
    const c = capacidadesDoPapel("member", ["estoque", "custos"]);
    expect(c.has("dados:editar:estoque")).toBe(false);
    expect(c.has("dados:editar:custos")).toBe(false);
    expect(c.has("dados:ler-restrito")).toBe(true);
  });

  it("partner ganha dados:editar:<aba> só pelas abas liberadas, nada além", () => {
    const c = capacidadesDoPapel("partner", ["estoque"]);
    expect(c.has("dados:editar:estoque")).toBe(true);
    expect(c.has("dados:editar:custos")).toBe(false);
    expect(c.has("tenant:administrar")).toBe(false);
  });

  it("sem permissoesEdicao, partner so tem a leitura base", () => {
    const c = capacidadesDoPapel("partner");
    expect(c.has("dados:ler")).toBe(true);
    expect([...c].some((cap) => cap.startsWith("dados:editar:"))).toBe(false);
  });
});
