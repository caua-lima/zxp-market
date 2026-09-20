import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { desvincular, vincularToken } from "./push-registro-store";
import { idDoRegistro } from "./domain/push-registro";

/**
 * O registro de push contra o emulador do Firestore (`npm run test:emulador`).
 *
 * A transação de `vincularToken` é o que garante "um token pertence a UMA
 * pessoa" mesmo com duas abas (ou duas contas) vinculando ao mesmo tempo. Isso
 * só se prova com escritas concorrentes de verdade, não com um mock.
 */

let db: Firestore;

const TOKEN_A = "token-do-aparelho-A-" + "a".repeat(40);
const TOKEN_B = "token-do-aparelho-B-" + "b".repeat(40);
const DEV_1 = "dev-11111111";
const DEV_2 = "dev-22222222";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "push-registro-teste") ?? initializeApp({ projectId: "zxp-teste-registro" }, "push-registro-teste");
  db = getFirestore(app);
});

beforeEach(async () => {
  const snap = await db.collection("pushTokens").get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

afterAll(async () => { await db?.terminate(); });

async function todos(): Promise<{ id: string; token?: string; email?: string; deviceId?: string; userAgent?: string }[]> {
  return (await db.collection("pushTokens").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}

describe("vincularToken", () => {
  it("cria o registro (pessoa, instalação)", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "Chrome");
    const docs = await todos();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: idDoRegistro("a@zxp.com", DEV_1), email: "a@zxp.com", token: TOKEN_A, deviceId: DEV_1, userAgent: "Chrome" });
  });

  it("A → B no mesmo navegador: o registro de A sai, o de B nasce", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    const r = await vincularToken(db, "b@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    expect(r.removidos).toBe(1);
    const docs = await todos();
    expect(docs.map((d) => d.id)).toEqual([idDoRegistro("b@zxp.com", DEV_1)]);
  });

  it("token rotacionado: o mesmo registro é sobrescrito, sem acumular", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    await vincularToken(db, "a@zxp.com", { token: TOKEN_B, deviceId: DEV_1 }, "");
    const docs = await todos();
    expect(docs).toHaveLength(1);
    expect(docs[0].token).toBe(TOKEN_B);
  });

  it("dois aparelhos da mesma pessoa convivem", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    await vincularToken(db, "a@zxp.com", { token: TOKEN_B, deviceId: DEV_2 }, "");
    expect(await todos()).toHaveLength(2);
  });

  it("registro legado (id = o token) do mesmo aparelho é substituído", async () => {
    await db.collection("pushTokens").doc(TOKEN_A).set({ email: "a@zxp.com", token: TOKEN_A, updatedAt: 1 });
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    expect((await todos()).map((d) => d.id)).toEqual([idDoRegistro("a@zxp.com", DEV_1)]);
  });

  it("o legado de OUTRO aparelho da mesma pessoa é preservado", async () => {
    await db.collection("pushTokens").doc(TOKEN_B).set({ email: "a@zxp.com", token: TOKEN_B, updatedAt: 1 });
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    expect(await todos()).toHaveLength(2);
  });

  it("teto por pessoa: a 11ª instalação derruba a mais antiga", async () => {
    for (let i = 0; i < 10; i++) {
      await vincularToken(db, "a@zxp.com", { token: `token-${i}-` + "k".repeat(30), deviceId: `dev-${String(i).padStart(8, "0")}` }, "", 1000 + i);
    }
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_2 }, "", 5000);
    const ids = (await todos()).map((d) => d.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(idDoRegistro("a@zxp.com", "dev-00000000"));
    expect(ids).toContain(idDoRegistro("a@zxp.com", DEV_2));
  });

  it("CONCORRÊNCIA: duas contas vinculando o MESMO token ao mesmo tempo — sobra uma dona", async () => {
    // Repetido: condição de corrida não aparece em uma rodada só.
    for (let rodada = 0; rodada < 5; rodada++) {
      await Promise.all([
        vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, ""),
        vincularToken(db, "b@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, ""),
        vincularToken(db, "c@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, ""),
      ]);
      const comEsseToken = (await todos()).filter((d) => d.token === TOKEN_A);
      expect(comEsseToken, `rodada ${rodada}`).toHaveLength(1);
      await Promise.all((await db.collection("pushTokens").get()).docs.map((d) => d.ref.delete()));
    }
  });

  it("CONCORRÊNCIA: 20 vínculos simultâneos da mesma instalação não duplicam", async () => {
    await Promise.all(Array.from({ length: 20 }, () => vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "")));
    expect(await todos()).toHaveLength(1);
  });
});

describe("desvincular", () => {
  it("por instalação, com a pessoa autenticada", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    await vincularToken(db, "a@zxp.com", { token: TOKEN_B, deviceId: DEV_2 }, "");
    const r = await desvincular(db, { email: "a@zxp.com", deviceId: DEV_1 });
    expect(r.removidos).toBe(1);
    expect((await todos()).map((d) => d.token)).toEqual([TOKEN_B]);
  });

  it("por posse do token, sem sessão — o caso da saída offline", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    const r = await desvincular(db, { token: TOKEN_A });
    expect(r.removidos).toBe(1);
    expect(await todos()).toHaveLength(0);
  });

  it("um e-mail com o deviceId de outra pessoa não apaga o dela", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    const r = await desvincular(db, { email: "b@zxp.com", deviceId: DEV_1 });
    expect(r.removidos).toBe(0);
    expect(await todos()).toHaveLength(1);
  });

  it("token desconhecido: nada sai e nada quebra", async () => {
    await vincularToken(db, "a@zxp.com", { token: TOKEN_A, deviceId: DEV_1 }, "");
    expect((await desvincular(db, { token: TOKEN_B })).removidos).toBe(0);
    expect(await todos()).toHaveLength(1);
  });
});
