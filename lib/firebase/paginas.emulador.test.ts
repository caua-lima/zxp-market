import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, limit, orderBy, query, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import { paginaApos } from "./paginas";

/**
 * S22 da auditoria SaaS: paginação de verdade, contra o emulador REAL com as
 * regras do projeto e um dono autenticado — `npm run test:emulador`.
 *
 * A pergunta: percorrendo o livro página por página a partir da primeira (a
 * mesma consulta de watchMovimentos), chega-se a TODOS os lançamentos, sem
 * repetir nenhum — mesmo com dezenas no mesmo dia?
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };

function ctx(): Firestore {
  return env.authenticatedContext(DONO.uid, { email: DONO.email }).firestore() as unknown as Firestore;
}

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-paginas",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });

/** 5 dias × 13 lançamentos por dia = 65, com muitos empates de `data`. */
async function semearLivro() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore() as unknown as Firestore;
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    const lote = writeBatch(db);
    for (let dia = 1; dia <= 5; dia++) {
      for (let k = 0; k < 13; k++) {
        const id = `mov-${dia}-${String(k).padStart(2, "0")}`;
        lote.set(doc(db, "estoque_movimentos", id), {
          id, productId: "p1", tipo: "entrada", quantidade: 1, data: `2026-09-0${dia}`, createdBy: DONO.email, createdAt: dia * 100 + k,
        });
      }
    }
    await lote.commit();
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await semearLivro();
});

describe("paginaApos (S22)", () => {
  it("da primeira página até o fim: os 65 lançamentos, nenhum repetido, na mesma ordem de watchMovimentos", async () => {
    const db = ctx();
    // A primeira página, exatamente como watchMovimentos a pede (teto baixo aqui).
    const primeira = (await getDocs(query(collection(db, "estoque_movimentos"), orderBy("data", "desc"), limit(10))))
      .docs.map((d) => ({ ...(d.data() as { data: string }), id: d.id }));
    const vistos = [...primeira];
    let temMais = true;
    let voltas = 0;
    while (temMais) {
      const ultimo = vistos[vistos.length - 1];
      const p = await paginaApos<{ id: string; data: string }>(db, "estoque_movimentos", "data", { id: ultimo.id, valor: ultimo.data }, 7);
      vistos.push(...p.itens);
      temMais = p.temMais;
      if (++voltas > 20) throw new Error("não terminou");
    }
    const ids = vistos.map((v) => v.id);
    expect(new Set(ids).size).toBe(65); // nenhum repetido
    expect(ids).toHaveLength(65); // nenhum faltando
    // Ordem: data desc, e dentro do dia, id desc — a do Firestore.
    const esperado = [...ids].sort((a, b) => {
      const [, da] = a.split("-"); const [, db2] = b.split("-");
      return Number(db2) - Number(da) || b.localeCompare(a);
    });
    expect(ids).toEqual(esperado);
  });

  it("o cursor só com a data (sem o id) perderia os empates do mesmo dia — o id é o que evita isso", async () => {
    const db = ctx();
    // Começando depois do 1º lançamento do dia 5: o resto do dia 5 tem que vir.
    const p = await paginaApos<{ id: string; data: string }>(db, "estoque_movimentos", "data", { id: "mov-5-12", valor: "2026-09-05" }, 5);
    expect(p.itens.map((i) => i.id)).toEqual(["mov-5-11", "mov-5-10", "mov-5-09", "mov-5-08", "mov-5-07"]);
  });

  it("temMais é falso na última página e verdadeiro antes dela", async () => {
    const db = ctx();
    const quaseFim = await paginaApos<{ id: string }>(db, "estoque_movimentos", "data", { id: "mov-1-05", valor: "2026-09-01" }, 5);
    expect(quaseFim).toMatchObject({ temMais: false });
    expect(quaseFim.itens).toHaveLength(5);
    const meio = await paginaApos<{ id: string }>(db, "estoque_movimentos", "data", { id: "mov-3-00", valor: "2026-09-03" }, 5);
    expect(meio.temMais).toBe(true);
  });

  it("tarefas também: ordem por createdAt, com as regras valendo pro dono", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore() as unknown as Firestore;
      for (let k = 0; k < 6; k++) await setDoc(doc(db, "tarefas", `t${k}`), { id: `t${k}`, title: `T${k}`, status: "todo", createdAt: 1000 + k, createdBy: DONO.email });
    });
    const p = await paginaApos<{ id: string }>(ctx(), "tarefas", "createdAt", { id: "t3", valor: 1003 }, 10);
    expect(p.itens.map((i) => i.id)).toEqual(["t2", "t1", "t0"]);
    expect(p.temMais).toBe(false);
  });
});
