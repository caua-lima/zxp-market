import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { recomputeProdutoComVersao } from "./estoque-recompute";
import { cancelarVendaPresencialAuditada, criarMovimentoAuditado, criarVendaPresencialAuditada } from "./movimento-auditado";
import { baixasDaVenda, montarVendaPresencial } from "@/lib/domain/venda-presencial";
import type { Product } from "@/lib/domain/types";

/**
 * O PDV (vendas presenciais) contra o emulador REAL com as regras do projeto:
 * a venda e as baixas no livro entram juntas, o "em casa" desce, o custo médio
 * não muda; cancelar devolve o estoque e a venda fica no histórico. Quem só
 * acompanha resultado (member) não vende nem lê o caixa.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const ESTOQUISTA = { uid: "uid-est", email: "estoque@zxp.com" };
const ADS = { uid: "uid-ads", email: "ads@zxp.com" };
const MEMBRO = { uid: "uid-membro", email: "membro@zxp.com" };

function ctx(quem = DONO): Firestore {
  return env.authenticatedContext(quem.uid, { email: quem.email }).firestore() as unknown as Firestore;
}

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-pdv",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });

const PRODUTOS: Product[] = [
  { id: "limao", name: "Limão Caipira", custo: "0", ativo: true, custoMedio: 10 } as Product,
  { id: "erva", name: "Erva Mate", custo: "0", ativo: true, custoMedio: 8 } as Product,
];

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", ESTOQUISTA.email), { email: ESTOQUISTA.email, role: "user", permissoesEdicao: ["estoque"] });
    await setDoc(doc(db, "controleAcesso", ADS.email), { email: ADS.email, role: "user", permissoesEdicao: ["ads"] });
    await setDoc(doc(db, "controleAcesso", MEMBRO.email), { email: MEMBRO.email, role: "member" });
    for (const p of PRODUTOS) await setDoc(doc(db, "estoque", p.id), { name: p.name, custo: "0", ativo: true });
  });
  const db = ctx();
  await criarMovimentoAuditado(db, { id: "e-limao", productId: "limao", tipo: "entrada", quantidade: 50, custoUnit: 10, data: "2026-10-01" }, DONO.email, { entidadeLabel: "x" });
  await criarMovimentoAuditado(db, { id: "e-erva", productId: "erva", tipo: "entrada", quantidade: 20, custoUnit: 8, data: "2026-10-01" }, DONO.email, { entidadeLabel: "x" });
  await recomputeProdutoComVersao(db, "limao");
  await recomputeProdutoComVersao(db, "erva");
});

function vender(quem: { email: string }, id = "venda-0001") {
  const r = montarVendaPresencial({
    id, linhas: [{ productId: "limao", quantidade: 3, precoUnit: 15 }, { productId: "erva", quantidade: 2, precoUnit: 12 }],
    desconto: 4, pagamento: "pix", cliente: "Dona Maria", data: "2026-10-24", hora: "10:15",
    produtos: PRODUTOS, email: quem.email, agora: 1000,
  });
  if (!r.ok) throw new Error(r.erro);
  return r;
}
const textos = (r: ReturnType<typeof vender>) => r.baixas.map((b) => ({ entidadeLabel: `${b.productId} · Venda presencial`, detalhe: `${-b.quantidade} un` }));
const emCasa = async (db: Firestore, id: string) => (await getDoc(doc(db, "estoque", id))).data()?.qtdLocal;

describe("PDV — vender", () => {
  it("venda e baixas juntas: o 'em casa' desce, o custo médio fica, o lucro é preço menos custo", async () => {
    const db = ctx();
    const r = vender(DONO);
    expect(await criarVendaPresencialAuditada(db, r.venda, r.baixas, DONO.email, textos(r))).toBe("criada");
    await recomputeProdutoComVersao(db, "limao");
    await recomputeProdutoComVersao(db, "erva");

    const v = (await getDoc(doc(db, "vendas_presenciais", "venda-0001"))).data()!;
    expect(v).toMatchObject({ total: 65, custo: 46, lucro: 19, status: "ativa", pagamento: "pix" });
    expect(await emCasa(db, "limao")).toBe(47);
    expect(await emCasa(db, "erva")).toBe(18);
    expect((await getDoc(doc(db, "estoque", "limao"))).data()?.custoMedio).toBe(10);
    // a baixa leva a marca da venda e tem auditoria
    expect((await getDoc(doc(db, "estoque_movimentos", "pdv_venda-0001_1"))).data()).toMatchObject({ tipo: "ajuste", quantidade: -3, vendaPresencialId: "venda-0001" });
    expect((await getDoc(doc(db, "auditLog", "mov_pdv_venda-0001_1_r1"))).exists()).toBe(true);
  });

  it("repetir (duplo toque) não duplica nem falha", async () => {
    const db = ctx();
    const r = vender(DONO);
    await criarVendaPresencialAuditada(db, r.venda, r.baixas, DONO.email, textos(r));
    expect(await criarVendaPresencialAuditada(db, r.venda, r.baixas, DONO.email, textos(r))).toBe("ja_existia");
    await recomputeProdutoComVersao(db, "limao");
    expect(await emCasa(db, "limao")).toBe(47);
  });

  it("quem edita estoque vende; quem só mexe em Ads ou só acompanha, não", async () => {
    const r = vender(ESTOQUISTA, "venda-0002");
    await assertSucceeds(criarVendaPresencialAuditada(ctx(ESTOQUISTA), r.venda, r.baixas, ESTOQUISTA.email, textos(r)));
    const a = vender(ADS, "venda-0003");
    await assertFails(criarVendaPresencialAuditada(ctx(ADS), a.venda, a.baixas, ADS.email, textos(a)));
    const m = vender(MEMBRO, "venda-0004");
    await assertFails(criarVendaPresencialAuditada(ctx(MEMBRO), m.venda, m.baixas, MEMBRO.email, textos(m)));
    // e o member não lê o caixa (custo e lucro)
    await assertFails(getDoc(doc(ctx(MEMBRO), "vendas_presenciais", "venda-0002")));
    await assertSucceeds(getDoc(doc(ctx(ADS), "vendas_presenciais", "venda-0002")));
  });

  it("não dá pra gravar venda em nome de outro, nem apagar venda", async () => {
    const r = vender(DONO, "venda-0005");
    await assertFails(criarVendaPresencialAuditada(ctx(ESTOQUISTA), r.venda, r.baixas, ESTOQUISTA.email, textos(r)));
    await criarVendaPresencialAuditada(ctx(), r.venda, r.baixas, DONO.email, textos(r));
    await assertFails(deleteDoc(doc(ctx(), "vendas_presenciais", "venda-0005")));
    // nem mexer no valor depois de gravada
    await assertFails(updateDoc(doc(ctx(), "vendas_presenciais", "venda-0005"), { total: 1 }));
  });
});

describe("PDV — cancelar", () => {
  it("o estoque volta, a venda fica no histórico como cancelada, com quem e por quê", async () => {
    const db = ctx();
    const r = vender(DONO);
    await criarVendaPresencialAuditada(db, r.venda, r.baixas, DONO.email, textos(r));
    const baixas = baixasDaVenda(r.venda).map((b) => ({ id: b.id, texto: { entidadeLabel: `${b.productId} · Venda presencial cancelada` } }));
    await cancelarVendaPresencialAuditada(db, "venda-0001", baixas, DONO.email, "cliente desistiu");
    await recomputeProdutoComVersao(db, "limao");
    await recomputeProdutoComVersao(db, "erva");

    expect((await getDoc(doc(db, "vendas_presenciais", "venda-0001"))).data()).toMatchObject({
      status: "cancelada", canceladaPor: DONO.email, canceladaEm: expect.any(Number), motivoCancelamento: "cliente desistiu", total: 65,
    });
    expect(await emCasa(db, "limao")).toBe(50);
    expect(await emCasa(db, "erva")).toBe(20);
    expect((await getDoc(doc(db, "estoque_movimentos", "pdv_venda-0001_1"))).exists()).toBe(false);
    expect((await getDoc(doc(db, "auditLog", "mov_pdv_venda-0001_1_excluido"))).exists()).toBe(true);
  });

  it("baixa já tirada à mão não trava o cancelamento; cancelar duas vezes é recusado", async () => {
    const db = ctx();
    const r = vender(DONO);
    await criarVendaPresencialAuditada(db, r.venda, r.baixas, DONO.email, textos(r));
    await env.withSecurityRulesDisabled(async (c) => { await deleteDoc(doc(c.firestore(), "estoque_movimentos", "pdv_venda-0001_2")); });
    const baixas = baixasDaVenda(r.venda).map((b) => ({ id: b.id, texto: { entidadeLabel: "x" } }));
    await cancelarVendaPresencialAuditada(db, "venda-0001", baixas, DONO.email, "");
    expect((await getDoc(doc(db, "vendas_presenciais", "venda-0001"))).data()?.status).toBe("cancelada");
    expect((await getDoc(doc(db, "vendas_presenciais", "venda-0001"))).data()?.motivoCancelamento).toBeUndefined();
    await assertFails(cancelarVendaPresencialAuditada(db, "venda-0001", [], DONO.email, "de novo"));
  });
});
