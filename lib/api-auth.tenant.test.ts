import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * requireAccess no modo empresa (segundo cliente): autoriza pelo membro da
 * empresa e ENTRA nela pelo resto da requisição. Firebase simulado: só os
 * documentos que importam.
 */

const docs = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@/lib/firebase/admin", () => {
  const doc = (p: string) => ({ get: async () => ({ exists: docs.has(p), data: () => docs.get(p) }) });
  return {
    getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: `uid-${t}`, email: t }) }),
    getAdminDb: () => ({ doc, collection: (c: string) => ({ doc: (id: string) => doc(`${c}/${id}`) }) }),
  };
});

const { requireAccess } = await import("./api-auth");
const { tenantAtual, comTenant } = await import("./firebase/contexto-tenant");

const req = (email: string) => new Request("https://x/api", { headers: { authorization: `Bearer ${email}` } });

beforeEach(() => docs.clear());
afterEach(() => { delete process.env.NEXT_PUBLIC_ZXP_MODO_DADOS; });

describe("requireAccess — modo raiz (hoje)", () => {
  it("autoriza por controleAcesso, sem empresa", async () => {
    docs.set("controleAcesso/dono@a.com", { role: "owner" });
    const r = await requireAccess(req("dono@a.com"));
    expect(r).not.toBeInstanceOf(NextResponse);
    expect(r).toMatchObject({ papel: "owner", tenantId: null });
  });
});

describe("requireAccess — modo empresa (segundo cliente)", () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant"; });

  it("membro da empresa: autoriza com o papel DE LÁ e entra na empresa pelo resto da requisição", async () => {
    docs.set("memberships/p@b.com", { tenantId: "empresa-b" });
    docs.set("tenants/empresa-b/members/p@b.com", { role: "partner", permissoesEdicao: ["estoque"] });
    await comTenant("fora", async () => {
      const r = await requireAccess(req("p@b.com"));
      expect(r).toMatchObject({ papel: "partner", tenantId: "empresa-b", permissoesEdicao: ["estoque"] });
      expect(tenantAtual()).toBe("empresa-b");
    });
  });

  it("estar em controleAcesso NÃO basta no modo empresa — a lista global não é de empresa nenhuma", async () => {
    docs.set("controleAcesso/legado@x.com", { role: "owner" });
    const r = await requireAccess(req("legado@x.com"));
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(403);
  });

  it("ponteiro órfão (removido da empresa) é recusado — nunca confiar só no ponteiro", async () => {
    docs.set("memberships/ex@b.com", { tenantId: "empresa-b" });
    const r = await requireAccess(req("ex@b.com"));
    expect((r as NextResponse).status).toBe(403);
  });

  it("a capacidade é avaliada com o papel da empresa", async () => {
    docs.set("memberships/m@b.com", { tenantId: "empresa-b" });
    docs.set("tenants/empresa-b/members/m@b.com", { role: "member" });
    const r = await requireAccess(req("m@b.com"), { capacidade: "administrar" });
    expect((r as NextResponse).status).toBe(403);
  });
});
