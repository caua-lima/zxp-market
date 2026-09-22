import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant-auth", () => ({ requireTenantAccess: vi.fn() }));

describe("GET /api/tenant/whoami", () => {
  beforeEach(() => vi.clearAllMocks());

  it("repassa a recusa quando requireTenantAccess nega", async () => {
    const { requireTenantAccess } = await import("@/lib/tenant-auth");
    vi.mocked(requireTenantAccess).mockResolvedValue(NextResponse.json({ error: "sem_tenant" }, { status: 403 }));
    const { GET } = await import("./route");
    const res = await GET(new Request("https://exemplo.com/api/tenant/whoami"));
    expect(res.status).toBe(403);
  });

  it("devolve o contexto resolvido, com capabilities como array (nao Set — Set nao serializa em JSON)", async () => {
    const { requireTenantAccess } = await import("@/lib/tenant-auth");
    vi.mocked(requireTenantAccess).mockResolvedValue({
      uid: "u1", email: "dono@empresa.com", tenantId: "tenant-1", papel: "owner",
      membershipVersion: 1, capabilities: new Set(["tenant:administrar"]),
    });
    const { GET } = await import("./route");
    const res = await GET(new Request("https://exemplo.com/api/tenant/whoami"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("tenant-1");
    expect(body.capabilities).toEqual(["tenant:administrar"]);
  });
});
