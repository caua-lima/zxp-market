import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S24 — cadastro self-service da empresa contra o emulador REAL. A identidade
 * (token) é simulada; o que se prova é o que a rota grava e recusa.
 */

const quem = vi.hoisted(() => ({ email: "ana@nova.com", uid: "u-ana", emailVerificado: true }));

vi.mock("@/lib/api-auth", () => ({ lerIdentidade: vi.fn(async () => ({ ...quem })) }));
vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "cadastro-teste") ?? initializeApp({ projectId: "zxp-teste-cadastro" }, "cadastro-teste");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

const { POST } = await import("./route");
const { getAdminDb } = await import("@/lib/firebase/admin");
const { TERMOS_VERSAO } = await import("@/lib/domain/cadastro");
const db = getAdminDb();

const req = (corpo: unknown) => new Request("http://x/api/empresa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
const valido = { nome: "Loja da Ana", termos: TERMOS_VERSAO };

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
});
afterAll(async () => { await db.terminate(); });
beforeEach(async () => {
  process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
  process.env.ZXP_CADASTRO_ABERTO = "1";
  Object.assign(quem, { email: "ana@nova.com", uid: "u-ana", emailVerificado: true });
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
});

describe("S24 — criar a própria empresa", () => {
  it("cria a empresa com a pessoa como DONA, em teste grátis, com o aceite dos termos registrado", async () => {
    const r = await POST(req(valido));
    expect(r.status).toBe(200);
    const { tenantId } = (await r.json()) as { tenantId: string };
    expect(tenantId).toMatch(/^loja-da-ana-[a-f0-9]{8}$/);
    const empresa = (await db.doc(`tenants/${tenantId}`).get()).data()!;
    expect(empresa).toMatchObject({ name: "Loja da Ana", dono: "ana@nova.com", siteId: "MLB", moeda: "BRL", fuso: "America/Sao_Paulo" });
    expect(empresa.assinatura).toMatchObject({ plano: "trial", estado: "trial" });
    expect(empresa.termos).toMatchObject({ versao: TERMOS_VERSAO, por: "ana@nova.com" });
    expect((await db.doc(`tenants/${tenantId}/members/ana@nova.com`).get()).data()).toMatchObject({ role: "owner" });
    expect((await db.doc("memberships/ana@nova.com").get()).data()).toMatchObject({ tenantId });
  });

  it("uma pessoa, uma empresa: a segunda tentativa (ou a outra aba) é recusada e não cria nada", async () => {
    const [a, b] = await Promise.all([POST(req(valido)), POST(req({ ...valido, nome: "Outra da Ana" }))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await db.collection("tenants").listDocuments()).length).toBe(1);
  });

  it("e-mail não confirmado, termos não aceitos, cadastro fechado: recusa sem gravar", async () => {
    quem.emailVerificado = false;
    expect((await POST(req(valido))).status).toBe(400);
    quem.emailVerificado = true;
    expect((await POST(req({ nome: "Loja da Ana" }))).status).toBe(400);
    process.env.ZXP_CADASTRO_ABERTO = "0";
    expect((await POST(req(valido))).status).toBe(403);
    expect((await db.collection("tenants").listDocuments()).length).toBe(0);
    expect((await db.doc("memberships/ana@nova.com").get()).exists).toBe(false);
  });

  it("quem já é de uma empresa (convidado) não cria outra", async () => {
    await db.doc("memberships/ana@nova.com").set({ email: "ana@nova.com", tenantId: "empresa-x" });
    const r = await POST(req(valido));
    expect(r.status).toBe(409);
    expect((await db.collection("tenants").listDocuments()).length).toBe(0);
  });
});
