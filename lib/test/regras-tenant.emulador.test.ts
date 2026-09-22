import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

/**
 * A fundação do S01 — contra o emulador REAL, não por leitura de regra.
 *
 * O que precisa ficar provado ANTES de qualquer rota/UI depender disto:
 * membro do tenant A nunca lê nem escreve nada do tenant B, e ninguém — nem
 * o próprio owner de um tenant — cria/edita o documento do tenant ou de um
 * membro diretamente pelo cliente (isso é convite/onboarding, passa pelo
 * servidor). É a mesma pergunta que `regras-notificacoes.emulador.test.ts`
 * já faz pras coleções legadas, aplicada ao modelo novo.
 */

let env: RulesTestEnvironment;

const DONO_A = { uid: "uid-dono-a", email: "dono-a@empresa-a.com" };
const MEMBRO_A = { uid: "uid-membro-a", email: "membro-a@empresa-a.com" };
const DONO_B = { uid: "uid-dono-b", email: "dono-b@empresa-b.com" };
const FORA = { uid: "uid-fora", email: "ninguem@fora.com" };

const ctx = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-tenant",
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
    await setDoc(doc(db, "tenants", "tenant-a"), { name: "Empresa A" });
    await setDoc(doc(db, "tenants", "tenant-a", "members", DONO_A.email), { email: DONO_A.email, role: "owner" });
    await setDoc(doc(db, "tenants", "tenant-a", "members", MEMBRO_A.email), { email: MEMBRO_A.email, role: "partner" });
    await setDoc(doc(db, "tenants", "tenant-b"), { name: "Empresa B" });
    await setDoc(doc(db, "tenants", "tenant-b", "members", DONO_B.email), { email: DONO_B.email, role: "owner" });
  });
});

describe("isolamento entre tenants (S01)", () => {
  it("membro do tenant A le o proprio tenant e o proprio registro de membro", async () => {
    await assertSucceeds(getDoc(doc(ctx(MEMBRO_A), "tenants", "tenant-a")));
    await assertSucceeds(getDoc(doc(ctx(MEMBRO_A), "tenants", "tenant-a", "members", MEMBRO_A.email)));
  });

  it("membro do tenant A NUNCA le nada do tenant B", async () => {
    await assertFails(getDoc(doc(ctx(MEMBRO_A), "tenants", "tenant-b")));
    await assertFails(getDoc(doc(ctx(MEMBRO_A), "tenants", "tenant-b", "members", DONO_B.email)));
  });

  it("dono do tenant B nao le nada do tenant A, mesmo sendo owner (do PROPRIO tenant)", async () => {
    await assertFails(getDoc(doc(ctx(DONO_B), "tenants", "tenant-a")));
    await assertFails(getDoc(doc(ctx(DONO_B), "tenants", "tenant-a", "members", DONO_A.email)));
  });

  it("quem nao tem NENHUM tenant nao le tenant nenhum", async () => {
    await assertFails(getDoc(doc(ctx(FORA), "tenants", "tenant-a")));
    await assertFails(getDoc(doc(ctx(FORA), "tenants", "tenant-b")));
  });

  it("membro comum (partner) do tenant A NAO le o registro de OUTRO membro — so o owner administra o time", async () => {
    await assertFails(getDoc(doc(ctx(MEMBRO_A), "tenants", "tenant-a", "members", DONO_A.email)));
  });

  it("o owner do tenant LE o registro de qualquer membro do PROPRIO tenant", async () => {
    await assertSucceeds(getDoc(doc(ctx(DONO_A), "tenants", "tenant-a", "members", MEMBRO_A.email)));
  });

  it("ninguem escreve tenant ou membro pelo cliente — convite/onboarding passa pelo servidor", async () => {
    await assertFails(setDoc(doc(ctx(DONO_A), "tenants", "tenant-a"), { name: "Nome forjado" }));
    await assertFails(setDoc(doc(ctx(DONO_A), "tenants", "tenant-a", "members", "novo@empresa-a.com"), { email: "novo@empresa-a.com", role: "owner" }));
    // Nem o proprio dono se auto-promove reescrevendo o proprio registro.
    await assertFails(setDoc(doc(ctx(DONO_A), "tenants", "tenant-a", "members", DONO_A.email), { email: DONO_A.email, role: "owner", extra: true }));
  });

  it("memberships (o ponteiro reverso email->tenant) nunca e legivel nem gravavel pelo cliente", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "memberships", DONO_A.email), { tenantId: "tenant-a" });
    });
    await assertFails(getDoc(doc(ctx(DONO_A), "memberships", DONO_A.email)));
    await assertFails(setDoc(doc(ctx(DONO_A), "memberships", DONO_A.email), { tenantId: "tenant-a" }));
  });
});
