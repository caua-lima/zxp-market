import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { custoNaData, impostoNaData } from "./types";

/**
 * Toda rota que calcula lucro usa o custo VIGENTE NA DATA DA VENDA?
 *
 * ─── O BUG QUE ISTO GUARDA ───────────────────────────────────────────────
 *
 * A rota de Ads lia `custoMedio` e `imposto` como escalares — os valores de
 * HOJE — e os aplicava a toda venda do período. Quem comprou mais barato em
 * março aparecia com a margem de hoje, e ajustar o custo médio de um produto
 * reescrevia o lucro de meses já fechados.
 *
 * E só nessa aba: `order-finance` (notificação de venda) e a rota de métricas
 * (Dashboard e DRE) já usavam `custoNaData`. Duas telas mostravam margens
 * diferentes pro MESMO pedido, e a divergência só aparecia depois de alguém
 * mexer no cadastro.
 *
 * ─── POR QUE UM TESTE DE TEXTO ───────────────────────────────────────────
 *
 * Estas rotas são handlers do Next que leem o Firestore com o Admin SDK:
 * exercitá-las de verdade exige credencial e rede, e nenhuma das duas tem
 * lugar num teste unitário.
 *
 * O que dá pra afirmar sem isso é mais modesto e ainda assim é o que falhou:
 * que a regra não foi reescrita à mão dentro do arquivo. Um teste que lê o
 * código não prova que a conta está certa — prova que ela não foi duplicada,
 * e duplicação foi exatamente o defeito.
 */

const RAIZ = process.cwd();

/** Rotas que transformam venda em lucro. Todas precisam datar o custo. */
const ROTAS_FINANCEIRAS = [
  "app/api/ml/ads/route.ts",
  "app/api/ml/metrics/route.ts",
  "lib/ml/order-finance.ts",
];

function fonte(rel: string): string {
  return fs.readFileSync(path.join(RAIZ, rel), "utf8");
}

describe("custo e imposto históricos", () => {
  it.each(ROTAS_FINANCEIRAS)("%s usa custoNaData e impostoNaData", (rel) => {
    const s = fonte(rel);
    expect(s, `${rel} não chama custoNaData`).toContain("custoNaData(");
    expect(s, `${rel} não chama impostoNaData`).toContain("impostoNaData(");
  });

  it.each(ROTAS_FINANCEIRAS)("%s não multiplica um custo escalar direto", (rel) => {
    const s = fonte(rel);
    // `prod.custo * qty` e `prod.imposto / 100` são as formas exatas que a
    // rota de Ads usava. Qualquer uma delas de volta significa que o valor de
    // hoje voltou a ser aplicado em venda antiga.
    expect(s).not.toMatch(/\bprod\.custo\s*\*/);
    expect(s).not.toMatch(/\bprod\.imposto\s*\//);
  });
});

/**
 * E as funções em si continuam respeitando a data — este é o teste que de
 * fato exercita a regra, e não o texto do arquivo.
 */
describe("custoNaData / impostoNaData", () => {
  const produto = {
    custoMedio: 50,
    custoMedioFaixas: [
      { desde: "2026-01-01", custo: 30 },
      { desde: "2026-06-01", custo: 50 },
    ],
    imposto: 8,
    impostoFaixas: [
      { desde: "2026-01-01", pct: 4 },
      { desde: "2026-06-01", pct: 8 },
    ],
  };

  it("venda antiga usa o custo antigo, não o de hoje", () => {
    expect(custoNaData(produto, "2026-03-15")).toBe(30);
    expect(custoNaData(produto, "2026-09-15")).toBe(50);
  });

  it("venda antiga usa a alíquota antiga", () => {
    expect(impostoNaData(produto, "2026-03-15")).toBe(4);
    expect(impostoNaData(produto, "2026-09-15")).toBe(8);
  });

  it("exatamente no dia da virada, vale a faixa nova", () => {
    expect(custoNaData(produto, "2026-06-01")).toBe(50);
    expect(impostoNaData(produto, "2026-06-01")).toBe(8);
  });

  it("sem faixas, cai no valor atual — comportamento de produto sem histórico", () => {
    expect(custoNaData({ custoMedio: 42 }, "2026-03-15")).toBe(42);
    expect(impostoNaData({ imposto: 6 }, "2026-03-15")).toBe(6);
  });
});
