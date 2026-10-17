import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import { recomputeProdutoComVersao } from "./estoque-recompute";
import { criarMovimentoAuditado, criarTransferenciaAuditada } from "./movimento-auditado";
import { planejarTransferencia } from "@/lib/domain/transferencia-estoque";

/**
 * Transferência entre dois cadastros do mesmo produto, contra o emulador REAL
 * com as regras do projeto: as duas pernas e os dois registros de auditoria
 * entram num lote só, e o custo médio do destino sai certo do livro.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const MEMBRO = { uid: "uid-membro", email: "membro@zxp.com" };

function ctx(quem = DONO): Firestore {
  return env.authenticatedContext(quem.uid, { email: quem.email }).firestore() as unknown as Firestore;
}

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-transferencia",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", MEMBRO.email), { email: MEMBRO.email, role: "member" });
    await setDoc(doc(db, "estoque", "full"), { name: "Limão Caipira", custo: "10", ativo: true, grupo: "Limão Caipira", canal: "full" });
    await setDoc(doc(db, "estoque", "ag"), { name: "Limão Caipira Agências", custo: "12", ativo: true, grupo: "Limão Caipira", canal: "agencias" });
  });
});

// Estoque inicial de cada lado, pelo lote auditado — como o app grava.
async function semear(db: Firestore) {
  await criarMovimentoAuditado(db, { id: "e-full", productId: "full", tipo: "entrada", quantidade: 100, custoUnit: 10, data: "2026-10-01" }, DONO.email, { entidadeLabel: "x" });
  await criarMovimentoAuditado(db, { id: "e-ag", productId: "ag", tipo: "entrada", quantidade: 180, custoUnit: 12, data: "2026-10-01" }, DONO.email, { entidadeLabel: "x" });
  await recomputeProdutoComVersao(db, "full");
  await recomputeProdutoComVersao(db, "ag");
}

function plano(quantidade: number, idBase = "t1") {
  const r = planejarTransferencia({
    de: { id: "ag", nome: "Limão Caipira Agências", emCasa: 180, estoqueTotal: 180, custoMedio: 12 },
    para: { id: "full", nome: "Limão Caipira", estoqueTotal: 100, custoMedio: 10 },
    quantidade, data: "2026-10-17", idBase,
  });
  if (!r.ok) throw new Error(r.motivo);
  return r;
}
const textos = [{ entidadeLabel: "ag · Transferência" }, { entidadeLabel: "full · Transferência" }] as const;

describe("transferência entre produtos do mesmo grupo", () => {
  it("move o estoque, refaz o custo médio do destino e deixa o rastro das duas pernas", async () => {
    const db = ctx();
    await semear(db);
    const p = plano(50);
    await criarTransferenciaAuditada(db, [p.saida, p.entrada], DONO.email, [textos[0], textos[1]]);
    await recomputeProdutoComVersao(db, "ag");
    await recomputeProdutoComVersao(db, "full");

    const ag = (await getDoc(doc(db, "estoque", "ag"))).data()!;
    const full = (await getDoc(doc(db, "estoque", "full"))).data()!;
    expect(ag.qtdLocal).toBe(130);              // 180 − 50
    expect(ag.custoMedio).toBe(12);             // saída pela média não move a média
    expect(full.qtdLocal).toBe(150);            // 100 + 50
    expect(full.custoMedio).toBeCloseTo(10.6667, 3); // (100×10 + 50×12) / 150

    // As duas pernas, com o mesmo id de transferência e o par apontado.
    const s = (await getDoc(doc(db, "estoque_movimentos", "tr-t1-s"))).data()!;
    const e = (await getDoc(doc(db, "estoque_movimentos", "tr-t1-e"))).data()!;
    expect([s.transferenciaId, e.transferenciaId]).toEqual(["t1", "t1"]);
    expect([s.transferenciaCom, e.transferenciaCom]).toEqual(["full", "ag"]);
    // E um registro de auditoria pra cada perna.
    expect((await getDoc(doc(db, "auditLog", "mov_tr-t1-s_r1"))).exists()).toBe(true);
    expect((await getDoc(doc(db, "auditLog", "mov_tr-t1-e_r1"))).exists()).toBe(true);
  });

  it("repetir a mesma transferência (retry) cai nos mesmos documentos: não duplica", async () => {
    const db = ctx();
    await semear(db);
    const p = plano(50);
    await criarTransferenciaAuditada(db, [p.saida, p.entrada], DONO.email, [textos[0], textos[1]]);
    await criarTransferenciaAuditada(db, [p.saida, p.entrada], DONO.email, [textos[0], textos[1]]);
    await recomputeProdutoComVersao(db, "ag");
    await recomputeProdutoComVersao(db, "full");
    expect((await getDoc(doc(db, "estoque", "ag"))).data()!.qtdLocal).toBe(130);
    expect((await getDoc(doc(db, "estoque", "full"))).data()!.qtdLocal).toBe(150);
  });

  it("uma perna sem o registro de auditoria derruba o lote inteiro (nada entra pela metade)", async () => {
    const db = ctx();
    await semear(db);
    const p = plano(50);
    // Lote montado à mão: as duas pernas, mas só o registro de uma delas.
    const lote = writeBatch(db);
    lote.set(doc(db, "estoque_movimentos", p.saida.id), { ...p.saida, revisao: 1, createdBy: DONO.email, createdAt: Date.now() });
    lote.set(doc(db, "estoque_movimentos", p.entrada.id), { ...p.entrada, revisao: 1, createdBy: DONO.email, createdAt: Date.now() });
    lote.set(doc(db, "auditLog", `mov_${p.saida.id}_r1`), {
      id: `mov_${p.saida.id}_r1`, acao: "criar", entidade: "movimento", entidadeId: p.saida.id, entidadeLabel: "x", por: DONO.email, em: Date.now(),
    });
    await assertFails(lote.commit());
    expect((await getDoc(doc(db, "estoque_movimentos", p.saida.id))).exists()).toBe(false);
    expect((await getDoc(doc(db, "estoque_movimentos", p.entrada.id))).exists()).toBe(false);
  });

  it("quem não edita estoque (member) não transfere", async () => {
    const p = plano(10);
    await assertFails(criarTransferenciaAuditada(ctx(MEMBRO), [p.saida, p.entrada], MEMBRO.email, [textos[0], textos[1]]));
  });

  it("transferir tudo deixa a origem em zero, sem negativo", async () => {
    const db = ctx();
    await semear(db);
    const p = plano(180);
    await criarTransferenciaAuditada(db, [p.saida, p.entrada], DONO.email, [textos[0], textos[1]]);
    await recomputeProdutoComVersao(db, "ag");
    expect((await getDoc(doc(db, "estoque", "ag"))).data()!.qtdLocal).toBe(0);
  });
});
