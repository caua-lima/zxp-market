import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

/**
 * Regras de segurança das coleções de notificação, contra o emulador REAL do
 * Firestore (`npm run test:emulador`).
 *
 * Teste de regra que não roda a regra não prova nada: um `allow` a mais ou a
 * menos só aparece quando alguém de verdade tenta ler ou escrever. Aqui cada
 * papel tenta o que não devia conseguir — e o que devia.
 */

let env: RulesTestEnvironment;

const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const MEMBRO = { uid: "uid-membro", email: "membro@zxp.com" };
const SEM_ACESSO = { uid: "uid-fora", email: "fora@zxp.com" };

const ctx = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-regras",
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
    await setDoc(doc(db, "controleAcesso", MEMBRO.email), { email: MEMBRO.email, role: "member" });
    await setDoc(doc(db, "pushTokens", `${DONO.email}__dev-11111111`), { email: DONO.email, token: "t-dono", deviceId: "dev-11111111" });
    await setDoc(doc(db, "pushTokens", `${MEMBRO.email}__dev-22222222`), { email: MEMBRO.email, token: "t-membro", deviceId: "dev-22222222" });
    await setDoc(doc(db, "notification_events", "sale_paid:1"), {
      id: "sale_paid:1", type: "sale_negative_margin", severity: "danger", title: "t", body: "b",
      grossAmount: 79.9, estimatedProfit: -18.4, readBy: {}, dismissedBy: {},
    });
    await setDoc(doc(db, "notification_events_publico", "sale_paid:1"), {
      id: "sale_paid:1", type: "sale_paid", severity: "success", title: "Nova venda confirmada", body: "Menta", readBy: {}, dismissedBy: {},
    });
    await setDoc(doc(db, "usuarios", DONO.uid, "preferences", "notifications"), { showFinancialValuesInPush: false });
  });
});

describe("pushTokens — o registro é lido pela pessoa e escrito só pelo servidor", () => {
  const meu = `${DONO.email}__dev-11111111`;
  const doMembro = `${MEMBRO.email}__dev-22222222`;

  it("a pessoa lê o PRÓPRIO registro", async () => {
    await assertSucceeds(getDoc(doc(ctx(DONO), "pushTokens", meu)));
  });

  it("não lê o registro de outra pessoa", async () => {
    await assertFails(getDoc(doc(ctx(DONO), "pushTokens", doMembro)));
  });

  it("quem não tem acesso não lê nem o registro com o próprio e-mail", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "pushTokens", `${SEM_ACESSO.email}__dev-33333333`), { email: SEM_ACESSO.email, token: "t" });
    });
    await assertFails(getDoc(doc(ctx(SEM_ACESSO), "pushTokens", `${SEM_ACESSO.email}__dev-33333333`)));
  });

  it("o navegador NÃO cria registro — só a rota do servidor", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "pushTokens", `${DONO.email}__dev-99999999`), { email: DONO.email, token: "novo", deviceId: "dev-99999999" }));
  });

  it("o navegador NÃO altera o token de um registro existente", async () => {
    await assertFails(updateDoc(doc(ctx(DONO), "pushTokens", meu), { token: "outro" }));
  });

  it("nem forjar um registro em nome de outra pessoa", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "pushTokens", `${MEMBRO.email}__dev-77777777`), { email: MEMBRO.email, token: "forjado" }));
  });

  it("a pessoa apaga o PRÓPRIO registro", async () => {
    await assertSucceeds(deleteDoc(doc(ctx(DONO), "pushTokens", meu)));
  });

  it("não apaga o registro de outra pessoa", async () => {
    await assertFails(deleteDoc(doc(ctx(DONO), "pushTokens", doMembro)));
  });
});

describe("notification_events — o evento COMPLETO só pra quem vê financeiro", () => {
  const ref = (u: { uid: string; email: string }) => doc(ctx(u), "notification_events", "sale_paid:1");

  it("o dono lê", async () => { await assertSucceeds(getDoc(ref(DONO))); });
  it("o member NÃO lê — é onde estão lucro e margem", async () => { await assertFails(getDoc(ref(MEMBRO))); });
  it("sem acesso, não lê", async () => { await assertFails(getDoc(ref(SEM_ACESSO))); });

  it("ninguém cria pelo cliente", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "notification_events", "novo"), { title: "x" }));
  });

  it("cada um marca só o PRÓPRIO lido", async () => {
    await assertSucceeds(updateDoc(ref(DONO), { readBy: { [DONO.email]: 1 } }));
  });

  it("não marca lido em nome de outra pessoa", async () => {
    await assertFails(updateDoc(ref(DONO), { readBy: { [MEMBRO.email]: 1 } }));
  });

  it("não altera campo de negócio", async () => {
    await assertFails(updateDoc(ref(DONO), { title: "reescrito" }));
    await assertFails(updateDoc(ref(DONO), { grossAmount: 1 }));
  });
});

describe("notification_events_publico — o espelho sem dinheiro", () => {
  const ref = (u: { uid: string; email: string }) => doc(ctx(u), "notification_events_publico", "sale_paid:1");

  it("o member lê", async () => { await assertSucceeds(getDoc(ref(MEMBRO))); });
  it("sem acesso, não lê", async () => { await assertFails(getDoc(ref(SEM_ACESSO))); });
  it("ninguém cria pelo cliente", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "notification_events_publico", "novo"), { title: "x" }));
  });
  it("marca só o próprio lido", async () => {
    await assertSucceeds(updateDoc(ref(MEMBRO), { readBy: { [MEMBRO.email]: 1 } }));
    await assertFails(updateDoc(ref(MEMBRO), { readBy: { [DONO.email]: 1 } }));
  });
  it("não altera título", async () => {
    await assertFails(updateDoc(ref(MEMBRO), { title: "Venda de R$ 1,00" }));
  });
});

describe("preferências de notificação — cada um só alcança as próprias", () => {
  it("lê e grava a própria", async () => {
    const meu = doc(ctx(DONO), "usuarios", DONO.uid, "preferences", "notifications");
    await assertSucceeds(getDoc(meu));
    await assertSucceeds(setDoc(meu, { showFinancialValuesInPush: true }));
  });

  it("não lê nem grava a de outra pessoa", async () => {
    const dele = doc(ctx(MEMBRO), "usuarios", DONO.uid, "preferences", "notifications");
    await assertFails(getDoc(dele));
    await assertFails(setDoc(dele, { showFinancialValuesInPush: true }));
  });
});
