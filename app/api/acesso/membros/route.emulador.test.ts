import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O time da empresa (segundo cliente) contra o emulador REAL do Firestore. O
 * gate de autenticação é simulado (quem chama, de qual empresa, com qual
 * papel); o que se prova é o que a rota grava e recusa.
 */

const quem = vi.hoisted(() => ({ email: "dono@a.com", tenantId: "empresa-a", papel: "owner" as string }));

vi.mock("@/lib/api-auth", () => ({
  requireAccess: vi.fn(async (_req: Request, opts?: { capacidade?: string }) => {
    const pode = (c: string) => quem.papel === "owner" || c !== "administrar";
    if (opts?.capacidade && !pode(opts.capacidade)) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return { email: quem.email, tenantId: quem.tenantId, papel: quem.papel, pode };
  }),
}));

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "membros-teste") ?? initializeApp({ projectId: "zxp-teste-membros" }, "membros-teste");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

const { POST, PATCH, DELETE } = await import("./route");
const { getAdminDb } = await import("@/lib/firebase/admin");
const db = getAdminDb();

const req = (metodo: string, corpo?: unknown, qs = "") =>
  new Request(`http://x/api/acesso/membros${qs}`, {
    method: metodo,
    ...(corpo ? { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) } : {}),
  });

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
});
afterAll(async () => { await db.terminate(); });
beforeEach(async () => {
  process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
  Object.assign(quem, { email: "dono@a.com", tenantId: "empresa-a", papel: "owner" });
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
  await db.doc("tenants/empresa-a/members/dono@a.com").set({ email: "dono@a.com", role: "owner" });
  await db.doc("memberships/dono@a.com").set({ email: "dono@a.com", tenantId: "empresa-a" });
  await db.doc("memberships/de-b@b.com").set({ email: "de-b@b.com", tenantId: "empresa-b" });
});

describe("o time da empresa (segundo cliente)", () => {
  it("o dono convida: o membro entra NA EMPRESA DELE, com o ponteiro — e não em controleAcesso", async () => {
    const r = await POST(req("POST", { email: "Novo@A.com", role: "colaborador", permissoesEdicao: ["estoque"] }));
    expect(r.status).toBe(200);
    expect((await db.doc("tenants/empresa-a/members/novo@a.com").get()).data()).toMatchObject({ role: "partner", permissoesEdicao: ["estoque"] });
    expect((await db.doc("memberships/novo@a.com").get()).data()).toMatchObject({ tenantId: "empresa-a" });
    expect((await db.collection("controleAcesso").listDocuments()).length).toBe(0);
  });

  it("pessoa de OUTRA empresa é recusada — uma pessoa, uma empresa", async () => {
    const r = await POST(req("POST", { email: "de-b@b.com", role: "partner" }));
    expect(r.status).toBe(409);
    expect((await db.doc("tenants/empresa-a/members/de-b@b.com").get()).exists).toBe(false);
  });

  it("ninguém vira dono por aqui — a empresa tem um só", async () => {
    expect((await POST(req("POST", { email: "x@a.com", role: "owner" }))).status).toBe(400);
  });

  it("quem não é dono não convida nem remove", async () => {
    Object.assign(quem, { email: "p@a.com", papel: "partner" });
    expect((await POST(req("POST", { email: "y@a.com", role: "partner" }))).status).toBe(403);
    expect((await DELETE(req("DELETE", undefined, "?email=dono@a.com"))).status).toBe(403);
  });

  it("remover tira o membro e o ponteiro — e o dono não se remove", async () => {
    await POST(req("POST", { email: "sai@a.com", role: "member" }));
    expect((await DELETE(req("DELETE", undefined, "?email=sai@a.com"))).status).toBe(200);
    expect((await db.doc("tenants/empresa-a/members/sai@a.com").get()).exists).toBe(false);
    expect((await db.doc("memberships/sai@a.com").get()).exists).toBe(false);
    expect((await DELETE(req("DELETE", undefined, "?email=dono@a.com"))).status).toBe(400);
  });

  it("não solta o ponteiro de quem é de outra empresa", async () => {
    await DELETE(req("DELETE", undefined, "?email=de-b@b.com"));
    expect((await db.doc("memberships/de-b@b.com").get()).data()?.tenantId).toBe("empresa-b");
  });

  it("o próprio membro troca só o próprio nome e foto; papel é do dono", async () => {
    await POST(req("POST", { email: "m@a.com", role: "member" }));
    Object.assign(quem, { email: "m@a.com", papel: "member" });
    expect((await PATCH(req("PATCH", { email: "m@a.com", patch: { displayName: "Maria" } }))).status).toBe(200);
    expect((await PATCH(req("PATCH", { email: "m@a.com", patch: { role: "partner" } }))).status).toBe(403);
    expect((await db.doc("tenants/empresa-a/members/m@a.com").get()).data()).toMatchObject({ displayName: "Maria", role: "member" });
  });

  it("no modo raiz a rota não faz nada (o acesso vai por controleAcesso)", async () => {
    process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "raiz";
    expect((await POST(req("POST", { email: "z@a.com", role: "partner" }))).status).toBe(400);
  });
});
