import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where, type Firestore } from "firebase/firestore";

/**
 * Quem vê qual tarefa, contra o emulador REAL com firestore.rules — na raiz e
 * dentro da empresa. O dono vê todas; o resto do time só as suas (atribuídas a
 * si ou criadas por si); member nenhuma. Espelha tarefaVisivel em
 * lib/domain/semana-tarefas.ts e as consultas de watchTasks.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "d", email: "dono@a.com" };
const ANA = { uid: "ana", email: "ana@a.com" };
const BETO = { uid: "beto", email: "beto@a.com" };
const MEMBRO = { uid: "m", email: "membro@a.com" };
/** Funcionário (papel "equipe"): só as tarefas atribuídas a ele. */
const JOAO = { uid: "joao", email: "joao@a.com" };

function ctx(p: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(p.uid, { email: p.email }).firestore() as unknown as Firestore;
}

const tarefa = (id: string, assignedTo: string | null, createdBy: string | null) => ({
  id, title: id, status: "todo", createdAt: 1,
  ...(assignedTo ? { assignedTo } : {}),
  ...(createdBy ? { createdBy } : {}),
});

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-tarefas",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const base of ["", "tenants/a/"]) {
      const acesso = base ? "tenants/a/members" : "controleAcesso";
      await setDoc(doc(db, acesso, DONO.email), { email: DONO.email, role: "owner" });
      await setDoc(doc(db, acesso, ANA.email), { email: ANA.email, role: "partner" });
      await setDoc(doc(db, acesso, BETO.email), { email: BETO.email, role: "partner" });
      await setDoc(doc(db, acesso, MEMBRO.email), { email: MEMBRO.email, role: "member" });
      await setDoc(doc(db, acesso, JOAO.email), { email: JOAO.email, role: "equipe" });
      await setDoc(doc(db, `${base}tarefas/do-joao`), tarefa("do-joao", JOAO.email, DONO.email));
      await setDoc(doc(db, `${base}ao_vivo/sinal`), { seq: 1, valor: 100 });
      await setDoc(doc(db, `${base}estoque/p1`), { id: "p1", nome: "Limão" });
      await setDoc(doc(db, `${base}tarefas/da-ana`), tarefa("da-ana", ANA.email, DONO.email));
      await setDoc(doc(db, `${base}tarefas/ana-pediu`), tarefa("ana-pediu", BETO.email, ANA.email));
      await setDoc(doc(db, `${base}tarefas/do-beto`), tarefa("do-beto", BETO.email, DONO.email));
      await setDoc(doc(db, `${base}tarefas/antiga`), tarefa("antiga", null, null));
    }
    await setDoc(doc(db, "tenants/a"), { name: "A" });
  });
});

for (const [nome, base] of [["raiz", ""], ["dentro da empresa", "tenants/a/"]] as const) {
  describe(`tarefas — ${nome}`, () => {
    const col = (db: Firestore) => collection(db, `${base}tarefas`);
    const d = (db: Firestore, id: string) => doc(db, `${base}tarefas/${id}`);

    it("o dono lê todas (a consulta do quadro inteiro)", async () => {
      await assertSucceeds(getDocs(query(col(ctx(DONO)), orderBy("createdAt", "desc"), limit(500))));
      await assertSucceeds(getDoc(d(ctx(DONO), "do-beto")));
      await assertSucceeds(getDoc(d(ctx(DONO), "antiga")));
    });

    it("o time lê as suas — atribuídas a si e criadas por si — e não a do outro", async () => {
      const ana = ctx(ANA);
      await assertSucceeds(getDoc(d(ana, "da-ana")));
      await assertSucceeds(getDoc(d(ana, "ana-pediu")));
      await assertFails(getDoc(d(ana, "do-beto")));
      await assertFails(getDoc(d(ana, "antiga")));
    });

    it("as consultas do time (por responsável e por quem criou) passam; a do quadro inteiro, não", async () => {
      const ana = ctx(ANA);
      await assertSucceeds(getDocs(query(col(ana), where("assignedTo", "==", ANA.email), limit(500))));
      await assertSucceeds(getDocs(query(col(ana), where("createdBy", "==", ANA.email), limit(500))));
      await assertFails(getDocs(query(col(ana), orderBy("createdAt", "desc"), limit(500))));
    });

    it("o time cria só em seu nome e mexe só nas suas", async () => {
      const ana = ctx(ANA);
      await assertSucceeds(setDoc(d(ana, "nova"), tarefa("nova", BETO.email, ANA.email)));
      await assertFails(setDoc(d(ana, "fingida"), tarefa("fingida", ANA.email, DONO.email)));
      await assertSucceeds(updateDoc(d(ana, "da-ana"), { status: "done" }));
      await assertFails(updateDoc(d(ana, "do-beto"), { status: "done" }));
      await assertFails(deleteDoc(d(ana, "do-beto")));
      await assertSucceeds(deleteDoc(d(ana, "ana-pediu")));
    });

    it("o dono mexe em qualquer uma", async () => {
      await assertSucceeds(updateDoc(d(ctx(DONO), "do-beto"), { status: "doing" }));
      await assertSucceeds(setDoc(d(ctx(DONO), "pro-beto"), tarefa("pro-beto", BETO.email, DONO.email)));
    });

    it("equipe: lê só as atribuídas a si (a consulta do app /tarefas) e nenhuma outra", async () => {
      const joao = ctx(JOAO);
      await assertSucceeds(getDocs(query(col(joao), where("assignedTo", "==", JOAO.email), limit(500))));
      await assertSucceeds(getDoc(d(joao, "do-joao")));
      await assertFails(getDoc(d(joao, "da-ana")));
      await assertFails(getDocs(query(col(joao), where("createdBy", "==", JOAO.email), limit(500))));
      await assertFails(getDocs(query(col(joao), orderBy("createdAt", "desc"), limit(500))));
    });

    it("equipe: conclui, reabre e muda o dia; não renomeia, não reatribui, não cria, não apaga", async () => {
      const joao = ctx(JOAO);
      await assertSucceeds(updateDoc(d(joao, "do-joao"), { status: "done", lastEditedBy: JOAO.email, updatedAt: 2, atividade: [{ tipo: "concluida", por: JOAO.email, em: 2 }] }));
      await assertSucceeds(updateDoc(d(joao, "do-joao"), { status: "todo", dueDate: "2026-11-06" }));
      await assertFails(updateDoc(d(joao, "do-joao"), { title: "outro nome" }));
      await assertFails(updateDoc(d(joao, "do-joao"), { assignedTo: ANA.email }));
      await assertFails(updateDoc(d(joao, "da-ana"), { status: "done" }));
      await assertFails(setDoc(d(joao, "nova"), tarefa("nova", JOAO.email, JOAO.email)));
      await assertFails(deleteDoc(d(joao, "do-joao")));
    });

    it("equipe: não vê nada da operação nem o faturamento ao vivo", async () => {
      const joao = ctx(JOAO);
      await assertFails(getDoc(doc(joao, `${base}estoque/p1`)));
      await assertFails(getDoc(doc(joao, `${base}ao_vivo/sinal`)));
      // o dono continua vendo
      await assertSucceeds(getDoc(doc(ctx(DONO), `${base}ao_vivo/sinal`)));
    });

    it("member não lê nem escreve tarefa nenhuma", async () => {
      const m = ctx(MEMBRO);
      await assertFails(getDocs(query(col(m), where("assignedTo", "==", MEMBRO.email), limit(500))));
      await assertFails(setDoc(d(m, "x"), tarefa("x", MEMBRO.email, MEMBRO.email)));
    });
  });
}
