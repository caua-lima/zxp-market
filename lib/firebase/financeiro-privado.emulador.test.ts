import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from "firebase/firestore";

/**
 * Financeiro PRIVADO contra o emulador com as regras reais: só o owner lê e
 * grava. Nem o Sócio (que vê DRE e custos), nem o Partner, nem o Colaborador,
 * nem quem foi removido — por documento e por listagem.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const SOCIO = { uid: "uid-socio", email: "socio@zxp.com" };
const PARTNER = { uid: "uid-partner", email: "partner@zxp.com" };
const COLAB = { uid: "uid-colab", email: "colab@zxp.com" };
const REMOVIDO = { uid: "uid-rem", email: "removido@zxp.com" };

const ctx = (q: { uid: string; email: string }): Firestore =>
  env.authenticatedContext(q.uid, { email: q.email }).firestore() as unknown as Firestore;

const COLECOES = ["fin_contas", "fin_movimentos", "fin_obrigacoes", "fin_recorrencias"] as const;
const exemplo: Record<(typeof COLECOES)[number], Record<string, unknown>> = {
  fin_contas: { id: "c1", nome: "Mercado Pago", tipo: "mercado_pago", ativa: true },
  fin_movimentos: { id: "c1", contaId: "c1", centavos: -1250, natureza: "despesa", data: "2026-11-13", descricao: "x", categoria: "x", origem: "manual" },
  fin_obrigacoes: { id: "c1", descricao: "Contador", centavos: 50000, vencimento: "2026-11-10", baixas: [] },
  fin_recorrencias: { id: "c1", descricao: "Aluguel", centavos: 100000, diaVencimento: 5, desde: "2026-01" },
};

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-financeiro",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", SOCIO.email), { email: SOCIO.email, role: "partner", permissoesEdicao: ["custos", "metas", "estoque", "ads", "etiquetas"] });
    await setDoc(doc(db, "controleAcesso", PARTNER.email), { email: PARTNER.email, role: "member" });
    await setDoc(doc(db, "controleAcesso", COLAB.email), { email: COLAB.email, role: "equipe" });
    for (const c of COLECOES) await setDoc(doc(db, c, "c1"), exemplo[c]);
  });
});

describe("Financeiro privado — só o owner", () => {
  for (const c of COLECOES) {
    it(`${c}: owner lê, lista e grava`, async () => {
      await assertSucceeds(getDoc(doc(ctx(DONO), c, "c1")));
      await assertSucceeds(getDocs(collection(ctx(DONO), c)));
      await assertSucceeds(setDoc(doc(ctx(DONO), c, "c2"), { ...exemplo[c], id: "c2" }));
    });
    it(`${c}: Sócio (com tudo liberado), Partner, Colaborador e removido não leem nem gravam`, async () => {
      for (const q of [SOCIO, PARTNER, COLAB, REMOVIDO]) {
        await assertFails(getDoc(doc(ctx(q), c, "c1")));
        await assertFails(getDocs(collection(ctx(q), c)));
        await assertFails(setDoc(doc(ctx(q), c, "c3"), { ...exemplo[c], id: "c3" }));
      }
    });
  }
  it("sem sessão não lê", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore() as unknown as Firestore, "fin_movimentos", "c1")));
  });
  it("movimento com valor quebrado (não inteiro) é recusado até pro owner", async () => {
    await assertFails(setDoc(doc(ctx(DONO), "fin_movimentos", "c4"), { ...exemplo.fin_movimentos, id: "c4", centavos: 12.5 }));
  });
});
