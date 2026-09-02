import { describe, expect, it } from "vitest";
import {
  duracaoDoEstoque,
  montarPlanoReposicao,
  mediaDiariaAjustada,
  necessarioParaJanela,
  situacaoDoEstoque,
  type ProdutoReposicao,
} from "./reposicao";

const prod = (over: Partial<ProdutoReposicao> = {}): ProdutoReposicao => ({
  id: "p1", nome: "Erva Tradicional", estoqueTotal: 60, emCasa: 0,
  mediaDiaria: 2, custoUnitario: 10, ativo: true, ...over,
});

describe("duracaoDoEstoque", () => {
  it("60 unidades a 2 por dia duram 30 dias", () => {
    expect(duracaoDoEstoque(60, 2)).toBe(30);
  });

  it("arredonda pra BAIXO — dia parcial não é dia coberto", () => {
    expect(duracaoDoEstoque(10, 3)).toBe(3);
  });

  it("sem ritmo de venda não dá pra dizer quanto dura", () => {
    // null, e não Infinity: "não sei" não é "dura pra sempre".
    expect(duracaoDoEstoque(100, 0)).toBeNull();
  });

  it("estoque zerado dura zero dias", () => {
    expect(duracaoDoEstoque(0, 5)).toBe(0);
  });
});

describe("necessarioParaJanela", () => {
  it("arredonda pra CIMA — faltar custa mais que sobrar", () => {
    expect(necessarioParaJanela(2.41, 30)).toBe(73); // 72,3 → 73
  });

  it("sem venda não há necessidade a projetar", () => {
    expect(necessarioParaJanela(0, 30)).toBe(0);
  });
});

/**
 * O caso que o usuário descreveu: 60 unidades e o estoque deve durar 30 dias.
 */
describe("60 unidades, alvo de 30 dias", () => {
  it("sem folga, o estoque termina EXATAMENTE no dia 30 — e é isso que zera o Full", () => {
    /**
     * A média é média: metade dos dias vende acima dela. Comprar pro estoque
     * bater zero no dia do alvo significa que qualquer semana boa antecipa a
     * ruptura. Por isso folga zero é permitido mas não é o padrão.
     */
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 60, mediaDiaria: 2 })], 30, 0);
    expect(plano.itens).toEqual([]);          // não precisa comprar nada
    expect(plano.suficientes).toBe(1);
    expect(duracaoDoEstoque(60, 2)).toBe(30); // dura exatamente o alvo
  });

  it("com 7 dias de folga, faltam 14 unidades pra não raspar o zero", () => {
    // 2/dia × (30 + 7) = 74 necessárias; já tem 60 → pedir 14.
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 60, mediaDiaria: 2 })], 30, 7);
    expect(plano.diasACobrir).toBe(37);
    expect(plano.itens[0].necessario).toBe(74);
    expect(plano.itens[0].comprar).toBe(14);
  });

  it("informa quantos dias FALTAM pro alvo — o dado pedido", () => {
    // 40 un a 2/dia = 20 dias. Alvo 30 → faltam 10 dias.
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 40, mediaDiaria: 2 })], 30, 7);
    expect(plano.itens[0].duraDias).toBe(20);
    expect(plano.itens[0].faltamDias).toBe(10);
    expect(plano.itens[0].vaiZerarAntes).toBe(true);
  });

  it("estoque que ALCANÇA o alvo não é marcado como 'vai zerar', mesmo comprando a folga", () => {
    // 60 un dura os 30 do alvo; ainda assim compra 14 pela folga.
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 60, mediaDiaria: 2 })], 30, 7);
    expect(plano.itens[0].faltamDias).toBe(0);
    expect(plano.itens[0].vaiZerarAntes).toBe(false);
    expect(plano.vaoZerar).toEqual([]);
  });

  it("estoque zerado hoje: faltam os 30 dias inteiros", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 0, mediaDiaria: 2 })], 30, 7);
    expect(plano.itens[0].duraDias).toBe(0);
    expect(plano.itens[0].faltamDias).toBe(30);
    expect(plano.itens[0].comprar).toBe(74);
    expect(plano.vaoZerar).toHaveLength(1);
  });
});

describe("o que já está em casa", () => {
  it("separa a parte do pedido que só precisa ir pro Full", () => {
    /**
     * Não muda o quanto comprar — muda o que dá pra fazer HOJE. Mandar do
     * galpão pro Full é mais rápido que esperar o fornecedor.
     */
    const plano = montarPlanoReposicao(
      [prod({ estoqueTotal: 10, emCasa: 30, mediaDiaria: 2 })], 30, 7,
    );
    expect(plano.itens[0].comprar).toBe(64);
    expect(plano.itens[0].jaTemEmCasa).toBe(30);
  });

  it("nunca aponta mais 'em casa' do que o pedido inteiro", () => {
    const plano = montarPlanoReposicao(
      [prod({ estoqueTotal: 70, emCasa: 500, mediaDiaria: 2 })], 30, 7,
    );
    expect(plano.itens[0].comprar).toBe(4);
    expect(plano.itens[0].jaTemEmCasa).toBe(4);
  });
});

describe("ordem da lista", () => {
  it("quem zera antes primeiro, depois quem dura menos", () => {
    const plano = montarPlanoReposicao([
      prod({ id: "folgado", nome: "Folgado", estoqueTotal: 70, mediaDiaria: 2 }), // 35d
      prod({ id: "zerado", nome: "Zerado", estoqueTotal: 0, mediaDiaria: 2 }),    // 0d
      prod({ id: "curto", nome: "Curto", estoqueTotal: 20, mediaDiaria: 2 }),     // 10d
    ], 30, 7);
    expect(plano.itens.map((i) => i.produtoId)).toEqual(["zerado", "curto", "folgado"]);
  });

  it("empate resolve por nome — a lista não pode dançar entre duas leituras", () => {
    const plano = montarPlanoReposicao([
      prod({ id: "b", nome: "Beta", estoqueTotal: 20, mediaDiaria: 1 }),
      prod({ id: "a", nome: "Alfa", estoqueTotal: 20, mediaDiaria: 1 }),
    ], 30, 7);
    expect(plano.itens.map((i) => i.nome)).toEqual(["Alfa", "Beta"]);
  });
});

describe("o que fica de fora", () => {
  it("produto sem venda no período não vira compra chutada", () => {
    const plano = montarPlanoReposicao([prod({ mediaDiaria: 0 })], 30, 7);
    expect(plano.itens).toEqual([]);
    expect(plano.semHistorico).toBe(1);
  });

  it("produto desativado é ignorado por completo", () => {
    const plano = montarPlanoReposicao([prod({ ativo: false, estoqueTotal: 0 })], 30, 7);
    expect(plano.itens).toEqual([]);
    expect(plano.semHistorico).toBe(0);
    expect(plano.suficientes).toBe(0);
  });
});

describe("totais e robustez", () => {
  it("soma unidades e investimento pra dar o tamanho do pedido", () => {
    const plano = montarPlanoReposicao([
      prod({ id: "a", nome: "A", estoqueTotal: 0, mediaDiaria: 1, custoUnitario: 10 }), // 37
      prod({ id: "b", nome: "B", estoqueTotal: 0, mediaDiaria: 2, custoUnitario: 5 }),  // 74
    ], 30, 7);
    expect(plano.totalUnidades).toBe(111);
    expect(plano.totalInvestimento).toBeCloseTo(37 * 10 + 74 * 5, 2);
  });

  it("lista vazia devolve plano vazio, não quebra", () => {
    const plano = montarPlanoReposicao([], 30, 7);
    expect(plano.itens).toEqual([]);
    expect(plano.totalUnidades).toBe(0);
  });

  it("valores inválidos não viram janela negativa", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: 0 })], -5, Number.NaN);
    expect(plano.diasACobrir).toBe(0);
    expect(plano.itens).toEqual([]);
  });

  it("estoque negativo é tratado como zero", () => {
    const plano = montarPlanoReposicao([prod({ estoqueTotal: -10, mediaDiaria: 2 })], 30, 7);
    expect(plano.itens[0].comprar).toBe(74);
  });
});

/**
 * Anúncio pausado parte da janela. O caso do enunciado: ativo nos 10
 * primeiros dias, pausado na segunda dezena, ativo do 20 ao 30 → base de 20
 * dias, não 30.
 */
describe("mediaDiariaAjustada", () => {
  it("usa os dias ATIVOS, não a janela inteira", () => {
    // 20 unidades em 10 dias ativos = 2/dia. Pela janela daria 0,67.
    expect(mediaDiariaAjustada(20, 30, 10)).toBeCloseTo(2, 6);
  });

  it("o caso quebrado: ativo 0-10 e 20-30 são 20 dias de base", () => {
    expect(mediaDiariaAjustada(40, 30, 20)).toBeCloseTo(2, 6);
  });

  it("sem o dado de dias ativos, cai na janela — comportamento de antes", () => {
    expect(mediaDiariaAjustada(30, 30, null)).toBeCloseTo(1, 6);
    expect(mediaDiariaAjustada(30, 30, 0)).toBeCloseTo(1, 6);
    expect(mediaDiariaAjustada(30, 30, undefined)).toBeCloseTo(1, 6);
  });

  it("dias ativos acima da janela é dado inconsistente — usa a janela", () => {
    // Aceitar 60 diluiria a média em dias que não existiram no período.
    expect(mediaDiariaAjustada(30, 30, 60)).toBeCloseTo(1, 6);
  });

  it("sem venda, a média é zero — não importa a base", () => {
    expect(mediaDiariaAjustada(0, 30, 5)).toBe(0);
  });

  it("um único dia ativo é base válida", () => {
    expect(mediaDiariaAjustada(5, 30, 1)).toBeCloseTo(5, 6);
  });

  it("ajustar a média muda o pedido — é o ponto de tudo isto", () => {
    const semAjuste = montarPlanoReposicao(
      [prod({ estoqueTotal: 0, mediaDiaria: mediaDiariaAjustada(20, 30, null) })], 30, 0,
    );
    const comAjuste = montarPlanoReposicao(
      [prod({ estoqueTotal: 0, mediaDiaria: mediaDiariaAjustada(20, 30, 10) })], 30, 0,
    );
    expect(semAjuste.itens[0].comprar).toBe(20); // 0,67/dia × 30
    expect(comAjuste.itens[0].comprar).toBe(60); // 2/dia × 30 — o certo
  });
});

describe("situacaoDoEstoque — a aba com TODOS", () => {
  const base = (over: Partial<ProdutoReposicao & { diasBase: number }> = {}) =>
    ({ ...prod(), diasBase: 30, ...over });

  it("lista quem tem e quem não tem dado, sem excluir ninguém", () => {
    const r = situacaoDoEstoque([
      base({ id: "a", nome: "Com venda", mediaDiaria: 2, estoqueTotal: 60 }),
      base({ id: "b", nome: "Sem venda", mediaDiaria: 0, estoqueTotal: 40 }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.produtoId === "a")!.duraDias).toBe(30);
    expect(r.find((x) => x.produtoId === "b")!.duraDias).toBeNull();
  });

  it("quem dura menos vem primeiro; sem ritmo vai pro fim", () => {
    const r = situacaoDoEstoque([
      base({ id: "semdado", nome: "Sem dado", mediaDiaria: 0 }),
      base({ id: "longo", nome: "Longo", mediaDiaria: 1, estoqueTotal: 100 }),
      base({ id: "curto", nome: "Curto", mediaDiaria: 5, estoqueTotal: 10 }),
    ]);
    expect(r.map((x) => x.produtoId)).toEqual(["curto", "longo", "semdado"]);
  });

  it("guarda a base usada, pra tela poder mostrar de onde veio a média", () => {
    expect(situacaoDoEstoque([base({ diasBase: 12 })])[0].diasBase).toBe(12);
  });

  it("inclui produto desativado, marcado — a aba é 'todos'", () => {
    const r = situacaoDoEstoque([base({ ativo: false })]);
    expect(r).toHaveLength(1);
    expect(r[0].ativo).toBe(false);
  });
});
