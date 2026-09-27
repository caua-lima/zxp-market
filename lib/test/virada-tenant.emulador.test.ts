import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore as FirestoreAdmin } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, type Firestore } from "firebase/firestore";
import { comCaminhosDeDados } from "@/lib/firebase/db-de-dados";
import { gravarPedidos } from "@/lib/ml/gravar-pedido";
import { estadoDoPedido } from "@/lib/domain/estado-do-pedido";
import { criarMovimentoAuditado } from "@/lib/firebase/movimento-auditado";

/**
 * A VIRADA (Etapa 3) contra o emulador REAL: com a chave em modo tenant, o
 * servidor, o cliente e as regras usam tenants/{id}/…. Com a chave desligada,
 * tudo continua na raiz. O time da empresa: app/api/acesso/membros (teste próprio).
 */

const PROJETO = "zxp-teste-virada";
const T = { modo: "tenant" as const, tenantId: "vazxpress" };
const DONO = { uid: "d", email: "dono@z.com" };
let admin: FirestoreAdmin;
let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  const app = getApps().find((a) => a.name === "virada") ?? initializeApp({ projectId: PROJETO }, "virada");
  admin = getFirestore(app);
  env = await initializeTestEnvironment({
    projectId: PROJETO,
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); await admin?.terminate(); });

beforeEach(async () => {
  await env.clearFirestore();
  await admin.doc("tenants/vazxpress").set({ name: "VAZXPRESS" });
  await admin.doc(`tenants/vazxpress/members/${DONO.email}`).set({ email: DONO.email, role: "owner" });
  await admin.doc(`controleAcesso/${DONO.email}`).set({ email: DONO.email, role: "owner" });
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_ZXP_MODO_DADOS;
  delete process.env.NEXT_PUBLIC_ZXP_TENANT_ID;
});

const pedido = { id: 2000001, status: "paid", last_updated: "2026-09-20T10:00:00.000-04:00", total_amount: 10, order_items: [] };

describe("servidor com a chave ligada", () => {
  it("o gravador de pedidos (transação + getAll) grava em tenants/{id}/ml_orders, não na raiz", async () => {
    const db = comCaminhosDeDados(admin, T);
    await gravarPedidos(db, [{ orderId: "2000001", estado: estadoDoPedido(pedido) }]);
    expect((await admin.doc("tenants/vazxpress/ml_orders/2000001").get()).data()?.status).toBe("paid");
    expect((await admin.doc("ml_orders/2000001").get()).exists).toBe(false);
  });

  it("o token do ML é lido da conexão da empresa", async () => {
    await admin.doc("tenants/vazxpress/connections/main").set({ refresh_token: "R" });
    const db = comCaminhosDeDados(admin, T);
    expect((await db.doc("ml_tokens/main").get()).data()?.refresh_token).toBe("R");
    expect((await db.collection("ml_tokens").doc("main").get()).exists).toBe(true);
  });

  it("chave desligada: o mesmo código grava na raiz, como sempre", async () => {
    await gravarPedidos(comCaminhosDeDados(admin, { modo: "raiz" }), [{ orderId: "2000001", estado: estadoDoPedido(pedido) }]);
    expect((await admin.doc("ml_orders/2000001").get()).exists).toBe(true);
    expect((await admin.doc("tenants/vazxpress/ml_orders/2000001").get()).exists).toBe(false);
  });
});

describe("cliente com a chave ligada, sob as regras da empresa", () => {
  it("o lançamento auditado (S20) grava movimentação e registro dentro da empresa", async () => {
    process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
    process.env.NEXT_PUBLIC_ZXP_TENANT_ID = "vazxpress";
    const db = env.authenticatedContext(DONO.uid, { email: DONO.email }).firestore() as unknown as Firestore;
    await assertSucceeds(criarMovimentoAuditado(db, { id: "m1", productId: "p1", tipo: "entrada", quantidade: 1, data: "2026-09-20" }, DONO.email, { entidadeLabel: "x" }));
    expect((await admin.doc("tenants/vazxpress/estoque_movimentos/m1").get()).data()?.revisao).toBe(1);
    expect((await admin.doc("tenants/vazxpress/auditLog/mov_m1_r1").get()).exists).toBe(true);
    expect((await admin.doc("estoque_movimentos/m1").get()).exists).toBe(false);
  });

  it("quem não é membro da empresa não lê o dado dela pelo cliente", async () => {
    await admin.doc("tenants/vazxpress/estoque/p1").set({ name: "x", custo: "1" });
    const estranho = env.authenticatedContext("e", { email: "estranho@z.com" }).firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(estranho, "tenants/vazxpress/estoque/p1")));
  });
});
