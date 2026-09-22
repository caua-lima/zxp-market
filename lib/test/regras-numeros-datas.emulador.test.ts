import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

/**
 * Achado S21 da auditoria SaaS: `valorAceitavel` aceitava QUALQUER combinação
 * de dígito/ponto/vírgula ("...", ",,,", "1.2.3.4,5,6") e `dataAceitavel`
 * aceitava qualquer par de dígitos no lugar do mês/dia ("2026-99-99") — a
 * FORMA estava certa, o VALOR não. Testado contra o emulador REAL: uma regra
 * que não roda não prova nada.
 */

let env: RulesTestEnvironment;
const DONO = { uid: "uid-dono", email: "dono@zxp.com" };
const ctx = () => env.authenticatedContext(DONO.uid, { email: DONO.email }).firestore();

beforeAll(async () => {
  const [host, porta] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8199").split(":");
  env = await initializeTestEnvironment({
    projectId: "zxp-teste-numeros",
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
    await setDoc(doc(c.firestore(), "controleAcesso", DONO.email), { email: DONO.email, role: "owner" });
  });
});

const custo = (over: Record<string, unknown> = {}) => ({
  nome: "Aluguel", valor: "1.234,56", freq: "mensal", data: "2026-09-01", ...over,
});

describe("valorAceitavel — dinheiro em texto (S21)", () => {
  it("formatos de verdade continuam aceitos: BR com milhar, BR sem milhar, plano, inteiro", async () => {
    for (const [i, valor] of ["1.234,56", "1234,56", "1234.56", "1234", "1.234.567,89"].entries()) {
      await assertSucceeds(setDoc(doc(ctx(), "custos", `ok-${i}`), custo({ valor })));
    }
  });

  it("lixo com a FORMA certa (só dígito/ponto/vírgula) e o VALOR errado é recusado", async () => {
    for (const [i, valor] of ["...", ",,,", "1.2.3.4,5,6", "1..2", ".5", ","].entries()) {
      await assertFails(setDoc(doc(ctx(), "custos", `ruim-${i}`), custo({ valor })));
    }
  });
});

describe("dataAceitavel — mês e dia dentro da faixa (S21)", () => {
  it("datas ISO e BR de verdade continuam aceitas", async () => {
    for (const [i, data] of ["2026-09-22", "2026-01-01", "2026-12-31", "22/09/2026"].entries()) {
      await assertSucceeds(setDoc(doc(ctx(), "custos", `ok-${i}`), custo({ data })));
    }
  });

  it("mês ou dia fora da faixa — a forma certa, o valor errado — é recusado", async () => {
    // Reprodução exata do achado: "2026-99-99" tinha a FORMA de data ISO.
    for (const [i, data] of ["2026-99-99", "2026-13-01", "2026-01-32", "2026-00-01", "2026-01-00"].entries()) {
      await assertFails(setDoc(doc(ctx(), "custos", `ruim-${i}`), custo({ data })));
    }
  });
});
