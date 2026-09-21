import { describe, it, expect } from "vitest";
import {
  alternarOrdem, ariaSort, descreverOrdem, escolherColuna, ordenarLinhas, ORDEM_INICIAL, ORDEM_DAS_OPCOES, COLUNAS_ORDENAVEIS,
  type LinhaOrdenavel, type OrdemAds,
} from "./ads-ordenacao";

type L = LinhaOrdenavel & { id: string };

const linha = (id: string, o: Partial<{ cost: number; campanha: string; lucro: number | null; roas: number | null; margem: number | null; alvo: number; vendas: number; pct: number }> = {}): L => ({
  id,
  i: { cost: o.cost ?? 100, campaignName: o.campanha ?? "Campanha", roasTarget: o.alvo ?? 0, totalSales: o.vendas ?? 1 },
  lucroAtual: o.lucro === undefined ? 10 : o.lucro,
  roasMlAds: o.roas === undefined ? 5 : o.roas,
  margemAtual: o.margem === undefined ? 20 : o.margem,
  pctAds: o.pct ?? 50,
});
const ids = (ls: L[]) => ls.map((l) => l.id);

describe("ordenarLinhas — o critério pedido, no sentido pedido", () => {
  const base = [
    linha("a", { cost: 300, lucro: -40, roas: 2 }),
    linha("b", { cost: 100, lucro: 90, roas: 8 }),
    linha("c", { cost: 200, lucro: 10, roas: 5 }),
  ];

  it("investimento: do maior pro menor por padrão", () => {
    expect(ids(ordenarLinhas(base, ORDEM_INICIAL))).toEqual(["a", "c", "b"]);
  });
  it("lucro crescente põe o prejuízo no topo", () => {
    expect(ids(ordenarLinhas(base, { col: "lucro", dir: 1 }))).toEqual(["a", "c", "b"]);
  });
  it("ROAS decrescente e crescente são espelhos", () => {
    expect(ids(ordenarLinhas(base, { col: "roas", dir: -1 }))).toEqual(["b", "c", "a"]);
    expect(ids(ordenarLinhas(base, { col: "roas", dir: 1 }))).toEqual(["a", "c", "b"]);
  });
  it("não muda o array recebido", () => {
    const copia = ids(base);
    ordenarLinhas(base, { col: "roas", dir: 1 });
    expect(ids(base)).toEqual(copia);
  });
});

describe("dado ausente vai pro FIM nos dois sentidos", () => {
  const base = [linha("sem", { roas: null }), linha("baixo", { roas: 1 }), linha("alto", { roas: 9 })];
  it("decrescente", () => expect(ids(ordenarLinhas(base, { col: "roas", dir: -1 })).at(-1)).toBe("sem"));
  it("crescente", () => expect(ids(ordenarLinhas(base, { col: "roas", dir: 1 })).at(-1)).toBe("sem"));
  it("sem meta de ROAS não posa de meta zero", () => {
    const ls = [linha("sem-meta", { alvo: 0 }), linha("meta", { alvo: 3 })];
    expect(ids(ordenarLinhas(ls, { col: "roasobj", dir: 1 })).at(-1)).toBe("sem-meta");
  });
  it("sem venda não vira 0% de dependência do Ads", () => {
    const ls = [linha("sem-venda", { vendas: 0, pct: 0 }), linha("dep", { vendas: 5, pct: 30 })];
    expect(ids(ordenarLinhas(ls, { col: "viaads", dir: 1 })).at(-1)).toBe("sem-venda");
  });
});

describe("campanha agrupa a mesma verba e desempata pelo maior investimento", () => {
  const base = [
    linha("b1", { campanha: "Beta", cost: 50 }),
    linha("a1", { campanha: "Alfa", cost: 10 }),
    linha("a2", { campanha: "Alfa", cost: 90 }),
  ];
  it("A a Z", () => expect(ids(ordenarLinhas(base, { col: "campanha", dir: 1 }))).toEqual(["a2", "a1", "b1"]));
  it("Z a A", () => expect(ids(ordenarLinhas(base, { col: "campanha", dir: -1 }))).toEqual(["b1", "a2", "a1"]));
});

describe("o sentido é dito do jeito certo (o aria-sort estava invertido nas colunas numéricas)", () => {
  it("investimento, do maior pro menor, é DESCENDING", () => {
    expect(ariaSort(ORDEM_INICIAL, "investido")).toBe("descending");
  });
  it("campanha A a Z é ASCENDING", () => {
    expect(ariaSort({ col: "campanha", dir: 1 }, "campanha")).toBe("ascending");
  });
  it("coluna que não é a ativa não anuncia sentido", () => {
    expect(ariaSort(ORDEM_INICIAL, "roas")).toBe("none");
  });
  it("o texto por extenso acompanha o sentido", () => {
    expect(descreverOrdem({ col: "investido", dir: -1 })).toBe("Investido — maior primeiro");
    expect(descreverOrdem({ col: "campanha", dir: 1 })).toBe("Campanha — A a Z");
  });
});

describe("alternar e escolher", () => {
  it("clicar na coluna ativa inverte o sentido", () => {
    expect(alternarOrdem({ col: "roas", dir: -1 }, "roas")).toEqual({ col: "roas", dir: 1 });
  });
  it("outra coluna começa no sentido padrão dela", () => {
    expect(alternarOrdem({ col: "roas", dir: 1 }, "campanha")).toEqual({ col: "campanha", dir: 1 });
    expect(alternarOrdem({ col: "campanha", dir: 1 }, "lucro")).toEqual({ col: "lucro", dir: -1 });
  });
  it("o seletor, ao repetir o critério atual, não desfaz o sentido escolhido", () => {
    const o: OrdemAds = { col: "roas", dir: 1 };
    expect(escolherColuna(o, "roas")).toBe(o);
  });
  it("toda coluna tem rótulo e aparece no seletor", () => {
    expect(new Set(ORDEM_DAS_OPCOES)).toEqual(new Set(Object.keys(COLUNAS_ORDENAVEIS)));
    for (const c of ORDEM_DAS_OPCOES) expect(COLUNAS_ORDENAVEIS[c].rotulo.length).toBeGreaterThan(0);
  });
});
