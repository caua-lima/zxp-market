import { describe, expect, it } from "vitest";
import { faixasAlteradas, misturar, ordenarMovimentos, reconstruirCusto } from "./custo-medio";
import { CUSTO_FAIXA_SENTINELA, custoNaData, type EstoqueMovimento } from "./types";

function mov(p: Partial<EstoqueMovimento>): EstoqueMovimento {
  return {
    id: p.id ?? "m1",
    productId: "prod",
    tipo: p.tipo ?? "entrada",
    quantidade: p.quantidade ?? 0,
    data: p.data ?? "2026-09-01",
    ...p,
  } as EstoqueMovimento;
}

describe("reconstruirCusto — o bug da auditoria", () => {
  it("corrigir a entrada de R$ 10 para R$ 20 MOVE o custo médio", () => {
    /**
     * A reprodução exata do relatório: entrada corrigida de R$ 10 para R$ 20,
     * custo médio permaneceu R$ 10.
     *
     * A causa era `recomputeProduto(productId, undefined, ...)`: com
     * `custoMedio` indefinido, o bloco inteiro do custo era pulado. A função
     * varria as movimentações, mas só pra somar QUANTIDADE — apesar do
     * comentário afirmando que ela "conserta a média sozinho".
     */
    const antes = reconstruirCusto([mov({ tipo: "entrada", quantidade: 100, custoUnit: 10 })]);
    expect(antes.custoMedio).toBe(10);

    const depois = reconstruirCusto([mov({ tipo: "entrada", quantidade: 100, custoUnit: 20 })]);
    expect(depois.custoMedio).toBe(20);
  });

  it("excluir uma entrada devolve o custo médio ao que era antes dela", () => {
    // Apagar deixava a média como se o movimento ainda estivesse lá.
    const comDuas = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02" }),
    ]);
    expect(comDuas.custoMedio).toBe(15);

    const semB = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
    ]);
    expect(semB.custoMedio).toBe(10);
  });
});

describe("reconstruirCusto — a política por tipo", () => {
  it("entrada mistura ponderado contra o que já existe", () => {
    // 100 a 10 + 100 a 20 = 200 a 15.
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02" }),
    ]);
    expect(r.custoMedio).toBe(15);
    expect(r.qtdLocal).toBe(200);
  });

  it("a ponderação é pela quantidade, não uma média simples", () => {
    // 300 a 10 + 100 a 20 = 12,50, não 15.
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 300, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02" }),
    ]);
    expect(r.custoMedio).toBe(12.5);
  });

  it("primeira entrada define a média, sem misturar com zero", () => {
    const r = reconstruirCusto([mov({ quantidade: 50, custoUnit: 30 })]);
    expect(r.custoMedio).toBe(30);
  });

  it("entrada SEM custo informado não mexe na média", () => {
    /**
     * Não se sabe por quanto entrou. Misturar contra zero derrubaria o CMV de
     * todo o estoque — um erro silencioso que sai na margem, não no estoque.
     */
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, data: "2026-09-02" }),
    ]);
    expect(r.custoMedio).toBe(10);
    expect(r.qtdLocal).toBe(200);
  });

  it("saida_full é transferência: tira quantidade e NÃO move a média", () => {
    // As unidades continuam nossas, só mudam de lugar. Saída pela média não
    // move a média.
    const r = reconstruirCusto([
      mov({ id: "a", tipo: "entrada", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", tipo: "saida_full", quantidade: 40, data: "2026-09-02" }),
    ]);
    expect(r.custoMedio).toBe(10);
    expect(r.qtdLocal).toBe(60);
  });

  it("saldo_inicial abre a posição sem misturar", () => {
    const r = reconstruirCusto([
      mov({ id: "a", tipo: "saldo_inicial", quantidade: 500, custoUnit: 7, data: "2026-06-01" }),
    ]);
    expect(r.custoMedio).toBe(7);
    // Saldo inicial descreve estoque que já está fora do galpão (Full).
    expect(r.qtdLocal).toBe(0);
  });

  it("ajuste positivo COM custo mistura; SEM custo, não", () => {
    const comCusto = reconstruirCusto([
      mov({ id: "a", tipo: "entrada", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", tipo: "ajuste", quantidade: 100, custoUnit: 20, data: "2026-09-02" }),
    ]);
    expect(comCusto.custoMedio).toBe(15);

    const semCusto = reconstruirCusto([
      mov({ id: "a", tipo: "entrada", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", tipo: "ajuste", quantidade: 100, data: "2026-09-02" }),
    ]);
    expect(semCusto.custoMedio).toBe(10);
    expect(semCusto.qtdLocal).toBe(200);
  });

  it("ajuste negativo sai pela média e não a move", () => {
    const r = reconstruirCusto([
      mov({ id: "a", tipo: "entrada", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", tipo: "ajuste", quantidade: -30, data: "2026-09-02" }),
    ]);
    expect(r.custoMedio).toBe(10);
    expect(r.qtdLocal).toBe(70);
  });

  it("quantidade negativa no livro não vira média negativa", () => {
    // Lançamento torto acontece; a média não pode virar lixo por causa disso.
    const r = reconstruirCusto([
      mov({ id: "a", tipo: "ajuste", quantidade: -50, data: "2026-09-01" }),
      mov({ id: "b", tipo: "entrada", quantidade: 10, custoUnit: 8, data: "2026-09-02" }),
    ]);
    expect(r.custoMedio).toBe(8);
  });
});

describe("ordenarMovimentos — movimentos no mesmo dia", () => {
  it("ordena por data", () => {
    const r = ordenarMovimentos([
      mov({ id: "c", data: "2026-09-03" }),
      mov({ id: "a", data: "2026-09-01" }),
      mov({ id: "b", data: "2026-09-02" }),
    ]);
    expect(r.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("no mesmo dia, desempata por createdAt", () => {
    /**
     * Sem desempate, dois lançamentos do mesmo dia podiam ser aplicados em
     * ordens diferentes a cada recálculo e produzir médias diferentes pro
     * MESMO livro — um número que muda sozinho ao recarregar a tela.
     */
    const r = ordenarMovimentos([
      mov({ id: "z", data: "2026-09-01", createdAt: 200 }),
      mov({ id: "a", data: "2026-09-01", createdAt: 100 }),
    ]);
    expect(r.map((m) => m.id)).toEqual(["a", "z"]);
  });

  it("sem createdAt, desempata por id — estável de qualquer jeito", () => {
    const r = ordenarMovimentos([
      mov({ id: "b", data: "2026-09-01" }),
      mov({ id: "a", data: "2026-09-01" }),
    ]);
    expect(r.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("a média não depende da ordem em que o Firestore devolveu", () => {
    const livro = [
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02", createdAt: 2 }),
      mov({ id: "a", quantidade: 300, custoUnit: 10, data: "2026-09-01", createdAt: 1 }),
    ];
    const direto = reconstruirCusto(livro);
    const invertido = reconstruirCusto([...livro].reverse());
    expect(direto.custoMedio).toBe(invertido.custoMedio);
    expect(direto.custoMedio).toBe(12.5);
  });

  it("não muda o array recebido", () => {
    const livro = [mov({ id: "b", data: "2026-09-02" }), mov({ id: "a", data: "2026-09-01" })];
    ordenarMovimentos(livro);
    expect(livro.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("faixas de vigência — a margem de vendas passadas", () => {
  it("cada data com mudança vira uma faixa, e a sentinela sempre existe", () => {
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-10" }),
    ], 5);
    expect(r.faixas[0]).toEqual({ desde: CUSTO_FAIXA_SENTINELA, custo: 5 });
    expect(r.faixas.find((f) => f.desde === "2026-09-01")!.custo).toBe(10);
    expect(r.faixas.find((f) => f.desde === "2026-09-10")!.custo).toBe(15);
  });

  it("uma venda antiga continua lendo o custo que valia naquele dia", () => {
    /**
     * É pra isto que as faixas existem: dar entrada hoje não pode mudar a
     * margem de uma venda de meses atrás.
     */
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-10" }),
    ], 5);
    const prod = { custoMedio: r.custoMedio, custoMedioFaixas: r.faixas };
    expect(custoNaData(prod, "2026-08-15")).toBe(5);
    expect(custoNaData(prod, "2026-09-05")).toBe(10);
    expect(custoNaData(prod, "2026-09-20")).toBe(15);
  });

  it("vários movimentos no mesmo dia colapsam numa faixa só", () => {
    // O que vale pro dia é a média DEPOIS de todos eles; estados intermediários
    // criariam faixas que nenhuma venda jamais consulta.
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01", createdAt: 1 }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-01", createdAt: 2 }),
    ]);
    const doDia = r.faixas.filter((f) => f.desde === "2026-09-01");
    expect(doDia).toHaveLength(1);
    expect(doDia[0].custo).toBe(15);
  });

  it("data inválida não vira faixa", () => {
    const r = reconstruirCusto([mov({ quantidade: 10, custoUnit: 10, data: "ontem" })]);
    expect(r.faixas.every((f) => f.desde === CUSTO_FAIXA_SENTINELA)).toBe(true);
  });
});

describe("faixasAlteradas — não reescrever período fechado em silêncio", () => {
  it("aponta a faixa que mudou de valor", () => {
    /**
     * Corrigir uma entrada de meses atrás muda o custo que valia naquela
     * época, e portanto a margem de vendas já apuradas. Às vezes é exatamente
     * o que se quer — mas quem corrigiu precisa saber que aconteceu.
     */
    const antes = [{ desde: "2026-09-01", custo: 10 }];
    const depois = [{ desde: "2026-09-01", custo: 20 }];
    expect(faixasAlteradas(antes, depois)).toEqual([{ desde: "2026-09-01", de: 10, para: 20 }]);
  });

  it("faixa que sumiu (movimento excluído) também conta", () => {
    const mudancas = faixasAlteradas([{ desde: "2026-09-01", custo: 10 }], []);
    expect(mudancas).toEqual([{ desde: "2026-09-01", de: 10, para: 0 }]);
  });

  it("nada mudou, nada a avisar", () => {
    const faixas = [{ desde: "2026-09-01", custo: 10 }];
    expect(faixasAlteradas(faixas, faixas)).toEqual([]);
  });

  it("a sentinela aparecendo pela primeira vez não é uma mudança de período", () => {
    // Produto que nunca teve faixa ganha a sentinela; isso não reescreve nada.
    expect(faixasAlteradas(undefined, [{ desde: CUSTO_FAIXA_SENTINELA, custo: 0 }])).toEqual([]);
  });

  it("diferença só de arredondamento não vira aviso", () => {
    const mudancas = faixasAlteradas(
      [{ desde: "2026-09-01", custo: 10.00001 }],
      [{ desde: "2026-09-01", custo: 10 }],
    );
    expect(mudancas).toEqual([]);
  });
});

describe("estoqueAntes — o denominador que o livro não sabe", () => {
  /**
   * Venda NÃO é movimentação. O livro registra entrada, saída pro Full, saldo
   * inicial e ajuste, e nada mais — as unidades vendidas somem do estoque sem
   * deixar linha aqui. Então o acumulado do livro nunca é o estoque que
   * existia quando a entrada foi feita: é sempre maior.
   */
  it("usa o estoque REAL gravado, não o acumulado do livro", () => {
    /**
     * 300 compradas, 280 vendidas: restam 20 quando a segunda entrada chega.
     * O livro só conhece as 300.
     *
     *   com estoque real (20):  (20×10 + 100×20) / 120 = 18,33
     *   com o livro    (300):  (300×10 + 100×20) / 400 = 12,50
     *
     * Quase seis reais de diferença por unidade, e o número do livro é o que
     * gruda a média no passado.
     */
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 300, custoUnit: 10, data: "2026-09-01", estoqueAntes: 0 }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02", estoqueAntes: 20 }),
    ]);
    expect(r.custoMedio).toBeCloseTo(18.3333, 3);
    expect(r.movimentosSemEstoqueAntes).toBe(0);
  });

  it("corrigir o custo de uma entrada antiga reflui até a média final", () => {
    // O replay reusa o estoqueAntes gravado de cada movimento, mas recalcula a
    // média corrente — o custoMedioAntes gravado nos posteriores está velho.
    const antes = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01", estoqueAntes: 0 }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02", estoqueAntes: 100 }),
    ]);
    expect(antes.custoMedio).toBe(15);

    const corrigido = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 30, data: "2026-09-01", estoqueAntes: 0 }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02", estoqueAntes: 100 }),
    ]);
    expect(corrigido.custoMedio).toBe(25);
  });

  it("movimento sem estoqueAntes cai na aproximação E é contado", () => {
    /**
     * Movimentos anteriores a este campo existir não têm o número. A média
     * deles sai aproximada, e a contagem existe pra a tela poder dizer isso em
     * vez de apresentar um número exato que não é.
     */
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02" }),
    ]);
    expect(r.movimentosSemEstoqueAntes).toBe(2);
    expect(r.custoMedio).toBe(15);
  });

  it("livro misto conta só os que faltam", () => {
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01" }),
      mov({ id: "b", quantidade: 100, custoUnit: 20, data: "2026-09-02", estoqueAntes: 50 }),
    ]);
    expect(r.movimentosSemEstoqueAntes).toBe(1);
  });

  it("estoqueAntes zero é um valor válido, não ausência", () => {
    // Primeira compra do produto: havia zero. Tratar como ausente faria a
    // função cair na aproximação sem necessidade.
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01", estoqueAntes: 0 }),
    ]);
    expect(r.movimentosSemEstoqueAntes).toBe(0);
    expect(r.custoMedio).toBe(10);
  });

  it("estoqueAntes negativo não inverte a mistura", () => {
    const r = reconstruirCusto([
      mov({ id: "a", quantidade: 100, custoUnit: 10, data: "2026-09-01", estoqueAntes: -50 }),
    ]);
    expect(r.custoMedio).toBe(10);
  });
});

describe("misturar — a definição de 'média'", () => {
  it("é a mesma conta que a prévia da tela faz", () => {
    /**
     * A tela mostra "custo médio após esta entrada" antes de salvar. Se a
     * prévia e a autoridade discordarem, a prévia mente — e duas definições da
     * mesma coisa divergindo é a origem de quase todo número errado nesta base.
     */
    expect(misturar(100, 10, 100, 20)).toBe(15);
    expect(misturar(300, 10, 100, 20)).toBe(12.5);
  });

  it("sem estoque anterior, a média vira o custo da entrada", () => {
    expect(misturar(0, 999, 100, 20)).toBe(20);
  });

  it("quantidade zero ou negativa não muda nada", () => {
    expect(misturar(100, 10, 0, 999)).toBe(10);
    expect(misturar(100, 10, -5, 999)).toBe(10);
  });
});
