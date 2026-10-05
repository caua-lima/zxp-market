import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, type Firestore } from "firebase/firestore";
import { lerFonteDaColeta } from "./coleta-full";
import { montarColetaFull } from "@/lib/domain/coleta-full";
import { movIdRemessa } from "@/lib/domain/remessas";

/**
 * A coleta pro Full da DRE montada SÓ do Firestore, contra o emulador REAL com
 * as regras do projeto — `npm run test:emulador`. O Mercado Livre não entra: o
 * ponto é que a linha da DRE (e o custo já digitado) sobrevive a ele.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const MEMBRO = { uid: "uid-membro", email: "membro@zxp.com" };

const ctx = (p = DONO) => env.authenticatedContext(p.uid, { email: p.email }).firestore() as unknown as Firestore;

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-coleta-full",
    firestore: { host, port: Number(porta), rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });

const baixa = (db: Firestore, remessa: string, productId: string, data: string, quantidade: number) =>
  setDoc(doc(db, "estoque_movimentos", movIdRemessa(remessa, productId)), {
    id: movIdRemessa(remessa, productId), productId, tipo: "saida_full", quantidade, data,
  });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore() as unknown as Firestore;
    await setDoc(doc(db, "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
    await setDoc(doc(db, "controleAcesso", MEMBRO.email), { email: MEMBRO.email, role: "member" });

    // Agosto: já fora da janela do ML. Custo salvo COM data (fluxo novo).
    await setDoc(doc(db, "full_remessas", "A1"), { remessa: "A1", custoManual: 97.38, data: "2026-08-06", recebido: 120 });
    await baixa(db, "A1", "p1", "2026-08-06", 120);
    // Custo digitado ANTES de a data existir (legado): a data só se acha pela baixa, em OUTRO mês que o do período pedido.
    await setDoc(doc(db, "full_remessas", "L1"), { remessa: "L1", custoManual: 40 });
    await baixa(db, "L1", "p1", "2026-08-20", 30);
    await baixa(db, "L1", "p2", "2026-08-20", 25);
    // Remessa com baixa e sem custo: pendência.
    await baixa(db, "P1", "p1", "2026-08-25", 10);
    // Setembro, outro mês.
    await setDoc(doc(db, "full_remessas", "S1"), { remessa: "S1", custoManual: 11, data: "2026-09-02", recebido: 5 });
    // Custo legado sem data e SEM baixa em lugar nenhum: sem data conhecida.
    await setDoc(doc(db, "full_remessas", "X9"), { remessa: "X9", custoManual: 7 });
    // Documento só de "ignorada": não é custo.
    await setDoc(doc(db, "full_remessas", "I1"), { remessa: "I1", ignorada: true, motivo: "baixa já lançada à mão" });
    // Movimento que não é de remessa do Full.
    await setDoc(doc(db, "estoque_movimentos", "mov-qualquer"), { id: "mov-qualquer", productId: "p1", tipo: "entrada", quantidade: 9, data: "2026-08-10" });
  });
});

const AGOSTO = { from: "2026-08-01", to: "2026-08-31" };

describe("coleta pro Full só com o Firestore (ML fora do ar ou período antigo)", () => {
  it("agosto inteiro: custo com data, custo legado datado pela baixa, e a remessa sem custo como pendência", async () => {
    const fonte = await lerFonteDaColeta(ctx(), AGOSTO);
    const r = montarColetaFull({ periodo: AGOSTO, api: null, motivoSemApi: "fora_da_janela", ...fonte });
    expect(r.todas.map((x) => [x.remessa, x.data, x.custo, x.recebido])).toEqual([
      ["P1", "2026-08-25", null, 10],
      ["L1", "2026-08-20", 40, 55],
      ["A1", "2026-08-06", 97.38, 120],
    ]);
    expect(r).toMatchObject({ total: 137.38, pendentes: 1, parcial: true, foraDaJanela: true, mlFalhou: false });
  });

  it("o custo legado cuja baixa é de OUTRO mês não é acusado de 'sem data' (a data existe)", async () => {
    const SETEMBRO = { from: "2026-09-01", to: "2026-09-30" };
    const fonte = await lerFonteDaColeta(ctx(), SETEMBRO);
    const r = montarColetaFull({ periodo: SETEMBRO, api: [], ...fonte });
    expect(r.todas.map((x) => x.remessa)).toEqual(["S1"]);
    // L1 tem data (pela baixa de agosto) → não é "sem data". X9 não tem de onde → é.
    expect(r.semData).toEqual([{ remessa: "X9", custo: 7 }]);
    expect(r.total).toBe(11);
  });

  it("o doc só de 'ignorada' e o movimento que não é de Full não viram coleta", async () => {
    const fonte = await lerFonteDaColeta(ctx(), AGOSTO);
    expect(fonte.baixas.map((b) => b.remessa).sort()).toEqual(["A1", "L1", "L1", "P1"]);
    const r = montarColetaFull({ periodo: AGOSTO, api: [], ...fonte });
    expect(r.todas.some((x) => x.remessa === "I1")).toBe(false);
  });

  it("com o ML respondendo, o custo digitado continua entrando por cima do que ele devolve", async () => {
    const fonte = await lerFonteDaColeta(ctx(), AGOSTO);
    const r = montarColetaFull({
      periodo: AGOSTO,
      api: [{ remessa: "P1", data: "2026-08-25", recebido: 10, custo: null }, { remessa: "A1", data: "2026-08-06", recebido: 120, custo: 90 }],
      ...fonte,
    });
    // A1: o valor do ML (90) manda sobre o digitado (97,38); L1 e P1 seguem.
    expect(r.todas.find((x) => x.remessa === "A1")?.custo).toBe(90);
    expect(r.total).toBe(130);
  });

  it("quem não vê operação (member) não lê nada — as regras seguem valendo", async () => {
    await assertFails(lerFonteDaColeta(ctx(MEMBRO), AGOSTO));
  });
});
