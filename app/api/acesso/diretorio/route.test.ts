import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Achado S19 da auditoria SaaS: `controleAcesso` só é listável pelo owner
 * (firestore.rules), então `watchAccessList` (Firestore direto) nunca
 * funcionava pra um colaborador. Esta rota usa o Admin SDK e devolve só
 * e-mail e nome — o suficiente pro seletor de responsável em Tarefas, sem
 * afrouxar o `list` da coleção sensível (papel, permissão granular).
 */

vi.mock("@/lib/api-auth", () => ({ requireAccess: vi.fn() }));

const docsFalsos = [
  { id: "dono@exemplo.com", data: () => ({ email: "dono@exemplo.com", displayName: "Dona Maria", role: "owner" }) },
  { id: "colega@exemplo.com", data: () => ({ email: "colega@exemplo.com", displayName: undefined, role: "partner", permissoesEdicao: ["estoque"] }) },
];
const getMock = vi.fn(async () => ({ docs: docsFalsos }));
const orderByMock = vi.fn(() => ({ get: getMock }));
const collectionMock = vi.fn(() => ({ orderBy: orderByMock }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({ collection: collectionMock }) }));

describe("GET /api/acesso/diretorio (S19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exige acesso autenticado — repassa a recusa de requireAccess sem consultar o Firestore", async () => {
    const { requireAccess } = await import("@/lib/api-auth");
    const { NextResponse } = await import("next/server");
    const recusa = NextResponse.json({ error: "unauthorized" }, { status: 401 });
    vi.mocked(requireAccess).mockResolvedValue(recusa);

    const { GET } = await import("./route");
    const res = await GET(new Request("https://exemplo.com/api/acesso/diretorio"));
    expect(res.status).toBe(401);
    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("um COLABORADOR (nao-owner) autenticado recebe a lista — so email e nome, nada de papel/permissao", async () => {
    const { requireAccess } = await import("@/lib/api-auth");
    vi.mocked(requireAccess).mockResolvedValue({
      email: "colega@exemplo.com", uid: "u2", role: "user", papel: "partner", permissoesEdicao: [], pode: () => false,
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("https://exemplo.com/api/acesso/diretorio"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pessoas).toEqual([
      { email: "dono@exemplo.com", displayName: "Dona Maria" },
      { email: "colega@exemplo.com", displayName: null },
    ]);
    // Nenhum campo sensivel (role, permissoesEdicao) vaza pro colaborador.
    expect(JSON.stringify(body)).not.toContain("owner");
    expect(JSON.stringify(body)).not.toContain("permissoesEdicao");
  });
});
