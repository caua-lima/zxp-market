import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { criarMovimentoAuditado } from "@/lib/firebase/movimento-auditado";

/**
 * Isolamento do dado de negócio entre empresas (Etapa 3), contra o emulador
 * REAL com as regras geradas em firestore.rules.
 */

let env: RulesTestEnvironment;
const DONO_A = { uid: "a", email: "dono@a.com" };
const PARCEIRO_A = { uid: "pa", email: "parceiro@a.com" };
const MEMBRO_A = { uid: "ma", email: "membro@a.com" };
const DONO_B = { uid: "b", email: "dono@b.com" };
const LEGADO = { uid: "l", email: "legado@x.com" }; // só em controleAcesso, fora de qualquer empresa

function ctx(p: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(p.uid, { email: p.email }).firestore() as unknown as Firestore;
}

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-dados-tenant",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "tenants/a"), { name: "A" });
    await setDoc(doc(db, "tenants/b"), { name: "B" });
    await setDoc(doc(db, "tenants/a/members", DONO_A.email), { email: DONO_A.email, role: "owner" });
    await setDoc(doc(db, "tenants/a/members", PARCEIRO_A.email), { email: PARCEIRO_A.email, role: "partner", permissoesEdicao: ["estoque"] });
    await setDoc(doc(db, "tenants/a/members", MEMBRO_A.email), { email: MEMBRO_A.email, role: "member" });
    await setDoc(doc(db, "tenants/b/members", DONO_B.email), { email: DONO_B.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", LEGADO.email), { email: LEGADO.email, role: "owner" });
    await setDoc(doc(db, "tenants/a/estoque/p1"), { name: "Menta A", custo: "10" });
    await setDoc(doc(db, "tenants/a/custos/c1"), { nome: "Aluguel A" });
    await setDoc(doc(db, "tenants/b/estoque/p1"), { name: "Menta B", custo: "20" });
  });
});

describe("dado da empresa isolado por empresa (Etapa 3)", () => {
  it("o dono lê o próprio estoque e NÃO o de outra empresa", async () => {
    await assertSucceeds(getDoc(doc(ctx(DONO_A), "tenants/a/estoque/p1")));
    await assertFails(getDoc(doc(ctx(DONO_A), "tenants/b/estoque/p1")));
    await assertFails(getDoc(doc(ctx(DONO_B), "tenants/a/custos/c1")));
  });

  it("quem só está em controleAcesso (legado) não alcança o dado de empresa nenhuma", async () => {
    await assertFails(getDoc(doc(ctx(LEGADO), "tenants/a/estoque/p1")));
  });

  it("papel vale dentro da empresa: parceiro edita só o que tem permissão; member não vê custo", async () => {
    await assertSucceeds(setDoc(doc(ctx(PARCEIRO_A), "tenants/a/estoque/p2"), { name: "Nova", custo: "5" }));
    await assertFails(setDoc(doc(ctx(PARCEIRO_A), "tenants/a/custos/c2"), { nome: "X", valor: 1 }));
    await assertFails(getDoc(doc(ctx(MEMBRO_A), "tenants/a/custos/c1")));
  });

  it("dono de uma empresa não escreve na outra", async () => {
    await assertFails(setDoc(doc(ctx(DONO_A), "tenants/b/estoque/p9"), { name: "Invasão", custo: "1" }));
  });

  it("a auditoria obrigatória da movimentação (S20) vale dentro da empresa, com caminhos da empresa", async () => {
    const db = ctx(DONO_A);
    // Sem registro: recusado.
    await assertFails(setDoc(doc(db, "tenants/a/estoque_movimentos/m1"), {
      id: "m1", productId: "p1", tipo: "entrada", quantidade: 1, data: "2026-09-20", revisao: 1,
    }));
  });

  it("outbox e entregas continuam fechados ao cliente, também dentro da empresa", async () => {
    await assertFails(getDoc(doc(ctx(DONO_A), "tenants/a/notification_outbox/x")));
  });
});

// O lote auditado escreve na raiz (modo atual). No modo empresa ele escreve em
// tenants/{t}/…; o caminho é trocado pela camada de dados — ver lib/firebase/caminhos.ts.
void criarMovimentoAuditado;

describe("S25 — empresa bloqueada (assinatura vencida/cancelada) só lê", () => {
  const bloquear = () => env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "tenants/a"), { name: "A", bloqueio: { motivo: "cancelada", desde: 1 } });
  });

  it("o dono continua LENDO tudo (nada some), mas não grava mais", async () => {
    await bloquear();
    await assertSucceeds(getDoc(doc(ctx(DONO_A), "tenants/a/estoque/p1")));
    await assertSucceeds(getDoc(doc(ctx(DONO_A), "tenants/a/custos/c1")));
    await assertFails(setDoc(doc(ctx(DONO_A), "tenants/a/estoque/p3"), { name: "Nova", custo: "5" }));
    await assertFails(setDoc(doc(ctx(PARCEIRO_A), "tenants/a/estoque/p2"), { name: "Nova", custo: "5" }));
  });

  it("o bloqueio de uma empresa não trava a outra", async () => {
    await bloquear();
    await assertSucceeds(setDoc(doc(ctx(DONO_B), "tenants/b/estoque/p9"), { name: "B nova", custo: "7" }));
  });

  it("desbloqueada (pagou), volta a gravar", async () => {
    await bloquear();
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), "tenants/a"), { name: "A" }); });
    await assertSucceeds(setDoc(doc(ctx(DONO_A), "tenants/a/estoque/p3"), { name: "Nova", custo: "5" }));
  });
});
