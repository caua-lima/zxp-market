import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "saude-ml") ?? initializeApp({ projectId: "zxp-teste-saude" }, "saude-ml");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

const { registrarRespostaRuimDoML } = await import("./saude-ml");
const { getAdminDb } = await import("@/lib/firebase/admin");
const { diasAte } = await import("@/lib/domain/saude");
const db = getAdminDb();

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
});
afterAll(async () => { await db.terminate(); });

describe("Etapa 4 — contador de respostas ruins do ML", () => {
  it("soma por tipo no documento do dia, sem se atropelar em paralelo", async () => {
    await Promise.all([
      ...Array.from({ length: 5 }, () => registrarRespostaRuimDoML("429")),
      registrarRespostaRuimDoML("5xx"),
      registrarRespostaRuimDoML("timeout"),
    ]);
    const [hoje] = diasAte(Date.now(), 1);
    expect((await db.doc(`cron_estado/ml_saude_${hoje}`).get()).data()).toMatchObject({ s429: 5, s5xx: 1, timeouts: 1 });
  });
});
