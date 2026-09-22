import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * `requireTenantAccess` — a fundação do S01. Mocka o Admin SDK pra isolar
 * só a lógica de resolução (token → memberships → tenants/{id}/members).
 */

const verifyIdTokenMock = vi.fn();
const docGetMock = vi.fn();
const docMock = vi.fn(() => ({ get: docGetMock }));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: verifyIdTokenMock }),
  getAdminDb: () => ({ doc: docMock }),
}));

const requisicao = (token?: string) => new Request("https://exemplo.com/api/tenant/whoami", {
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

describe("requireTenantAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docGetMock.mockReset();
  });

  it("sem token, 401", async () => {
    const { requireTenantAccess } = await import("./tenant-auth");
    const r = await requireTenantAccess(requisicao());
    if (!(r instanceof NextResponse)) throw new Error("esperava NextResponse, veio TenantContext");
    expect(r.status).toBe(401);
  });

  it("token invalido, 401", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("token ruim"));
    const { requireTenantAccess } = await import("./tenant-auth");
    const r = await requireTenantAccess(requisicao("qualquer"));
    if (!(r instanceof NextResponse)) throw new Error("esperava NextResponse, veio TenantContext");
    expect(r.status).toBe(401);
  });

  it("sem ponteiro em memberships, 403 sem_tenant — nao inventa tenant nenhum", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "u1", email: "solto@fora.com" });
    docGetMock.mockResolvedValueOnce({ exists: false }); // memberships/{email}
    const { requireTenantAccess } = await import("./tenant-auth");
    const r = await requireTenantAccess(requisicao("tok"));
    if (!(r instanceof NextResponse)) throw new Error("esperava NextResponse, veio TenantContext");
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("sem_tenant");
  });

  it("ponteiro orfao (aponta pra um tenant onde a pessoa nao esta mais), 403 sem_tenant", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "u1", email: "ex-membro@empresa.com" });
    docGetMock
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: "tenant-antigo" }) }) // memberships
      .mockResolvedValueOnce({ exists: false }); // tenants/tenant-antigo/members/{email}
    const { requireTenantAccess } = await import("./tenant-auth");
    const r = await requireTenantAccess(requisicao("tok"));
    if (!(r instanceof NextResponse)) throw new Error("esperava NextResponse, veio TenantContext");
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("sem_tenant");
  });

  it("resolve owner com todas as capacidades", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "u1", email: "Dono@Empresa.com" });
    docGetMock
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: "tenant-1" }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ role: "owner", membershipVersion: 3 }) });
    const { requireTenantAccess } = await import("./tenant-auth");
    const ctx = await requireTenantAccess(requisicao("tok"));
    if (ctx instanceof Response) throw new Error("esperava TenantContext, veio erro");
    expect(ctx.tenantId).toBe("tenant-1");
    expect(ctx.email).toBe("dono@empresa.com"); // normalizado
    expect(ctx.papel).toBe("owner");
    expect(ctx.membershipVersion).toBe(3);
    expect(ctx.capabilities.has("tenant:administrar")).toBe(true);
  });

  it("resolve partner com so as permissoes granulares que o membro tem", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "u2", email: "colega@empresa.com" });
    docGetMock
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: "tenant-1" }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ role: "partner", permissoesEdicao: ["estoque"] }) });
    const { requireTenantAccess } = await import("./tenant-auth");
    const ctx = await requireTenantAccess(requisicao("tok"));
    if (ctx instanceof Response) throw new Error("esperava TenantContext, veio erro");
    expect(ctx.capabilities.has("dados:editar:estoque")).toBe(true);
    expect(ctx.capabilities.has("tenant:administrar")).toBe(false);
  });

  it("sem role gravado no documento, cai pro papel de menor poder (member) — nunca escala por omissao", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "u3", email: "sem-papel@empresa.com" });
    docGetMock
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: "tenant-1" }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({}) });
    const { requireTenantAccess } = await import("./tenant-auth");
    const ctx = await requireTenantAccess(requisicao("tok"));
    if (ctx instanceof Response) throw new Error("esperava TenantContext, veio erro");
    expect(ctx.papel).toBe("member");
    expect(ctx.capabilities.has("tenant:administrar")).toBe(false);
  });
});
