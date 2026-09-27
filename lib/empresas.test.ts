import { afterEach, describe, expect, it, vi } from "vitest";

const bloqueadas = new Set<string>();
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (c: string) => ({ listDocuments: async () => (c === "tenants" ? [{ id: "emp-b" }, { id: "emp-a" }] : []) }),
    getAll: async (...refs: { id: string }[]) => refs.map((r) => ({ id: r.id, data: () => (bloqueadas.has(r.id) ? { bloqueio: { motivo: "cancelada" } } : {}) })),
  }),
}));

const { caminhoDoTime, paraCadaEmpresa, porEmpresa } = await import("./empresas");
const { comTenant, tenantAtual } = await import("./firebase/contexto-tenant");

afterEach(() => {
  bloqueadas.clear();
  delete process.env.NEXT_PUBLIC_ZXP_MODO_DADOS;
  delete process.env.CRON_SECRET;
});

describe("rotinas e time por empresa (segundo cliente)", () => {
  it("o time: controleAcesso no modo raiz; os membros DA EMPRESA DA REQUISIÇÃO no modo empresa", () => {
    expect(caminhoDoTime()).toBe("controleAcesso");
    process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
    expect(comTenant("empresa-b", () => caminhoDoTime())).toBe("tenants/empresa-b/members");
  });

  it("paraCadaEmpresa: uma vez no modo raiz; no modo empresa, cada uma no próprio contexto, e a falha de uma não derruba a outra", async () => {
    expect(await paraCadaEmpresa(async () => tenantAtual())).toEqual([{ tenantId: null, resultado: null }]);
    process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
    const r = await paraCadaEmpresa(async () => {
      if (tenantAtual() === "emp-a") throw new Error("ML fora");
      return tenantAtual();
    });
    expect(r).toEqual([{ tenantId: "emp-a", erro: "ML fora" }, { tenantId: "emp-b", resultado: "emp-b" }]);
  });

  it("porEmpresa: o agendador (segredo do cron) roda o handler uma vez por empresa; usuário logado roda direto", async () => {
    process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
    process.env.CRON_SECRET = "s";
    const handler = vi.fn(async () => Response.json({ empresa: tenantAtual() }));
    const doCron = await porEmpresa(handler)(new Request("http://x", { headers: { authorization: "Bearer s" } }));
    expect(await doCron.json()).toMatchObject({ ok: true, empresas: [{ tenantId: "emp-a", resultado: { corpo: { empresa: "emp-a" } } }, { tenantId: "emp-b" }] });
    handler.mockClear();
    await porEmpresa(handler)(new Request("http://x", { headers: { authorization: "Bearer token-de-usuario" } }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("S25: empresa bloqueada fica fora das rotinas — menos no cron diário, que reconcilia a assinatura dela", async () => {
    process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
    bloqueadas.add("emp-a");
    expect((await paraCadaEmpresa(async () => tenantAtual())).map((r) => r.tenantId)).toEqual(["emp-b"]);
    expect((await paraCadaEmpresa(async () => tenantAtual(), { incluirBloqueadas: true })).map((r) => r.tenantId)).toEqual(["emp-a", "emp-b"]);
  });
});
