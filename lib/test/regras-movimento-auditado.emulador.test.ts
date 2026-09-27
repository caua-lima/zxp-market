import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import {
  criarMovimentoAuditado,
  editarMovimentoAuditado,
  excluirMovimentoAuditado,
} from "@/lib/firebase/movimento-auditado";
import type { EstoqueMovimento } from "@/lib/domain/types";

/**
 * S20 da auditoria SaaS, contra o emulador REAL com as regras do projeto.
 *
 * O rastro de uma mudança no livro de estoque (que muda o custo médio e o
 * lucro de vendas já apuradas) deixou de depender do cliente lembrar de
 * chamar logAudit. A regra recusa a gravação sem o registro no mesmo lote, e
 * recusa registro que não bate com o livro.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const OUTRO = { uid: "uid-outro", email: "outro@zxp.com" };

function ctx(quem = DONO): Firestore {
  return env.authenticatedContext(quem.uid, { email: quem.email }).firestore() as unknown as Firestore;
}

const MOV = { id: "m1", productId: "p1", tipo: "entrada" as const, quantidade: 5, custoUnit: 10, data: "2026-09-20" };
const texto = { entidadeLabel: "Produto · Entrada" };
const agora = () => Date.now();

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-mov-auditado",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
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

async function lido(id = "m1") {
  let d: EstoqueMovimento | null = null;
  await env.withSecurityRulesDisabled(async (c) => {
    const s = await getDoc(doc(c.firestore(), "estoque_movimentos", id));
    d = s.exists() ? (s.data() as EstoqueMovimento) : null;
  });
  return d as EstoqueMovimento | null;
}

describe("movimentação só com o registro no mesmo lote (S20)", () => {
  it("criar pelo lote auditado passa, e o registro fica com id mov_{id}_r1", async () => {
    await assertSucceeds(criarMovimentoAuditado(ctx(), MOV, DONO.email, texto));
    expect((await lido())?.revisao).toBe(1);
    await env.withSecurityRulesDisabled(async (c) => {
      const r = await getDoc(doc(c.firestore(), "auditLog", "mov_m1_r1"));
      expect(r.data()).toMatchObject({ acao: "criar", entidade: "movimento", entidadeId: "m1", por: DONO.email });
    });
  });

  it("criar SEM o registro (o jeito antigo) é recusado", async () => {
    await assertFails(setDoc(doc(ctx(), "estoque_movimentos", "m1"), { ...MOV, revisao: 1, createdBy: DONO.email, createdAt: agora() }));
  });

  it("registro assinado por outra pessoa, ou com a ação errada, não serve", async () => {
    const db = ctx();
    const lote = writeBatch(db);
    lote.set(doc(db, "estoque_movimentos", "m1"), { ...MOV, revisao: 1 });
    lote.set(doc(db, "auditLog", "mov_m1_r1"), { id: "mov_m1_r1", acao: "editar", entidade: "movimento", entidadeId: "m1", entidadeLabel: "x", por: DONO.email, em: agora() });
    await assertFails(lote.commit());
    await assertFails(criarMovimentoAuditado(ctx(), MOV, OUTRO.email, texto)); // assina como outro
  });

  it("editar: versão +1 com o registro passa; sem o registro, ou pulando versão, é recusado", async () => {
    await criarMovimentoAuditado(ctx(), MOV, DONO.email, texto);
    const atual = (await lido())!;
    await assertFails(setDoc(doc(ctx(), "estoque_movimentos", "m1"), { ...atual, quantidade: 7, revisao: 2 })); // sem registro
    await assertSucceeds(editarMovimentoAuditado(ctx(), atual, { ...atual, quantidade: 7 }, DONO.email, texto));
    expect((await lido())).toMatchObject({ quantidade: 7, revisao: 2 });
  });

  it("duas correções sobre a MESMA versão: só a primeira entra (a outra não sobrescreve calada)", async () => {
    await criarMovimentoAuditado(ctx(), MOV, DONO.email, texto);
    const versaoLida = (await lido())!;
    await assertSucceeds(editarMovimentoAuditado(ctx(), versaoLida, { ...versaoLida, quantidade: 7 }, DONO.email, texto));
    await assertFails(editarMovimentoAuditado(ctx(OUTRO), versaoLida, { ...versaoLida, quantidade: 9 }, OUTRO.email, texto));
    expect((await lido())?.quantidade).toBe(7);
  });

  it("lançamento antigo, sem revisão, pode ser corrigido (conta como versão 0)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "estoque_movimentos", "m1"), { ...MOV });
    });
    const antigo = (await lido())!;
    await assertSucceeds(editarMovimentoAuditado(ctx(), antigo, { ...antigo, quantidade: 6 }, DONO.email, texto));
    expect((await lido())?.revisao).toBe(1);
  });

  it("excluir só com o registro: sem ele é recusado; com ele, o livro e o rastro ficam coerentes", async () => {
    await criarMovimentoAuditado(ctx(), MOV, DONO.email, texto);
    await assertFails(deleteDoc(doc(ctx(), "estoque_movimentos", "m1")));
    await assertSucceeds(excluirMovimentoAuditado(ctx(), "m1", DONO.email, texto));
    expect(await lido()).toBeNull();
  });
});

describe("registro de auditoria não inventa evento (S20)", () => {
  it("'excluí a movimentação' com ela ainda no livro é recusado", async () => {
    await criarMovimentoAuditado(ctx(), MOV, DONO.email, texto);
    await assertFails(setDoc(doc(ctx(), "auditLog", "mov_m1_excluido"), {
      id: "mov_m1_excluido", acao: "excluir", entidade: "movimento", entidadeId: "m1", entidadeLabel: "x", por: DONO.email, em: agora(),
    }));
  });

  it("registro de movimentação com id fora do padrão é recusado", async () => {
    await criarMovimentoAuditado(ctx(), MOV, DONO.email, texto);
    await assertFails(setDoc(doc(ctx(), "auditLog", "qualquer"), {
      id: "qualquer", acao: "editar", entidade: "movimento", entidadeId: "m1", entidadeLabel: "x", por: DONO.email, em: agora(),
    }));
  });

  it("vocabulário fechado: ação ou entidade inventada, ou campo a mais, é recusado; o registro comum de custo continua passando", async () => {
    const base = { id: "e1", acao: "editar", entidade: "custo", entidadeId: "c1", entidadeLabel: "Aluguel", por: DONO.email, em: agora() };
    await assertFails(setDoc(doc(ctx(), "auditLog", "e1"), { ...base, acao: "apagar_tudo" }));
    await assertFails(setDoc(doc(ctx(), "auditLog", "e1"), { ...base, entidade: "banco" }));
    await assertFails(setDoc(doc(ctx(), "auditLog", "e1"), { ...base, extra: "x" }));
    await assertFails(setDoc(doc(ctx(), "auditLog", "e1"), { ...base, detalhe: "x".repeat(501) }));
    await assertSucceeds(setDoc(doc(ctx(), "auditLog", "e1"), base));
  });
});
