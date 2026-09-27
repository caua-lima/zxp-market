import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { excluirEmpresa, excluirPessoa, exportarEmpresa, exportarPessoa } from "./dados-da-empresa";

/** S27 — exportação/eliminação por empresa e por pessoa, no emulador, com dado sintético. */

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "dados-empresa") ?? initializeApp({ projectId: "zxp-teste-dados-empresa" }, "dados-empresa");
  db = getFirestore(app);
});
afterAll(async () => { await db?.terminate(); });

beforeEach(async () => {
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
  // Empresa A (a que sai) e empresa B (vizinha, não pode ser tocada).
  await db.doc("tenants/emp-a").set({ nome: "A" });
  await db.doc("tenants/emp-a/members/dona@a.com").set({ papel: "owner" });
  await db.doc("tenants/emp-a/members/func@a.com").set({ papel: "member" });
  await db.doc("tenants/emp-a/estoque/p1").set({ name: "Produto A", custo: "10" });
  await db.doc("tenants/emp-a/connections/main").set({ sellerId: "111", refresh_token: "R-sintetico", access_token: "A-sintetico" });
  await db.doc("tenants/emp-a/notification_feed/func@a.com/itens/x").set({ title: "tarefa" });
  await db.doc("memberships/dona@a.com").set({ tenantId: "emp-a" });
  await db.doc("memberships/func@a.com").set({ tenantId: "emp-a" });
  await db.doc("vendedores/111").set({ tenantId: "emp-a", connectionId: "main" });
  await db.doc("pushTokens/func@a.com__dev1").set({ token: "T-sintetico", email: "func@a.com" });
  await db.doc("usuarios/uid-func/preferences/notifications").set({ vendas: true });

  await db.doc("tenants/emp-b").set({ nome: "B" });
  await db.doc("tenants/emp-b/members/dono@b.com").set({ papel: "owner" });
  await db.doc("tenants/emp-b/estoque/p1").set({ name: "Produto B" });
  await db.doc("memberships/dono@b.com").set({ tenantId: "emp-b" });
  await db.doc("vendedores/222").set({ tenantId: "emp-b", connectionId: "main" });
  await db.doc("pushTokens/func@a.com.br__dev9").set({ token: "T-vizinho" });
  // Modo raiz (antes da virada): a lista de acesso legada.
  await db.doc("controleAcesso/func@a.com").set({ role: "member" });
  await db.doc("controleAcesso/dono-raiz@a.com").set({ role: "owner" });
});

describe("S27 — dados por empresa", () => {
  it("exporta a árvore da empresa inteira, sem os tokens do ML", async () => {
    const docs = await exportarEmpresa(db, "emp-a");
    const caminhos = docs.map((d) => d.caminho).sort();
    expect(caminhos).toContain("tenants/emp-a/estoque/p1");
    expect(caminhos).toContain("tenants/emp-a/notification_feed/func@a.com/itens/x");
    expect(caminhos.some((c) => c.startsWith("tenants/emp-b"))).toBe(false);
    const conexao = docs.find((d) => d.caminho === "tenants/emp-a/connections/main")!;
    expect(conexao.dados).toEqual({ sellerId: "111" });
  });

  it("ensaio não apaga; aplicar apaga a empresa, os vínculos e o vendedor — e só dela", async () => {
    const ensaio = await excluirEmpresa(db, "emp-a", { aplicar: false });
    expect(ensaio).toMatchObject({ vinculosDePessoas: ["dona@a.com", "func@a.com"], vendedoresIndexados: ["111"], aplicado: false });
    expect(ensaio.documentosDaEmpresa).toBe(6); // o feed func@a.com é fantasma (só subcoleção)
    expect((await db.doc("tenants/emp-a/estoque/p1").get()).exists).toBe(true);

    await excluirEmpresa(db, "emp-a", { aplicar: true });
    expect((await db.doc("tenants/emp-a").listCollections()).length).toBe(0);
    expect((await db.doc("memberships/func@a.com").get()).exists).toBe(false);
    expect((await db.doc("vendedores/111").get()).exists).toBe(false);
    // A vizinha, intacta.
    expect((await db.doc("tenants/emp-b/estoque/p1").get()).exists).toBe(true);
    expect((await db.doc("memberships/dono@b.com").get()).exists).toBe(true);
    expect((await db.doc("vendedores/222").get()).exists).toBe(true);
  });
});

describe("S27 — dados por pessoa", () => {
  it("exporta vínculo, membro, aparelhos (sem token de push), feed e preferências", async () => {
    const caminhos = (await exportarPessoa(db, "Func@A.com", "uid-func")).map((d) => d.caminho).sort();
    expect(caminhos).toEqual([
      "controleAcesso/func@a.com",
      "memberships/func@a.com",
      "pushTokens/func@a.com__dev1",
      "tenants/emp-a/members/func@a.com",
      "tenants/emp-a/notification_feed/func@a.com/itens/x",
      "usuarios/uid-func/preferences/notifications",
    ]);
    const push = (await exportarPessoa(db, "func@a.com")).find((d) => d.caminho.startsWith("pushTokens"))!;
    expect(push.dados).toEqual({ email: "func@a.com" });
  });

  it("apaga a pessoa sem tocar no aparelho de um e-mail parecido nem na empresa", async () => {
    const r = await excluirPessoa(db, "func@a.com", { uid: "uid-func", aplicar: true });
    expect(r).toMatchObject({ aplicado: true });
    for (const c of ["controleAcesso/func@a.com", "memberships/func@a.com", "tenants/emp-a/members/func@a.com", "pushTokens/func@a.com__dev1", "tenants/emp-a/notification_feed/func@a.com/itens/x", "usuarios/uid-func/preferences/notifications"]) {
      expect((await db.doc(c).get()).exists, c).toBe(false);
    }
    expect((await db.doc("pushTokens/func@a.com.br__dev9").get()).exists).toBe(true);
    expect((await db.doc("tenants/emp-a/estoque/p1").get()).exists).toBe(true);
  });

  it("recusa apagar quem é dono de empresa (a empresa ficaria sem administrador)", async () => {
    expect(await excluirPessoa(db, "dona@a.com", { aplicar: true })).toEqual({ recusado: "dono_de_empresa", empresas: ["emp-a"] });
    expect((await db.doc("tenants/emp-a/members/dona@a.com").get()).exists).toBe(true);
    expect(await excluirPessoa(db, "dono-raiz@a.com", { aplicar: true })).toEqual({ recusado: "dono_de_empresa", empresas: ["(raiz)"] });
  });
});
