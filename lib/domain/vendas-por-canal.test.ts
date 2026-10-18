import { describe, expect, it } from "vitest";
import { vendasPorCanal, type ProdutoParaCanal, type VendaDoAnuncio } from "./vendas-por-canal";

const v = (item_id: string, bruto: number, qty: number, pedidos = 1, title = item_id): VendaDoAnuncio => ({ item_id, title, bruto, qty, pedidos });
const logistica = (mapa: Record<string, string>) => (id: string) => mapa[id.toUpperCase().replace(/^MLB/, "")] ?? mapa[id];

const limaoFull: ProdutoParaCanal = { id: "f", name: "Limão Caipira", sku: "LimaoCaipira", grupo: "Limão Caipira", canal: "full", mlbs: ["MLB111"] };
const limaoAg: ProdutoParaCanal = { id: "a", name: "Limão Caipira Agências", sku: "LimaoCaipiraAgencias", grupo: "Limão Caipira", canal: "agencias", mlbs: ["MLB222"] };
const menta: ProdutoParaCanal = { id: "m", name: "Menta", sku: "Menta", mlbs: ["MLB333"] };

describe("o mesmo produto, dois anúncios: Full + agências + total", () => {
  const r = vendasPorCanal(
    [v("MLB111", 1000, 100, 40), v("MLB222", 600, 60, 25)],
    [limaoFull, limaoAg],
    logistica({ "111": "fulfillment", "222": "xd_drop_off" }),
  );
  it("uma linha só pro grupo, com cada canal e o total", () => {
    expect(r.linhas).toHaveLength(1);
    const l = r.linhas[0];
    expect(l.nome).toBe("Limão Caipira");
    expect(l.full).toEqual({ valor: 1000, unidades: 100, pedidos: 40 });
    expect(l.agencias).toEqual({ valor: 600, unidades: 60, pedidos: 25 });
    expect(l.total).toEqual({ valor: 1600, unidades: 160, pedidos: 65 });
    expect(l.agrupado).toBe(true);
    expect(l.pctAgencias).toBeCloseTo(37.5, 5);
  });
  it("os totais gerais batem com a soma das linhas", () => {
    expect(r.total.valor).toBe(1600);
    expect(r.full.valor + r.agencias.valor + r.semCanal.valor).toBe(r.total.valor);
  });
});

describe("o canal vem do anúncio, não do cadastro", () => {
  it("produto cadastrado como agências cujo anúncio é Full vende no Full", () => {
    const r = vendasPorCanal([v("MLB222", 500, 5)], [limaoAg], logistica({ "222": "fulfillment" }));
    expect(r.full.valor).toBe(500);
    expect(r.agencias.valor).toBe(0);
  });
  it("sem resposta do ML, vale o canal do cadastro", () => {
    const r = vendasPorCanal([v("MLB222", 500, 5)], [limaoAg], () => undefined);
    expect(r.agencias.valor).toBe(500);
  });
  it("sem nenhum dos dois: 'sem canal', à parte — não vai pra um lado por chute", () => {
    const r = vendasPorCanal([v("MLB333", 200, 2)], [menta], () => undefined);
    expect(r.semCanal.valor).toBe(200);
    expect(r.full.valor + r.agencias.valor).toBe(0);
    expect(r.linhas[0].pctAgencias).toBeNull();
  });
});

describe("o que não está no cadastro", () => {
  it("anúncio sem produto vinculado vira uma linha própria, com o título, e o canal vem do ML", () => {
    const r = vendasPorCanal([v("MLB999", 300, 3, 3, "Suporte avulso")], [limaoFull], logistica({ "999": "xd_drop_off" }));
    expect(r.linhas[0].nome).toBe("Suporte avulso");
    expect(r.linhas[0].agencias.valor).toBe(300);
    expect(r.linhas[0].agrupado).toBe(false);
  });
  it("a venda é achada por SKU quando o pedido não trouxe o id do anúncio", () => {
    const r = vendasPorCanal([v("limaocaipira", 80, 1)], [limaoFull], () => undefined);
    expect(r.linhas[0].nome).toBe("Limão Caipira");
    expect(r.full.valor).toBe(80); // canal do cadastro
  });
  it("'MLB123' e '123' são o mesmo anúncio", () => {
    const r = vendasPorCanal([v("111", 10, 1)], [limaoFull], () => undefined);
    expect(r.linhas[0].nome).toBe("Limão Caipira");
  });
  it("anúncio ligado a dois produtos é ambíguo: não vai pro primeiro que aparece", () => {
    const dup: ProdutoParaCanal = { id: "x", name: "Outro", mlbs: ["MLB111"] };
    const r = vendasPorCanal([v("MLB111", 50, 1, 1, "Anúncio duplicado")], [limaoFull, dup], () => undefined);
    expect(r.linhas[0].nome).toBe("Anúncio duplicado");
  });
});

describe("a soma sempre fecha", () => {
  it("vários grupos: o total geral é a soma das vendas de entrada, sem perder nem duplicar", () => {
    const vendas = [v("MLB111", 100, 1), v("MLB222", 50, 1), v("MLB333", 30, 1), v("MLB999", 20, 1)];
    const r = vendasPorCanal(vendas, [limaoFull, limaoAg, menta], logistica({ "111": "fulfillment", "222": "x", "333": "x" }));
    expect(r.total.valor).toBe(200);
    expect(r.linhas.reduce((s, l) => s + l.total.valor, 0)).toBe(200);
    expect(r.linhas.map((l) => l.nome)).toEqual(["Limão Caipira", "Menta", "MLB999"]);
  });
  it("sem vendas: nada", () => {
    const r = vendasPorCanal([], [limaoFull], () => undefined);
    expect(r.linhas).toEqual([]);
    expect(r.total.valor).toBe(0);
  });
  it("ordena pelo maior total", () => {
    const r = vendasPorCanal([v("MLB333", 10, 1), v("MLB111", 90, 1)], [limaoFull, menta], () => undefined);
    expect(r.linhas.map((l) => l.nome)).toEqual(["Limão Caipira", "Menta"]);
  });
});

describe("o perdido acompanha o grupo", () => {
  it("soma o cancelado/devolvido dos dois anúncios, fora do bruto", () => {
    const r = vendasPorCanal(
      [{ ...v("MLB111", 1000, 100, 40), perdido: 50 }, { ...v("MLB222", 600, 60, 25), perdido: 30 }],
      [limaoFull, limaoAg], () => undefined,
    );
    expect(r.linhas[0].perdido).toBe(80);
    expect(r.total.valor).toBe(1600);
  });
  it("sem o campo, perdido é zero", () => {
    expect(vendasPorCanal([v("MLB111", 10, 1)], [limaoFull], () => undefined).linhas[0].perdido).toBe(0);
  });
});

describe("SKU trocado", () => {
  it("venda antiga com o SKU anterior continua no produto certo", () => {
    const p = { ...limaoFull, mlbs: [], sku: "LimaoCaipiraFull", skusAnteriores: ["LimaoCaipira"] };
    const r = vendasPorCanal([v("limaocaipira", 30, 3)], [p], () => undefined);
    expect(r.linhas[0].nome).toBe("Limão Caipira");
  });
  it("o SKU ATUAL de outro produto vence o anterior", () => {
    const a = { ...limaoFull, id: "a", mlbs: [], sku: "Novo", skusAnteriores: ["Menta"] };
    const r = vendasPorCanal([v("menta", 10, 1)], [a, menta], () => undefined);
    expect(r.linhas[0].nome).toBe("Menta");
  });
});
