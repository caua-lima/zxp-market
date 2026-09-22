import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Achado S02 da auditoria SaaS (P0): `getUserByEmail` buscava em TODO o
 * Firebase Auth do projeto, não só entre quem tem acesso a este app — um
 * owner podia resetar a senha de QUALQUER identidade do projeto. A trava:
 * o alvo já precisa estar em `controleAcesso`.
 */

vi.mock("@/lib/api-auth", () => ({ requireAccess: vi.fn() }));

const acessoDocMock = vi.fn();
const collectionMock = vi.fn(() => ({ doc: () => ({ get: acessoDocMock }) }));
const getUserByEmailMock = vi.fn();
const updateUserMock = vi.fn();
const createUserMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({ collection: collectionMock }),
  getAdminAuth: () => ({
    getUserByEmail: getUserByEmailMock,
    updateUser: updateUserMock,
    createUser: createUserMock,
  }),
}));

const requisicao = (body: unknown) => new Request("https://exemplo.com/api/admin/create-user", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /api/admin/create-user (S02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function autenticarComoOwner() {
    const { requireAccess } = await import("@/lib/api-auth");
    vi.mocked(requireAccess).mockResolvedValue({
      email: "dono@zxp.com", uid: "u1", role: "owner", papel: "owner", permissoesEdicao: [], pode: () => true,
    });
  }

  it("recusa resetar a senha de um e-mail que NUNCA foi convidado (nao esta em controleAcesso)", async () => {
    await autenticarComoOwner();
    acessoDocMock.mockResolvedValue({ exists: false });

    const { POST } = await import("./route");
    const res = await POST(requisicao({ email: "estranho@outraempresa.com", password: "segredo123" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("nao_convidado");
    // Nunca chega a tocar o Firebase Auth pro e-mail nao autorizado.
    expect(getUserByEmailMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("permite definir senha pra quem JA foi convidado (esta em controleAcesso) — fluxo legitimo intacto", async () => {
    await autenticarComoOwner();
    acessoDocMock.mockResolvedValue({ exists: true });
    getUserByEmailMock.mockRejectedValue(new Error("user-not-found"));
    createUserMock.mockResolvedValue({ uid: "novo-uid" });

    const { POST } = await import("./route");
    const res = await POST(requisicao({ email: "colega@zxp.com", password: "segredo123" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, created: true });
    expect(createUserMock).toHaveBeenCalledWith({ email: "colega@zxp.com", password: "segredo123", emailVerified: true });
  });

  it("atualiza a senha de quem ja tem login E ja foi convidado", async () => {
    await autenticarComoOwner();
    acessoDocMock.mockResolvedValue({ exists: true });
    getUserByEmailMock.mockResolvedValue({ uid: "uid-existente" });

    const { POST } = await import("./route");
    const res = await POST(requisicao({ email: "colega@zxp.com", password: "novasenha1" }));

    expect(res.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith("uid-existente", { password: "novasenha1" });
  });
});
