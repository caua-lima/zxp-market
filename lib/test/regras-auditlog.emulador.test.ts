import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

/**
 * Achado S20 da auditoria SaaS: `auditLog` só exigia `em is number` — um
 * cliente podia gravar qualquer timestamp, datando um evento pro passado ou
 * pro futuro. Testado contra o emulador REAL.
 *
 * O que ISTO cobre: quem (`por`) e quando (`em`) ficam presos à identidade
 * autenticada e ao relógio do servidor. O que NÃO cobre (documentado em
 * docs/saas/PROGRESSO.md): qual ação aconteceu e se ela foi de fato
 * registrada continuam vindo do cliente sem checkpoint no servidor — pede
 * Cloud Functions ou mover as escritas pra rotas de servidor.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const OUTRO = { uid: "uid-outro", email: "outro@zxp.com" };
const ctx = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-auditlog",
    firestore: {
      host,
      port: Number(porta),
      rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", OUTRO.email), { email: OUTRO.email, role: "owner" });
  });
});

const evento = (over: Record<string, unknown> = {}) => ({
  id: "e1", acao: "editar", entidade: "custo", entidadeId: "c1", entidadeLabel: "Aluguel",
  por: DONO.email, em: Date.now(), ...over,
});

describe("auditLog — quem e quando presos ao servidor (S20)", () => {
  it("um evento de verdade, com o proprio e-mail e o relogio de agora, e aceito", async () => {
    await assertSucceeds(setDoc(doc(ctx(DONO), "auditLog", "e1"), evento()));
  });

  it("nao assina em nome de outra pessoa", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "auditLog", "e1"), evento({ por: OUTRO.email })));
  });

  it("nao data o evento pro PASSADO (escondendo de quem so olha 'hoje')", async () => {
    const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await assertFails(setDoc(doc(ctx(DONO), "auditLog", "e1"), evento({ em: seteDiasAtras })));
  });

  it("nao data o evento pro FUTURO", async () => {
    const semanaQueVem = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await assertFails(setDoc(doc(ctx(DONO), "auditLog", "e1"), evento({ em: semanaQueVem })));
  });

  it("uma pequena diferenca de relogio (menos de 5 min) ainda passa — nao e sobre precisao de milissegundo", async () => {
    await assertSucceeds(setDoc(doc(ctx(DONO), "auditLog", "e1"), evento({ em: Date.now() - 60_000 })));
  });

  it("gravado, ninguem altera nem apaga — nem o proprio autor, nem o owner", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "auditLog", "e1"), evento());
    });
    await assertFails(updateDoc(doc(ctx(DONO), "auditLog", "e1"), { detalhe: "editado depois" }));
    await assertFails(deleteDoc(doc(ctx(DONO), "auditLog", "e1")));
  });
});
