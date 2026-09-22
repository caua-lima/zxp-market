import { describe, expect, it } from "vitest";
import { planoDeMigracaoDeMembros, validarPlano, type AccessEntryMinima } from "./migracao-tenant";

const acesso = (over: Partial<AccessEntryMinima> = {}): AccessEntryMinima => ({
  email: "pessoa@empresa.com", role: "owner", ...over,
});

describe("planoDeMigracaoDeMembros", () => {
  it("mapeia cada AccessEntry pro papel de tenant, e-mail normalizado", () => {
    const plano = planoDeMigracaoDeMembros(
      [acesso({ email: "Dono@Empresa.com", role: "owner" }), acesso({ email: "colega@empresa.com", role: "colaborador" })],
      { tenantId: "vazxpress", nomeDoTenant: "VAZXPRESS" },
    );
    expect(plano.tenantId).toBe("vazxpress");
    expect(plano.tenant).toEqual({ name: "VAZXPRESS" });
    expect(plano.membros).toEqual([
      { email: "dono@empresa.com", role: "owner", migradoDe: "controleAcesso" },
      { email: "colega@empresa.com", role: "partner", migradoDe: "controleAcesso" }, // "colaborador" (legado) -> partner
    ]);
  });

  it("papeis legados (admin, user) tambem viram partner — mesma regra de papelDe hoje", () => {
    const plano = planoDeMigracaoDeMembros(
      [acesso({ email: "a@x.com", role: "admin" }), acesso({ email: "b@x.com", role: "user" })],
      { tenantId: "t1", nomeDoTenant: "T1" },
    );
    expect(plano.membros.map((m) => m.role)).toEqual(["partner", "partner"]);
  });

  it("member continua member — nao herda partner por engano", () => {
    const plano = planoDeMigracaoDeMembros([acesso({ email: "m@x.com", role: "member" })], { tenantId: "t1", nomeDoTenant: "T1" });
    expect(plano.membros[0].role).toBe("member");
  });

  it("permissoesEdicao so entra quando existe e tem conteudo", () => {
    const plano = planoDeMigracaoDeMembros(
      [
        acesso({ email: "com-permissao@x.com", role: "partner", permissoesEdicao: ["estoque", "custos"] }),
        acesso({ email: "sem-permissao@x.com", role: "partner", permissoesEdicao: [] }),
        acesso({ email: "sem-campo@x.com", role: "partner" }),
      ],
      { tenantId: "t1", nomeDoTenant: "T1" },
    );
    expect(plano.membros[0].permissoesEdicao).toEqual(["estoque", "custos"]);
    expect(plano.membros[1]).not.toHaveProperty("permissoesEdicao");
    expect(plano.membros[2]).not.toHaveProperty("permissoesEdicao");
  });

  it("gera um ponteiro memberships pra CADA membro, apontando pro mesmo tenant", () => {
    const plano = planoDeMigracaoDeMembros(
      [acesso({ email: "a@x.com" }), acesso({ email: "b@x.com", role: "member" })],
      { tenantId: "t1", nomeDoTenant: "T1" },
    );
    expect(plano.memberships).toEqual([
      { email: "a@x.com", tenantId: "t1" },
      { email: "b@x.com", tenantId: "t1" },
    ]);
  });
});

describe("validarPlano", () => {
  it("plano bom (um owner, sem duplicata) nao tem problema", () => {
    const plano = planoDeMigracaoDeMembros([acesso({ role: "owner" }), acesso({ email: "b@x.com", role: "member" })], { tenantId: "t1", nomeDoTenant: "T1" });
    expect(validarPlano(plano)).toEqual([]);
  });

  it("sem nenhum owner, acusa — o tenant nasceria sem dono", () => {
    const plano = planoDeMigracaoDeMembros([acesso({ role: "member" })], { tenantId: "t1", nomeDoTenant: "T1" });
    expect(validarPlano(plano)).toContain("nenhum owner no plano — o tenant nasceria sem dono");
  });

  it("mais de um owner, acusa — controleAcesso deveria ter so um", () => {
    const plano = planoDeMigracaoDeMembros(
      [acesso({ email: "a@x.com", role: "owner" }), acesso({ email: "b@x.com", role: "owner" })],
      { tenantId: "t1", nomeDoTenant: "T1" },
    );
    const problemas = validarPlano(plano);
    expect(problemas.some((p) => p.includes("2 owners"))).toBe(true);
  });

  it("sem membro nenhum, acusa", () => {
    const plano = planoDeMigracaoDeMembros([], { tenantId: "t1", nomeDoTenant: "T1" });
    expect(validarPlano(plano)).toContain("nenhum membro pra migrar — controleAcesso está vazio?");
  });

  it("tenantId vazio, acusa", () => {
    const plano = planoDeMigracaoDeMembros([acesso()], { tenantId: "", nomeDoTenant: "T1" });
    expect(validarPlano(plano)).toContain("tenantId vazio");
  });
});
