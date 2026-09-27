import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { conferirMigracao, migrarDados } from "./migracao-dados";

/**
 * Ensaio da Etapa 5 contra o emulador REAL do Firestore, com dado sintético —
 * nada de produção. `npm run test:emulador`.
 */

let db: Firestore;
const T = "vazxpress";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "migracao-teste") ?? initializeApp({ projectId: "zxp-teste-migracao-dados" }, "migracao-teste");
  db = getFirestore(app);
});
afterAll(async () => { await db?.terminate(); });

async function limpar() {
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
}

async function semear() {
  await db.doc(`tenants/${T}`).set({ nome: "VAZXPRESS" });
  await db.doc("estoque/p1").set({ name: "Menta", custo: "10" });
  await db.doc("estoque/p2").set({ name: "Hortelã", custo: "12" });
  await db.doc("estoque_movimentos/m1").set({ productId: "p1", tipo: "entrada", quantidade: 5, data: "2026-09-20", revisao: 1 });
  await db.doc("ml_orders/2000001").set({ status: "paid", total_amount: 129.9 });
  await db.doc("auditLog/mov_m1_r1").set({ acao: "criar", entidade: "movimento", entidadeId: "m1" });
  // Documento "fantasma": só subcoleção, sem campos — não aparece num get() da coleção.
  await db.doc("notification_feed/dono@zxp.com/itens/aviso-1").set({ title: "Tarefa atribuída" });
  await db.doc("ml_tokens/main").set({ refresh_token: "R-sintetico", geracao: 3 });
  // O que é da pessoa fica na raiz e não é copiado.
  await db.doc("usuarios/uid-1/preferences/notifications").set({ vendas: true });
  await db.doc("ml_oauth_transacoes/t1").set({ verifier: "segredo" });
}

beforeEach(async () => {
  await limpar();
  await semear();
});

describe("migração do dado de negócio (Etapa 5)", () => {
  it("ensaio (sem --aplicar): conta o que copiaria e NÃO grava nada", async () => {
    const r = await migrarDados(db, { tenantId: T, aplicar: false });
    expect(r.find((x) => x.colecao === "estoque")).toMatchObject({ lidos: 2, gravados: 0 });
    expect(r.find((x) => x.colecao === "notification_feed")).toMatchObject({ lidos: 1, gravados: 0 });
    expect((await db.collection(`tenants/${T}/estoque`).get()).size).toBe(0);
  });

  it("aplicada: tudo da empresa vai pro tenant, com subcoleção e documento fantasma, e a conferência sai vazia", async () => {
    await migrarDados(db, { tenantId: T, aplicar: true });
    expect((await db.doc(`tenants/${T}/estoque/p1`).get()).data()).toEqual({ name: "Menta", custo: "10" });
    expect((await db.doc(`tenants/${T}/notification_feed/dono@zxp.com/itens/aviso-1`).get()).exists).toBe(true);
    expect((await db.doc(`tenants/${T}/connections/main`).get()).data()).toMatchObject({ refresh_token: "R-sintetico", geracao: 3 });
    expect(await conferirMigracao(db, T)).toEqual([]);
  });

  it("a ORIGEM fica intacta — é o rollback", async () => {
    await migrarDados(db, { tenantId: T, aplicar: true });
    expect((await db.collection("estoque").get()).size).toBe(2);
    expect((await db.doc("ml_tokens/main").get()).exists).toBe(true);
  });

  it("o que é da pessoa e o que é secreto não vão pro tenant", async () => {
    await migrarDados(db, { tenantId: T, aplicar: true });
    expect((await db.collection(`tenants/${T}/usuarios`).listDocuments()).length).toBe(0);
    expect((await db.collection(`tenants/${T}/ml_oauth_transacoes`).listDocuments()).length).toBe(0);
  });

  it("idempotente, e a passada final leva o que mudou na raiz depois da primeira", async () => {
    await migrarDados(db, { tenantId: T, aplicar: true });
    await db.doc("estoque/p1").set({ name: "Menta", custo: "11" }); // a operação continuou
    await db.doc("estoque/p3").set({ name: "Novo", custo: "5" });
    await migrarDados(db, { tenantId: T, aplicar: true });
    expect((await db.doc(`tenants/${T}/estoque/p1`).get()).data()?.custo).toBe("11");
    expect((await db.collection(`tenants/${T}/estoque`).get()).size).toBe(3);
    expect(await conferirMigracao(db, T)).toEqual([]);
  });

  it("conferência aponta o que faltou copiar", async () => {
    await migrarDados(db, { tenantId: T, aplicar: true });
    await db.doc("custos/c1").set({ nome: "Aluguel" }); // entrou depois e não foi copiado
    const d = await conferirMigracao(db, T);
    expect(d).toEqual([{ colecao: "custos", soNaOrigem: ["c1"], soNoDestino: [] }]);
  });

  it("sem o tenant criado (a primeira fatia), recusa — a ordem importa", async () => {
    await db.doc(`tenants/${T}`).delete();
    await expect(migrarDados(db, { tenantId: T, aplicar: true })).rejects.toThrow(/migrar-tenant-legado/);
  });

  it("recusa copiar coleção que não é de tenant, mesmo pedida pelo nome", async () => {
    await expect(migrarDados(db, { tenantId: T, aplicar: true, colecoes: ["usuarios"] })).rejects.toThrow(/não é coleção de tenant/);
  });
});
