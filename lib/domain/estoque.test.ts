import { describe, expect, it } from "vitest";
import { mediaDiariaAjustada } from "./reposicao";
import { calculateStockCoverage, consolidarEstoqueAnuncios, estoqueForaDoFull, type AnuncioEstoque } from "./estoque";

function full(available: number, inventoryId?: string): AnuncioEstoque {
  return { available, logistic: "fulfillment", inventoryId };
}
function proprio(available: number): AnuncioEstoque {
  return { available, logistic: "drop_off" };
}

describe("consolidarEstoqueAnuncios — Full compartilhado entre anúncios", () => {
  it("dois anuncios no MESMO pool contam uma vez, nao o dobro", () => {
    // Caso real: Erva Tradicional tinha 148 un no Full e o painel mostrava 296.
    const r = consolidarEstoqueAnuncios([full(148, "INV-1"), full(148, "INV-1")]);
    expect(r.full).toBe(148);
    expect(r.fullCompartilhado).toBe(true);
  });

  it("pools DIFERENTES somam — sao estoques de verdade separados", () => {
    const r = consolidarEstoqueAnuncios([full(100, "INV-1"), full(40, "INV-2")]);
    expect(r.full).toBe(140);
    expect(r.fullCompartilhado).toBe(false);
  });

  it("sem inventoryId nao deduplica no escuro — conta cada um", () => {
    // Preferir inflar (visível, o dono reclama) a sumir com estoque real
    // (silencioso, ninguem percebe ate faltar produto).
    const r = consolidarEstoqueAnuncios([full(50), full(30)]);
    expect(r.full).toBe(80);
    expect(r.fullCompartilhado).toBe(false);
  });

  it("mistura Full e proprio separa os dois baldes", () => {
    const r = consolidarEstoqueAnuncios([full(148, "INV-1"), full(148, "INV-1"), proprio(25)]);
    expect(r.full).toBe(148);
    expect(r.proprio).toBe(25);
    expect(r.ehFull).toBe(true);
  });

  it("so anuncio proprio nao marca ehFull", () => {
    const r = consolidarEstoqueAnuncios([proprio(30), proprio(12)]);
    expect(r.ehFull).toBe(false);
    /**
     * Este teste esperava 42 (a soma) e cristalizava um BUG: os dois anuncios
     * proprios vendem do MESMO galpao, entao 30 e 12 nunca foram 42 unidades
     * fisicas — sao 30, com um anuncio aceitando vender ate 12 delas. Corrigido
     * junto com a armadilha 3 documentada em estoque.ts.
     */
    expect(r.proprio).toBe(30);
    expect(r.full).toBe(0);
  });

  it("lista vazia = ML ainda nao respondeu, nao 'zero estoque'", () => {
    const r = consolidarEstoqueAnuncios([]);
    expect(r.temDado).toBe(false);
    expect(r.full).toBe(0);
  });
});

describe("estoqueForaDoFull — casa e agencia sao o mesmo galpao", () => {
  it("COM Full: usa o livro e IGNORA o anuncio proprio (mesma unidade)", () => {
    // Erva Tradicional: 189 em casa, 25 expostos no anuncio da agencia.
    // O total fora do Full e 189, nao 214.
    expect(estoqueForaDoFull(189, 25, true)).toBe(189);
  });

  it("SEM Full: usa o anuncio, porque o livro nunca desce com venda", () => {
    expect(estoqueForaDoFull(500, 30, false)).toBe(30);
  });

  it("casa negativa (livro furado) nao vira desconto no total", () => {
    expect(estoqueForaDoFull(-5, 10, true)).toBe(0);
  });
});

describe("total consolidado — o numero que o dono confere", () => {
  it("Erva Tradicional: 148 no Full + 189 em casa = 337 (antes dava 510)", () => {
    const c = consolidarEstoqueAnuncios([full(148, "INV-1"), full(148, "INV-1"), proprio(25)]);
    const total = c.full + estoqueForaDoFull(189, c.proprio, c.ehFull);
    expect(total).toBe(337);
  });
});

describe("dois anuncios PROPRIOS dividem o mesmo galpao", () => {
  /**
   * Caso real relatado: 18 unidades em casa, anunciadas em DOIS anuncios
   * proprios com 18 cada — pra nao partir 9 e 9 e perder venda nos dois. O
   * painel mostrava 36 un, estoque que nunca existiu.
   */
  it("18 + 18 em dois anuncios proprios continua 18", () => {
    const r = consolidarEstoqueAnuncios([
      { available: 18, logistic: "" },
      { available: 18, logistic: "" },
    ]);
    expect(r.proprio).toBe(18);
    expect(r.proprioCompartilhado).toBe(true);
  });

  it("declaracoes diferentes usam a MAIOR — e o piso confiavel do monte", () => {
    const r = consolidarEstoqueAnuncios([
      { available: 18, logistic: "" },
      { available: 10, logistic: "" },
    ]);
    expect(r.proprio).toBe(18);
  });

  it("anuncio proprio unico nao muda nada", () => {
    const r = consolidarEstoqueAnuncios([{ available: 18, logistic: "" }]);
    expect(r.proprio).toBe(18);
    expect(r.proprioCompartilhado).toBe(false);
  });

  it("nao contamina o Full: pools distintos continuam SOMANDO", () => {
    // Full e o oposto do proprio — la cada inventory_id e um monte fisico
    // separado no centro de distribuicao, entao somar e o correto.
    const r = consolidarEstoqueAnuncios([
      { available: 40, logistic: "fulfillment", inventoryId: "inv-A" },
      { available: 25, logistic: "fulfillment", inventoryId: "inv-B" },
    ]);
    expect(r.full).toBe(65);
    expect(r.fullCompartilhado).toBe(false);
  });

  it("Full e proprio no mesmo produto seguem independentes", () => {
    const r = consolidarEstoqueAnuncios([
      { available: 65, logistic: "fulfillment", inventoryId: "inv-A" },
      { available: 24, logistic: "" },
      { available: 24, logistic: "" },
    ]);
    expect(r.full).toBe(65);
    expect(r.proprio).toBe(24); // nao 48
    expect(r.ehFull).toBe(true);
    expect(r.proprioCompartilhado).toBe(true);
  });

  it("com Full presente, o proprio nem entra no total (estoqueForaDoFull manda no livro)", () => {
    // Reforca que a mudanca acima nao altera o caminho COM Full: la o livro
    // de movimentacoes (casa) e a fonte, e o proprio e so uma fatia dele.
    const r = consolidarEstoqueAnuncios([
      { available: 65, logistic: "fulfillment", inventoryId: "inv-A" },
      { available: 24, logistic: "" },
    ]);
    expect(estoqueForaDoFull(36, r.proprio, r.ehFull)).toBe(36);
  });

  it("sem anuncio nenhum, proprio e zero e nao ha compartilhamento", () => {
    const r = consolidarEstoqueAnuncios([]);
    expect(r.proprio).toBe(0);
    expect(r.proprioCompartilhado).toBe(false);
    expect(r.temDado).toBe(false);
  });
});

describe("calculateStockCoverage — dias ativos", () => {
  it("anuncio pausado metade do mes tem cobertura MENOR, nao maior", () => {
    /**
     * O Dashboard descartava `diasAtivos` e dividia pela janela cheia; a aba
     * Estoque dividia pelos dias em que o anuncio esteve no ar. Dividir pela
     * janela cheia da um ritmo menor, logo uma cobertura maior — o painel
     * "Produtos em risco" era o que subestimava o risco.
     *
     * 30 vendas em 30 dias de janela, mas so 15 dias no ar:
     *   janela cheia: 1/dia  -> 60 unidades duram 60 dias
     *   dias ativos:  2/dia  -> 60 unidades duram 30 dias
     */
    expect(calculateStockCoverage(60, 30, 30)).toBe(60);
    expect(calculateStockCoverage(60, 30, 30, 15)).toBe(30);
  });

  it("sem diasAtivos, continua igual ao comportamento anterior", () => {
    expect(calculateStockCoverage(60, 30, 30, null)).toBe(60);
    expect(calculateStockCoverage(60, 30, 30, undefined)).toBe(60);
    expect(calculateStockCoverage(60, 30, 30, 0)).toBe(60);
  });

  it("diasAtivos maior que a janela nao dilui a media", () => {
    // Dado inconsistente; aceitar espalharia as vendas por dias que nao existiram.
    expect(calculateStockCoverage(60, 30, 30, 90)).toBe(60);
  });

  it("sem venda no periodo nao ha cobertura calculavel", () => {
    expect(calculateStockCoverage(60, 0, 30, 15)).toBeNull();
  });

  it("a cobertura concorda com mediaDiariaAjustada, que a aba Estoque usa", () => {
    // As duas telas tem que dar a MESMA resposta pro mesmo produto.
    const estoque = 100, vendas = 45, dias = 30, ativos = 18;
    const ritmo = mediaDiariaAjustada(vendas, dias, ativos);
    expect(calculateStockCoverage(estoque, vendas, dias, ativos)).toBeCloseTo(estoque / ritmo, 6);
  });
});
