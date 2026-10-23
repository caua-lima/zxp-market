import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * A rota que fixa o mini painel ao vivo no aparelho, contra o emulador REAL do
 * Firestore. A sessão é simulada (requireAccess); o resto é de verdade.
 */

const sessao = vi.hoisted(() => ({ atual: null as null | { email: string; tenantId: string | null } }));
vi.mock("@/lib/api-auth", () => ({
  requireAccess: vi.fn(async () => sessao.atual
    ? { ...sessao.atual, uid: "u", role: "owner", papel: "owner", permissoesEdicao: [], pode: () => true }
    : NextResponse.json({ error: "unauthorized" }, { status: 401 })),
}));

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "painel-fixo-teste") ?? initializeApp({ projectId: "zxp-teste-painel-fixo" }, "painel-fixo-teste");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

const { getAdminDb } = await import("@/lib/firebase/admin");
const { POST } = await import("./route");
const db = getAdminDb();

const pedir = (corpo: unknown) => POST(new Request("http://x/api/push/painel-fixo", { method: "POST", body: JSON.stringify(corpo) }));
const DEVICE = "aparelho-123";

beforeEach(async () => {
  const s = await db.collection("pushTokens").get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
  await db.doc(`pushTokens/dono@a.com__${DEVICE}`).set({ email: "dono@a.com", token: "tok", deviceId: DEVICE, updatedAt: 1 });
  sessao.atual = { email: "Dono@A.com", tenantId: null };
});

describe("POST /api/push/painel-fixo", () => {
  it("liga e desliga no registro DESTE aparelho, com a empresa", async () => {
    let r = await pedir({ deviceId: DEVICE, ligado: true });
    expect(r.status).toBe(200);
    let d = (await db.doc(`pushTokens/dono@a.com__${DEVICE}`).get()).data()!;
    expect(d.painelFixoEmpresa).toBe("raiz");
    expect(d.token).toBe("tok"); // o resto do registro fica

    sessao.atual = { email: "dono@a.com", tenantId: "t-a" };
    await pedir({ deviceId: DEVICE, ligado: true });
    expect((await db.doc(`pushTokens/dono@a.com__${DEVICE}`).get()).get("painelFixoEmpresa")).toBe("t-a");

    r = await pedir({ deviceId: DEVICE, ligado: false });
    expect(await r.json()).toEqual({ ok: true, ligado: false });
    d = (await db.doc(`pushTokens/dono@a.com__${DEVICE}`).get()).data()!;
    expect(d.painelFixoEmpresa).toBeUndefined();
    expect(d.painelFixoEm).toBeUndefined();
  });

  it("aparelho sem push ativo: ligar pede pra ativar; desligar é ok", async () => {
    expect((await pedir({ deviceId: "outro-aparelho-9", ligado: true })).status).toBe(409);
    expect((await pedir({ deviceId: "outro-aparelho-9", ligado: false })).status).toBe(200);
  });

  it("não mexe no aparelho de outra pessoa", async () => {
    sessao.atual = { email: "intruso@a.com", tenantId: null };
    expect((await pedir({ deviceId: DEVICE, ligado: true })).status).toBe(409);
    expect((await db.doc(`pushTokens/dono@a.com__${DEVICE}`).get()).get("painelFixoEmpresa")).toBeUndefined();
  });

  it("deviceId torto ou sem sessão: recusa", async () => {
    expect((await pedir({ deviceId: "../x", ligado: true })).status).toBe(400);
    sessao.atual = null;
    expect((await pedir({ deviceId: DEVICE, ligado: true })).status).toBe(401);
  });
});
