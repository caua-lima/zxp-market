import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Renovação do token do ML contra o emulador REAL do Firestore — S05 da
 * auditoria SaaS. `npm run test:emulador`.
 *
 * O ML é simulado com a regra que importa: o refresh token é de USO ÚNICO.
 * Trocar R0 devolve R1 e mata o R0; usar R0 de novo dá `invalid_grant`.
 */

const estado = vi.hoisted(() => ({
  chamadas: 0,
  validos: new Set<string>(),
  proximo: 1,
  /** Roda no meio da "chamada ao ML" — simula outro processo mexendo no documento. */
  durante: null as null | (() => Promise<void>),
  atrasoMs: 0,
}));

vi.mock("@/lib/ml/client", () => ({
  refreshAccessToken: vi.fn(async (refresh: string) => {
    estado.chamadas++;
    if (estado.atrasoMs) await new Promise((r) => setTimeout(r, estado.atrasoMs));
    if (estado.durante) await estado.durante();
    if (!estado.validos.has(refresh)) throw new Error("invalid_grant");
    estado.validos.delete(refresh);
    const n = estado.proximo++;
    estado.validos.add(`R${n}`);
    return { access_token: `T${n}`, refresh_token: `R${n}`, expires_in: 21600 };
  }),
}));

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "token-teste") ?? initializeApp({ projectId: "zxp-teste-token" }, "token-teste");
  const db = getFirestore(app);
  return { getAdminDb: () => db };
});

const { getMlAccessToken } = await import("./token");
const { getAdminDb } = await import("@/lib/firebase/admin");
const doc = () => getAdminDb().collection("ml_tokens").doc("main");

beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  estado.chamadas = 0;
  estado.validos = new Set(["R0"]);
  estado.proximo = 1;
  estado.durante = null;
  estado.atrasoMs = 0;
  // Token vencido, refresh R0 válido, geração 1, sem concessão.
  await doc().set({ access_token: "T0", refresh_token: "R0", expires_in: 21600, expiresAt: Date.now() - 1000, geracao: 1 });
});

afterAll(async () => { await getAdminDb().terminate(); });

describe("renovação do token (S05)", () => {
  it("8 requisições ao mesmo tempo com o token vencido: UMA chamada ao ML, e o documento termina com o token novo", async () => {
    estado.atrasoMs = 200;
    const tokens = await Promise.all(Array.from({ length: 8 }, () => getMlAccessToken()));
    expect(estado.chamadas).toBe(1);
    expect(tokens.every((t) => t === "T1")).toBe(true);
    const d = (await doc().get()).data()!;
    expect(d).toMatchObject({ access_token: "T1", refresh_token: "R1", refreshLeaseAte: null, refreshLeaseDono: null });
  });

  it("alguém gravou um token MAIS NOVO enquanto eu esperava o ML: não sobrescrevo com o meu", async () => {
    // Durante a minha chamada, outro processo grava R9/T9 (mais novo).
    estado.durante = async () => {
      estado.validos.add("R9");
      await doc().update({ access_token: "T9", refresh_token: "R9", expiresAt: Date.now() + 3_600_000 });
    };
    const token = await getMlAccessToken();
    const d = (await doc().get()).data()!;
    expect(d.refresh_token).toBe("R9"); // o mais novo ficou
    expect(d.access_token).toBe("T9");
    expect(token).toBe("T9"); // e é o que a requisição usa
  });

  it("perdi a concessão pra outro processo, mas o refresh ainda é o que usei: gravo o meu — e NÃO apago a concessão dele", async () => {
    estado.durante = async () => {
      // O outro processo tomou a concessão (a minha teria vencido), mas ainda não gravou nada.
      await doc().update({ refreshLeaseDono: "processo-B", refreshLeaseAte: Date.now() + 30_000 });
    };
    const token = await getMlAccessToken();
    const d = (await doc().get()).data()!;
    expect(token).toBe("T1");
    expect(d.refresh_token).toBe("R1"); // o meu é o único válido: R0 já foi consumido
    expect(d.refreshLeaseDono).toBe("processo-B"); // a concessão dele continua dele...
    expect(d.refreshLeaseAte).toBeGreaterThan(Date.now()); // ...e continua valendo (o código antigo zerava)
  });

  it("minha chamada falha: libero só a MINHA concessão, nunca a de outro", async () => {
    estado.validos = new Set(); // R0 já não vale: o ML vai recusar
    estado.durante = async () => {
      await doc().update({ refreshLeaseDono: "processo-B", refreshLeaseAte: Date.now() + 30_000 });
    };
    await expect(getMlAccessToken()).rejects.toThrow("invalid_grant");
    const d = (await doc().get()).data()!;
    expect(d.refreshLeaseDono).toBe("processo-B");
    expect(d.refreshLeaseAte).toBeGreaterThan(Date.now());
  });

  it("minha chamada falha e a concessão é minha: libero, pra próxima requisição tentar", async () => {
    estado.validos = new Set();
    await expect(getMlAccessToken()).rejects.toThrow("invalid_grant");
    const d = (await doc().get()).data()!;
    expect(d.refreshLeaseAte).toBeNull();
    expect(d.refreshLeaseDono).toBeNull();
  });

  it("conexão trocada durante a chamada (geração subiu): descarta o token da conta antiga", async () => {
    estado.durante = async () => {
      await doc().update({ geracao: 2, access_token: "TX", refresh_token: "RX", expiresAt: Date.now() + 3_600_000 });
    };
    const token = await getMlAccessToken();
    const d = (await doc().get()).data()!;
    expect(d.refresh_token).toBe("RX");
    expect(token).toBeNull();
  });
});
