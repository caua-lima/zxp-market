import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Etapa 6 — transferência de propriedade e acesso com prazo, contra o emulador REAL. */

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
  const app = getApps().find((a) => a.name === "dono-teste") ?? initializeApp({ projectId: "zxp-teste-dono" }, "dono-teste");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

const { POST: transferir } = await import("./route");
const { POST: adicionar } = await import("../membros/route");
const { getAdminDb } = await import("@/lib/firebase/admin");
const db = getAdminDb();
const req = (url: string, corpo: unknown) => new Request(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

beforeAll(() => { if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador"); });
afterAll(async () => { await db.terminate(); });
beforeEach(async () => {
  process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
  Object.assign(quem, { email: "dono@a.com", tenantId: "empresa-a", papel: "owner" });
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
  await db.doc("tenants/empresa-a").set({ name: "A", dono: "dono@a.com" });
  await db.doc("tenants/empresa-a/members/dono@a.com").set({ email: "dono@a.com", role: "owner" });
  await db.doc("tenants/empresa-a/members/socia@a.com").set({ email: "socia@a.com", role: "partner", permissoesEdicao: ["custos"] });
  await db.doc("memberships/dono@a.com").set({ tenantId: "empresa-a" });
  await db.doc("memberships/socia@a.com").set({ tenantId: "empresa-a" });
});

describe("Etapa 6 — transferir a propriedade", () => {
  it("a sócia vira dona; quem transferiu vira parceiro com edição em tudo; fica no histórico", async () => {
    expect((await transferir(req("/api/acesso/dono", { email: "socia@a.com" }))).status).toBe(200);
    expect((await db.doc("tenants/empresa-a/members/socia@a.com").get()).data()).toMatchObject({ role: "owner" });
    expect((await db.doc("tenants/empresa-a/members/socia@a.com").get()).data()?.permissoesEdicao).toBeUndefined();
    expect((await db.doc("tenants/empresa-a/members/dono@a.com").get()).data()).toMatchObject({ role: "partner", permissoesEdicao: ["custos", "metas", "estoque", "ads"] });
    expect((await db.doc("tenants/empresa-a").get()).data()?.dono).toBe("socia@a.com");
    const log = await db.collection("tenants/empresa-a/auditLog").get();
    expect(log.docs.map((d) => d.data().detalhe)).toEqual(["propriedade transferida de dono@a.com para socia@a.com"]);
  });

  it("recusa: quem não é dono, pra si mesmo, pra quem não está no time, pra acesso com prazo", async () => {
    expect((await transferir(req("/api/acesso/dono", { email: "dono@a.com" }))).status).toBe(400);
    expect((await transferir(req("/api/acesso/dono", { email: "fora@x.com" }))).status).toBe(400);
    await db.doc("tenants/empresa-a/members/suporte@z.com").set({ email: "suporte@z.com", role: "member", expiraEm: Date.now() + 86_400_000 });
    expect((await transferir(req("/api/acesso/dono", { email: "suporte@z.com" }))).status).toBe(400);
    Object.assign(quem, { email: "socia@a.com", papel: "partner" });
    expect((await transferir(req("/api/acesso/dono", { email: "socia@a.com" }))).status).toBe(403);
    expect((await db.doc("tenants/empresa-a/members/dono@a.com").get()).data()?.role).toBe("owner");
  });
});

describe("Etapa 6 — acesso com prazo (suporte)", () => {
  it("adicionar com 7 dias grava o vencimento; prazo inválido é recusado; sem prazo é permanente", async () => {
    const antes = Date.now();
    expect((await adicionar(req("/api/acesso/membros", { email: "suporte@z.com", role: "member", expiraEmDias: 7 }))).status).toBe(200);
    const e = (await db.doc("tenants/empresa-a/members/suporte@z.com").get()).data()?.expiraEm as number;
    expect(e).toBeGreaterThanOrEqual(antes + 7 * 86_400_000);
    expect((await adicionar(req("/api/acesso/membros", { email: "outro@z.com", role: "member", expiraEmDias: 90 }))).status).toBe(400);
    // Readicionar sem prazo torna permanente.
    expect((await adicionar(req("/api/acesso/membros", { email: "suporte@z.com", role: "member" }))).status).toBe(200);
    expect((await db.doc("tenants/empresa-a/members/suporte@z.com").get()).data()?.expiraEm).toBeUndefined();
  });
});
