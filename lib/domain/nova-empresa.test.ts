import { describe, expect, it } from "vitest";
import { planoDeNovaEmpresa } from "./nova-empresa";

const livre = { empresaExiste: false, empresaDoDono: null };

describe("planoDeNovaEmpresa (segundo cliente)", () => {
  it("empresa nova nasce com o dono como único owner e o ponteiro dele", () => {
    const p = planoDeNovaEmpresa({ tenantId: "loja-joao", nome: "Loja do João", dono: "Joao@Loja.com" }, livre, 1);
    expect(p).toEqual({
      ok: true,
      escritas: [
        { caminho: "tenants/loja-joao", dados: { name: "Loja do João", criadoEm: 1, dono: "joao@loja.com" } },
        { caminho: "tenants/loja-joao/members/joao@loja.com", dados: { email: "joao@loja.com", role: "owner", addedAt: 1, addedBy: "script:criar-empresa" } },
        { caminho: "memberships/joao@loja.com", dados: { email: "joao@loja.com", tenantId: "loja-joao" } },
      ],
    });
  });

  it("não sobrescreve empresa existente", () => {
    expect(planoDeNovaEmpresa({ tenantId: "vazxpress", nome: "X", dono: "a@b.com" }, { ...livre, empresaExiste: true }).ok).toBe(false);
  });

  it("dono que já é de outra empresa é recusado — uma pessoa, uma empresa", () => {
    const p = planoDeNovaEmpresa({ tenantId: "nova", nome: "N", dono: "a@b.com" }, { empresaExiste: false, empresaDoDono: "vazxpress" });
    expect(p).toMatchObject({ ok: false, problemas: [expect.stringMatching(/vazxpress/)] });
  });

  it("id e e-mail tortos são recusados com a explicação", () => {
    const p = planoDeNovaEmpresa({ tenantId: "Loja do João", nome: "", dono: "sem-arroba" }, livre);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.problemas).toHaveLength(3);
  });
});
