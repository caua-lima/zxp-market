import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, type Firestore } from "firebase/firestore";

/**
 * Envios agendados pro Full (`full_envios_agendados`) contra o emulador REAL
 * com as regras de firestore.rules — na raiz e dentro da empresa.
 *
 * Quem EDITA ESTOQUE agenda: o dono não é o único que dá entrada na mercadoria.
 * Quem só enxerga a operação lê; o member (só resultado) não vê nem o plano.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "d", email: "dono@a.com" };
const PARCEIRO_ESTOQUE = { uid: "pe", email: "estoque@a.com" };
const PARCEIRO_ADS = { uid: "pd", email: "ads@a.com" };
const MEMBRO = { uid: "m", email: "membro@a.com" };
const DONO_B = { uid: "b", email: "dono@b.com" };

function ctx(p: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(p.uid, { email: p.email }).firestore() as unknown as Firestore;
}
const envio = (id: string) => ({
  id, productId: "limao", quantidade: 199, data: "2026-10-21", criadoEm: "2026-10-15", status: "agendado",
});

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-envios-agendados",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    // modo raiz
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", PARCEIRO_ESTOQUE.email), { email: PARCEIRO_ESTOQUE.email, role: "user", permissoesEdicao: ["estoque"] });
    await setDoc(doc(db, "controleAcesso", PARCEIRO_ADS.email), { email: PARCEIRO_ADS.email, role: "user", permissoesEdicao: ["ads"] });
    await setDoc(doc(db, "controleAcesso", MEMBRO.email), { email: MEMBRO.email, role: "member" });
    await setDoc(doc(db, "full_envios_agendados/e0"), envio("e0"));
    // modo empresa
    await setDoc(doc(db, "tenants/a"), { name: "A" });
    await setDoc(doc(db, "tenants/b"), { name: "B" });
    await setDoc(doc(db, "tenants/a/members", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "tenants/a/members", PARCEIRO_ESTOQUE.email), { email: PARCEIRO_ESTOQUE.email, role: "partner", permissoesEdicao: ["estoque"] });
    await setDoc(doc(db, "tenants/a/members", PARCEIRO_ADS.email), { email: PARCEIRO_ADS.email, role: "partner", permissoesEdicao: ["ads"] });
    await setDoc(doc(db, "tenants/a/members", MEMBRO.email), { email: MEMBRO.email, role: "member" });
    await setDoc(doc(db, "tenants/b/members", DONO_B.email), { email: DONO_B.email, role: "owner" });
    await setDoc(doc(db, "tenants/a/full_envios_agendados/e0"), envio("e0"));
  });
});

describe("raiz: quem agenda e quem só lê", () => {
  it("o dono e quem edita estoque criam e mudam o status", async () => {
    await assertSucceeds(setDoc(doc(ctx(DONO), "full_envios_agendados/e1"), envio("e1")));
    await assertSucceeds(setDoc(doc(ctx(PARCEIRO_ESTOQUE), "full_envios_agendados/e2"), envio("e2")));
    await assertSucceeds(updateDoc(doc(ctx(PARCEIRO_ESTOQUE), "full_envios_agendados/e0"), { status: "cancelado" }));
  });
  it("quem edita só Ads lê, mas não agenda", async () => {
    await assertSucceeds(getDoc(doc(ctx(PARCEIRO_ADS), "full_envios_agendados/e0")));
    await assertFails(setDoc(doc(ctx(PARCEIRO_ADS), "full_envios_agendados/e3"), envio("e3")));
    await assertFails(updateDoc(doc(ctx(PARCEIRO_ADS), "full_envios_agendados/e0"), { status: "cancelado" }));
  });
  it("o member (só resultado) não vê nem escreve", async () => {
    await assertFails(getDoc(doc(ctx(MEMBRO), "full_envios_agendados/e0")));
    await assertFails(setDoc(doc(ctx(MEMBRO), "full_envios_agendados/e4"), envio("e4")));
  });
});

describe("empresa: o plano de uma empresa não vaza pra outra", () => {
  it("quem edita estoque na empresa agenda nela", async () => {
    await assertSucceeds(setDoc(doc(ctx(PARCEIRO_ESTOQUE), "tenants/a/full_envios_agendados/e1"), envio("e1")));
    await assertFails(setDoc(doc(ctx(PARCEIRO_ADS), "tenants/a/full_envios_agendados/e2"), envio("e2")));
    await assertFails(getDoc(doc(ctx(MEMBRO), "tenants/a/full_envios_agendados/e0")));
  });
  it("o dono da empresa B não lê nem escreve no plano da empresa A", async () => {
    await assertFails(getDoc(doc(ctx(DONO_B), "tenants/a/full_envios_agendados/e0")));
    await assertFails(setDoc(doc(ctx(DONO_B), "tenants/a/full_envios_agendados/e5"), envio("e5")));
  });
});
