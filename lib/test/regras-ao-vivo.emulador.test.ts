import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";

/**
 * O sinal das vendas ao vivo (`ao_vivo/sinal`) contra o emulador REAL com as
 * regras de firestore.rules — na raiz e dentro da empresa.
 *
 * Qualquer acesso lê (é o faturamento que o member já vê na barra); ninguém
 * escreve pelo navegador — quem escreve é o webhook, pelo Admin SDK. E uma
 * empresa não escuta o sinal da outra.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "d", email: "dono@a.com" };
const MEMBRO = { uid: "m", email: "membro@a.com" };
const DONO_B = { uid: "b", email: "dono@b.com" };
const ESTRANHO = { uid: "x", email: "x@fora.com" };

function ctx(p: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(p.uid, { email: p.email }).firestore() as unknown as Firestore;
}
const sinal = { seq: 1, orderId: "2000123", valida: true, valor: 189.9, unidades: 2, titulo: "Limão", dateCreated: "2026-10-23T14:30:00.000-03:00", em: 1 };

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-ao-vivo",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", MEMBRO.email), { email: MEMBRO.email, role: "member" });
    await setDoc(doc(db, "ao_vivo/sinal"), sinal);
    await setDoc(doc(db, "tenants/a"), { name: "A" });
    await setDoc(doc(db, "tenants/b"), { name: "B" });
    await setDoc(doc(db, "tenants/a/members", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "tenants/a/members", MEMBRO.email), { email: MEMBRO.email, role: "member" });
    await setDoc(doc(db, "tenants/b/members", DONO_B.email), { email: DONO_B.email, role: "owner" });
    await setDoc(doc(db, "tenants/a/ao_vivo/sinal"), sinal);
  });
});

describe("ao_vivo — modo raiz", () => {
  it("dono e member leem; estranho não", async () => {
    await assertSucceeds(getDoc(doc(ctx(DONO), "ao_vivo/sinal")));
    await assertSucceeds(getDoc(doc(ctx(MEMBRO), "ao_vivo/sinal")));
    await assertFails(getDoc(doc(ctx(ESTRANHO), "ao_vivo/sinal")));
  });
  it("ninguém escreve pelo navegador, nem o dono", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "ao_vivo/sinal"), { ...sinal, valor: 1 }));
  });
});

describe("ao_vivo — dentro da empresa", () => {
  it("membros da empresa leem; a outra empresa não", async () => {
    await assertSucceeds(getDoc(doc(ctx(DONO), "tenants/a/ao_vivo/sinal")));
    await assertSucceeds(getDoc(doc(ctx(MEMBRO), "tenants/a/ao_vivo/sinal")));
    await assertFails(getDoc(doc(ctx(DONO_B), "tenants/a/ao_vivo/sinal")));
  });
  it("ninguém escreve pelo navegador", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "tenants/a/ao_vivo/sinal"), { ...sinal, valor: 1 }));
  });
});
