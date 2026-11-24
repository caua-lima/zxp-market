import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { recomputeProdutoComVersao } from "./estoque-recompute";
import { criarMovimentoAuditado } from "./movimento-auditado";

/**
 * Achado S13 da auditoria SaaS, contra o emulador REAL do Firestore
 * (`npm run test:emulador`) — não um mock.
 *
 * O que se prova aqui é exatamente o que um mock não provaria: que a
 * transação com `estoqueVersao` genuinamente impede duas gravações
 * concorrentes de se sobreporem no Firestore de verdade, com as regras de
 * segurança do projeto valendo (owner tem que passar por `podeEditar`).
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const PRODUTO_ID = "prod-concorrencia";

/**
 * `authenticatedContext(...).firestore()` devolve o tipo COMPAT
 * (`firebase.default.firestore.Firestore`), mas as funções modulares
 * (`doc`, `collection`, `runTransaction`...) aceitam essa instância em
 * runtime via o shim de interop do próprio SDK — é o mesmo padrão já usado
 * em `lib/test/regras-notificacoes.emulador.test.ts`. O cast é só de TIPO;
 * o objeto em si é o de sempre.
 */
function ctx(): Firestore {
  return env.authenticatedContext(DONO.uid, { email: DONO.email }).firestore() as unknown as Firestore;
}

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-estoque",
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
    await setDoc(doc(db, "estoque", PRODUTO_ID), { name: "Produto de teste", custo: "10", ativo: true });
  });
});

// Pelo lote auditado, como o app grava: desde o S20 as regras recusam
// movimentação sem o registro de auditoria no mesmo lote.
async function gravarMovimento(db: Firestore, id: string, quantidade: number) {
  await criarMovimentoAuditado(db, {
    id, productId: PRODUTO_ID, tipo: "entrada", quantidade, custoUnit: 10, data: "2026-09-20",
  }, DONO.email, { entidadeLabel: "teste" });
}

describe("recomputeProdutoComVersao — concorrência real (S13)", () => {
  it("duas gravacoes SEQUENCIAIS (a segunda so comeca depois da primeira terminar) somam as duas", async () => {
    const db = ctx();
    await gravarMovimento(db, "mov-1", 5);
    await recomputeProdutoComVersao(db, PRODUTO_ID);
    await gravarMovimento(db, "mov-2", 3);
    await recomputeProdutoComVersao(db, PRODUTO_ID);

    const prod = (await getDoc(doc(db, "estoque", PRODUTO_ID))).data()!;
    expect(prod.qtdLocal).toBe(8);
    expect(prod.estoqueVersao).toBe(2);
  });

  it("duas gravacoes CONCORRENTES no MESMO produto — nenhuma se perde (a reproducao do achado)", async () => {
    /**
     * Simula o caso real: dois `addMovimento` disparados ao mesmo tempo (duas
     * abas, duas pessoas, ou um duplo-clique). Cada lado grava o PRÓPRIO
     * movimento e então chama o recálculo — as duas varreduras do livro
     * podem se sobrepor no tempo. Sem a versão, uma das duas escreve por
     * cima da outra e uma das 5+3=8 unidades some do agregado até o próximo
     * recálculo por acaso consertar. Com a versão, a que perder a corrida
     * detecta e refaz a varredura (agora vendo os dois movimentos).
     */
    const db = ctx();
    await Promise.all([
      gravarMovimento(db, "mov-a", 5).then(() => recomputeProdutoComVersao(db, PRODUTO_ID)),
      gravarMovimento(db, "mov-b", 3).then(() => recomputeProdutoComVersao(db, PRODUTO_ID)),
    ]);

    const prod = (await getDoc(doc(db, "estoque", PRODUTO_ID))).data()!;
    expect(prod.qtdLocal).toBe(8); // NUNCA 5 ou 3 sozinho — as duas entradas têm que estar refletidas
  });

  it("dez gravacoes concorrentes no mesmo produto — todas contam, nenhuma se perde", async () => {
    const db = ctx();
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        gravarMovimento(db, `mov-${i}`, 1).then(() => recomputeProdutoComVersao(db, PRODUTO_ID))),
    );
    const prod = (await getDoc(doc(db, "estoque", PRODUTO_ID))).data()!;
    expect(prod.qtdLocal).toBe(N);
  });
});

describe("recomputeProdutoComVersao — um sabor, um custo (23/11/2026)", () => {
  it("compra nas Agências muda o custo do Full também; a quantidade continua de cada um", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, "estoque", "par-full"), { name: "Sabor", grupo: "Sabor", canal: "full", custo: "10", ativo: true });
      await setDoc(doc(db, "estoque", "par-ag"), { name: "Sabor Agências", grupo: "Sabor", canal: "agencias", custo: "10", ativo: true });
    });
    const db = ctx();
    await criarMovimentoAuditado(db, {
      id: "par-1", productId: "par-full", tipo: "entrada", quantidade: 100, custoUnit: 10, estoqueAntes: 0, data: "2026-11-01",
    }, DONO.email, { entidadeLabel: "teste" });
    await recomputeProdutoComVersao(db, "par-full");
    await criarMovimentoAuditado(db, {
      id: "par-2", productId: "par-ag", tipo: "entrada", quantidade: 100, custoUnit: 12, estoqueAntes: 100, data: "2026-11-22",
    }, DONO.email, { entidadeLabel: "teste" });
    await recomputeProdutoComVersao(db, "par-ag");

    const full = (await getDoc(doc(db, "estoque", "par-full"))).data()!;
    const ag = (await getDoc(doc(db, "estoque", "par-ag"))).data()!;
    expect(full.custoMedio).toBe(11);
    expect(ag.custoMedio).toBe(11);
    expect(full.qtdLocal).toBe(100);
    expect(ag.qtdLocal).toBe(100);
    expect(full.custoMedioFaixas).toEqual(ag.custoMedioFaixas);
  });
});
