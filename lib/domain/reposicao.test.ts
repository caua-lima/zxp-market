import { describe, expect, it } from "vitest";
import {
  duracaoDoEstoque,
  montarPlanoReposicao,
  mediaDiariaAjustada,
  necessarioParaJanela,
  diasEntre,
  fimDaSemanaQueVem,
  planoEnvioAteData,
  planoEnvioParaFull,
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

/**
 * "Tem X em casa e X no Full — quanto tempo o Full dura?"
 *
 * O estoque em casa NÃO segura o Full: se o Full zera com 300 no galpão, o
 * anúncio para do mesmo jeito. A ação aí não é comprar, é despachar.
 */
describe("planoEnvioParaFull", () => {
  const full = (over: Partial<ProdutoReposicao & { noFull: number; ehFull: boolean }> = {}) =>
    ({ ...prod(), noFull: 20, ehFull: true, ...over });

  it("a duração é a do FULL sozinho, ignorando o galpão", () => {
    // 20 no Full a 2/dia = 10 dias, mesmo com 300 em casa.
    const r = planoEnvioParaFull([full({ noFull: 20, emCasa: 300, mediaDiaria: 2 })], 30);
    expect(r.itens[0].duraFull).toBe(10);
    expect(r.itens[0].vaiZerar).toBe(true);
  });

  it("sugere enviar o que falta, limitado ao que existe em casa", () => {
    // Precisa 60 no Full, tem 20 → faltam 40, e há 300 em casa.
    const r = planoEnvioParaFull([full({ noFull: 20, emCasa: 300, mediaDiaria: 2 })], 30);
    expect(r.itens[0].precisaNoFull).toBe(60);
    expect(r.itens[0].enviar).toBe(40);
    expect(r.itens[0].faltaComprar).toBe(0);
  });

  it("o que nem esvaziando o galpão resolve vira COMPRA, separado", () => {
    // Faltam 40 no Full e só há 15 em casa: envia 15, compra 25.
    const r = planoEnvioParaFull([full({ noFull: 20, emCasa: 15, mediaDiaria: 2 })], 30);
    expect(r.itens[0].enviar).toBe(15);
    expect(r.itens[0].faltaComprar).toBe(25);
  });

  it("Full que já cobre o alvo sai da lista — não há envio a organizar", () => {
    const r = planoEnvioParaFull([full({ noFull: 100, emCasa: 50, mediaDiaria: 2 })], 30);
    expect(r.itens).toEqual([]);
  });

  it("sem nada em casa ainda aparece — a informação é que precisa comprar", () => {
    const r = planoEnvioParaFull([full({ noFull: 10, emCasa: 0, mediaDiaria: 2 })], 30);
    expect(r.itens[0].enviar).toBe(0);
    expect(r.itens[0].faltaComprar).toBe(50);
  });

  it("produto sem anúncio Full não entra: não há envio a fazer", () => {
    const r = planoEnvioParaFull([full({ ehFull: false, noFull: 0 })], 30);
    expect(r.itens).toEqual([]);
  });

  it("produto sem venda no período fica de fora — sem ritmo não há prazo", () => {
    expect(planoEnvioParaFull([full({ mediaDiaria: 0 })], 30).itens).toEqual([]);
  });

  it("ordena por quem tem menos dias de Full — é a ordem da coleta", () => {
    const r = planoEnvioParaFull([
      full({ id: "folga", nome: "Folga", noFull: 40, mediaDiaria: 2 }),   // 20d
      full({ id: "zero", nome: "Zero", noFull: 0, mediaDiaria: 2 }),      // 0d
      full({ id: "meio", nome: "Meio", noFull: 20, mediaDiaria: 2 }),     // 10d
    ], 30);
    expect(r.itens.map((i) => i.produtoId)).toEqual(["zero", "meio", "folga"]);
  });

  it("soma o que dá pra despachar hoje e o que ainda precisa chegar", () => {
    const r = planoEnvioParaFull([
      full({ id: "a", nome: "A", noFull: 0, emCasa: 30, mediaDiaria: 1 }),  // precisa 30, envia 30
      full({ id: "b", nome: "B", noFull: 0, emCasa: 10, mediaDiaria: 2 }),  // precisa 60, envia 10, compra 50
    ], 30);
    expect(r.totalAEnviar).toBe(40);
    expect(r.totalAComprar).toBe(50);
  });
});

describe("fimDaSemanaQueVem", () => {
  it("de uma quarta, cai no sábado da semana seguinte", () => {
    // 2026-09-02 é quarta → sábado desta semana é 05, o da que vem é 12.
    expect(fimDaSemanaQueVem("2026-09-02")).toBe("2026-09-12");
  });

  it("de um sábado, vai pro sábado seguinte — não pro mesmo dia", () => {
    // 2026-09-05 é sábado. "Semana que vem" nunca é hoje.
    expect(fimDaSemanaQueVem("2026-09-05")).toBe("2026-09-12");
  });

  it("de um domingo, alcança o sábado 13 dias à frente", () => {
    // 2026-09-06 é domingo, início da semana → sábado da que vem é 19.
    expect(fimDaSemanaQueVem("2026-09-06")).toBe("2026-09-19");
  });

  it("atravessa a virada do mês", () => {
    expect(fimDaSemanaQueVem("2026-09-28")).toBe("2026-10-10");
  });

  it("data inválida devolve vazio em vez de uma data inventada", () => {
    expect(fimDaSemanaQueVem("sei lá")).toBe("");
  });
});

describe("diasEntre", () => {
  it("conta o dia de hoje — 'até amanhã' são dois dias de venda", () => {
    expect(diasEntre("2026-09-02", "2026-09-03")).toBe(2);
  });

  it("mesmo dia é um dia", () => {
    expect(diasEntre("2026-09-02", "2026-09-02")).toBe(1);
  });

  it("data alvo no passado não vira negativo", () => {
    expect(diasEntre("2026-09-10", "2026-09-02")).toBe(0);
  });
});

/**
 * "Quanto enviar pro Full pra durar até o fim da semana que vem."
 */
describe("planoEnvioAteData", () => {
  const full = (over: Partial<ProdutoReposicao & { noFull: number; ehFull: boolean }> = {}) =>
    ({ ...prod(), noFull: 20, emCasa: 200, ehFull: true, ...over });

  it("cobre até a data, contando o TRÂNSITO na janela", () => {
    /**
     * De 02/09 a 12/09 são 11 dias. Com 3 de trânsito, o Full precisa
     * atender 14 dias — porque o que sai hoje só fica vendável no dia 3.
     */
    const r = planoEnvioAteData([full({ noFull: 0, mediaDiaria: 2 })], "2026-09-02", "2026-09-12", 3);
    expect(r.diasAteAlvo).toBe(11);
    expect(r.itens[0].precisaNoFull).toBe(28); // 2 × (11 + 3)
    expect(r.itens[0].enviar).toBe(28);
  });

  it("sem contar o trânsito o número sairia CURTO", () => {
    // Mesma situação com trânsito 0: 22 em vez de 28 — faltariam 6 unidades.
    const semTransito = planoEnvioAteData([full({ noFull: 0, mediaDiaria: 2 })], "2026-09-02", "2026-09-12", 0);
    expect(semTransito.itens[0].precisaNoFull).toBe(22);
  });

  it("desconta o que já está no Full", () => {
    const r = planoEnvioAteData([full({ noFull: 20, mediaDiaria: 2 })], "2026-09-02", "2026-09-12", 3);
    expect(r.itens[0].enviar).toBe(8); // 28 − 20
  });

  it("o galpão é o teto: o resto vira compra", () => {
    const r = planoEnvioAteData([full({ noFull: 0, emCasa: 10, mediaDiaria: 2 })], "2026-09-02", "2026-09-12", 3);
    expect(r.itens[0].enviar).toBe(10);
    expect(r.itens[0].faltaComprar).toBe(18);
  });

  it("Full que já cobre a data sai da lista", () => {
    const r = planoEnvioAteData([full({ noFull: 100, mediaDiaria: 2 })], "2026-09-02", "2026-09-12", 3);
    expect(r.itens).toEqual([]);
  });

  it("marca quem NÃO chega na data com o Full de hoje", () => {
    // 20 un a 2/dia = 10 dias, e faltam 11 até o alvo.
    const r = planoEnvioAteData([full({ noFull: 20, mediaDiaria: 2 })], "2026-09-02", "2026-09-12", 3);
    expect(r.itens[0].naoChega).toBe(true);
    expect(r.urgentes).toHaveLength(1);
  });

  it("quem chega na data não é marcado, mesmo precisando de envio pelo trânsito", () => {
    // 24 un = 12 dias, alvo 11: chega. Mas precisa de 28 com o trânsito.
    const r = planoEnvioAteData([full({ noFull: 24, mediaDiaria: 2 })], "2026-09-02", "2026-09-12", 3);
    expect(r.itens[0].naoChega).toBe(false);
    expect(r.itens[0].enviar).toBe(4);
  });

  it("produto sem Full ou sem venda fica de fora", () => {
    expect(planoEnvioAteData([full({ ehFull: false })], "2026-09-02", "2026-09-12", 3).itens).toEqual([]);
    expect(planoEnvioAteData([full({ mediaDiaria: 0 })], "2026-09-02", "2026-09-12", 3).itens).toEqual([]);
  });

  it("soma o que despachar e o que ainda falta comprar", () => {
    const r = planoEnvioAteData([
      full({ id: "a", nome: "A", noFull: 0, emCasa: 100, mediaDiaria: 2 }), // 28
      full({ id: "b", nome: "B", noFull: 0, emCasa: 5, mediaDiaria: 1 }),   // 14 → envia 5, compra 9
    ], "2026-09-02", "2026-09-12", 3);
    expect(r.totalAEnviar).toBe(33);
    expect(r.totalAComprar).toBe(9);
  });
});
