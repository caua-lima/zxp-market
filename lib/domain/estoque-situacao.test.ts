import { describe, it, expect } from "vitest";
import {
  duracaoEmDias, sinaisDoProduto, proximaAcao, precisaDeAcao,
  filtrarProdutos, contarSinais, resumoDoEstoque, ordenarPorUrgencia,
  FILTRO_ESTOQUE_VAZIO, DIAS_COBERTURA_BAIXA, type ProdutoNaLista,
} from "./estoque-situacao";

const p = (over: Partial<ProdutoNaLista> = {}): ProdutoNaLista => ({
  id: "P1", nome: "Produto", estoqueTotal: 100, emCasa: 0, noFull: 100,
  ehFull: true, mediaDiaria: 1, custoUnitario: 10, ativo: true,
  anuncios: 1, duplicadas: 0, saldoDoLivro: 0, ...over,
});

describe("duracaoEmDias", () => {
  it("é estoque ÷ ritmo", () => {
    expect(duracaoEmDias(30, 3)).toBe(10);
  });

  it("sem ritmo é null, e null NÃO é infinito", () => {
    expect(duracaoEmDias(30, 0)).toBeNull();
    expect(duracaoEmDias(30, NaN)).toBeNull();
  });

  it("estoque negativo conta como zero", () => {
    expect(duracaoEmDias(-5, 2)).toBe(0);
  });
});

describe("sinaisDoProduto", () => {
  it("estoque zerado é ruptura", () => {
    expect(sinaisDoProduto(p({ estoqueTotal: 0 }))).toContain("ruptura");
  });

  it("menos de um dia de cobertura também é ruptura", () => {
    expect(sinaisDoProduto(p({ estoqueTotal: 2, mediaDiaria: 5 }))).toContain("ruptura");
  });

  it("ruptura e cobertura baixa não se acumulam — é uma ou outra", () => {
    const s = sinaisDoProduto(p({ estoqueTotal: 0 }));
    expect(s).toContain("ruptura");
    expect(s).not.toContain("cobertura_baixa");
  });

  it("abaixo do limiar é cobertura baixa", () => {
    expect(sinaisDoProduto(p({ estoqueTotal: 5, mediaDiaria: 1 }))).toContain("cobertura_baixa");
  });

  it("exatamente no limiar ainda não é baixa", () => {
    const s = sinaisDoProduto(p({ estoqueTotal: DIAS_COBERTURA_BAIXA, mediaDiaria: 1 }));
    expect(s).not.toContain("cobertura_baixa");
  });

  it("produto que nunca vendeu não é ruptura nem cobertura baixa", () => {
    const s = sinaisDoProduto(p({ estoqueTotal: 5, mediaDiaria: 0 }));
    expect(s).not.toContain("ruptura");
    expect(s).not.toContain("cobertura_baixa");
  });

  it("mas estoque zerado é ruptura mesmo sem histórico de venda", () => {
    expect(sinaisDoProduto(p({ estoqueTotal: 0, mediaDiaria: 0 }))).toContain("ruptura");
  });

  it("custo zero é sem_custo", () => {
    expect(sinaisDoProduto(p({ custoUnitario: 0 }))).toContain("sem_custo");
  });

  it("nenhum anúncio é sem_vinculo", () => {
    expect(sinaisDoProduto(p({ anuncios: 0 }))).toContain("sem_vinculo");
  });

  it("unidade duplicada gera inconsistência E remessa pendente", () => {
    const s = sinaisDoProduto(p({ duplicadas: 3 }));
    expect(s).toContain("inconsistencia");
    expect(s).toContain("remessa_pendente");
  });

  it("produto saudável não tem sinal nenhum", () => {
    expect(sinaisDoProduto(p({ estoqueTotal: 100, mediaDiaria: 1 }))).toEqual([]);
  });
});

describe("proximaAcao — a ordem é a parte que importa", () => {
  it("ruptura COM estoque em casa manda despachar, não comprar", () => {
    const a = proximaAcao(p({ estoqueTotal: 0, emCasa: 40, ehFull: true }));
    expect(a.acao).toBe("enviar_full");
    expect(a.porque).toContain("sem comprar nada");
  });

  it("e despachar é MAIS urgente que comprar — resolve hoje e de graça", () => {
    const despachar = proximaAcao(p({ estoqueTotal: 0, emCasa: 40, ehFull: true }));
    const comprar = proximaAcao(p({ estoqueTotal: 0, emCasa: 0 }));
    expect(despachar.urgencia).toBeGreaterThan(comprar.urgencia);
  });

  it("ruptura sem estoque em lugar nenhum manda comprar", () => {
    expect(proximaAcao(p({ estoqueTotal: 0, emCasa: 0 })).acao).toBe("comprar");
  });

  it("produto próprio com estoque em casa não manda 'enviar ao Full'", () => {
    const a = proximaAcao(p({ estoqueTotal: 0, emCasa: 30, ehFull: false }));
    expect(a.acao).toBe("comprar");
  });

  it("ruptura ganha de sem_custo — ruptura custa dinheiro por hora", () => {
    const a = proximaAcao(p({ estoqueTotal: 0, emCasa: 0, custoUnitario: 0 }));
    expect(a.acao).toBe("comprar");
  });

  it("cobertura baixa diz quantos dias restam", () => {
    const a = proximaAcao(p({ estoqueTotal: 5, mediaDiaria: 1, emCasa: 0 }));
    expect(a.acao).toBe("comprar");
    expect(a.porque).toContain("5 dia");
  });

  it("sem vínculo vem antes de sem custo — sem anúncio nada é conhecível", () => {
    const a = proximaAcao(p({ anuncios: 0, custoUnitario: 0 }));
    expect(a.acao).toBe("vincular");
  });

  it("sem custo diz o efeito: o lucro aparece inteiro", () => {
    const a = proximaAcao(p({ custoUnitario: 0 }));
    expect(a.acao).toBe("cadastrar_custo");
    expect(a.porque).toContain("ZERO");
  });

  it("inconsistência é a menos urgente das reais", () => {
    const a = proximaAcao(p({ duplicadas: 5 }));
    expect(a.acao).toBe("conferir");
    expect(a.porque).toContain("5 un");
  });

  it("produto inativo não tem ação — não se compra estoque pro que não vende", () => {
    const a = proximaAcao(p({ ativo: false, estoqueTotal: 0 }));
    expect(a.acao).toBe("nada");
    expect(a.urgencia).toBe(0);
  });

  it("produto saudável não tem ação", () => {
    expect(proximaAcao(p()).acao).toBe("nada");
  });

  it("toda ação explica por quê", () => {
    const casos = [
      p({ estoqueTotal: 0, emCasa: 5 }), p({ estoqueTotal: 0 }),
      p({ estoqueTotal: 3, mediaDiaria: 1 }), p({ anuncios: 0 }),
      p({ custoUnitario: 0 }), p({ duplicadas: 1 }), p(),
    ];
    for (const c of casos) expect(proximaAcao(c).porque.length).toBeGreaterThan(15);
  });
});

describe("precisaDeAcao", () => {
  it("separa a vista de ação das outras", () => {
    expect(precisaDeAcao(p({ estoqueTotal: 0 }))).toBe(true);
    expect(precisaDeAcao(p())).toBe(false);
    expect(precisaDeAcao(p({ ativo: false, estoqueTotal: 0 }))).toBe(false);
  });
});

describe("filtrarProdutos", () => {
  const lista = [
    p({ id: "a", nome: "Água tônica", estoqueTotal: 0 }),
    p({ id: "b", nome: "Bala de menta", custoUnitario: 0 }),
    p({ id: "c", nome: "Caneca própria", ehFull: false }),
    p({ id: "d", nome: "Descontinuado", ativo: false }),
  ];

  it("esconde inativo por padrão", () => {
    expect(filtrarProdutos(lista, FILTRO_ESTOQUE_VAZIO).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("busca ignora acento", () => {
    expect(filtrarProdutos(lista, { ...FILTRO_ESTOQUE_VAZIO, busca: "agua" }).map((x) => x.id)).toEqual(["a"]);
  });

  it("busca com duas palavras é E", () => {
    expect(filtrarProdutos(lista, { ...FILTRO_ESTOQUE_VAZIO, busca: "bala menta" }).map((x) => x.id)).toEqual(["b"]);
  });

  it("sinais combinam por OU — marcar duas caixas amplia", () => {
    const r = filtrarProdutos(lista, { ...FILTRO_ESTOQUE_VAZIO, sinais: ["ruptura", "sem_custo"] });
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("filtra por Full", () => {
    expect(filtrarProdutos(lista, { ...FILTRO_ESTOQUE_VAZIO, logistica: "full" }).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("filtra por próprio", () => {
    expect(filtrarProdutos(lista, { ...FILTRO_ESTOQUE_VAZIO, logistica: "proprio" }).map((x) => x.id)).toEqual(["c"]);
  });

  it("sinal e logística combinam por E entre si", () => {
    const r = filtrarProdutos(lista, { ...FILTRO_ESTOQUE_VAZIO, sinais: ["ruptura"], logistica: "proprio" });
    expect(r).toHaveLength(0);
  });

  it("incluir inativos traz o descontinuado", () => {
    expect(filtrarProdutos(lista, { ...FILTRO_ESTOQUE_VAZIO, incluirInativos: true })).toHaveLength(4);
  });
});

describe("contarSinais", () => {
  it("conta cada sinal, ignorando inativo", () => {
    const c = contarSinais([
      p({ estoqueTotal: 0 }),
      p({ custoUnitario: 0 }),
      p({ estoqueTotal: 0, ativo: false }),
    ]);
    expect(c.ruptura).toBe(1);
    expect(c.sem_custo).toBe(1);
  });

  it("lista vazia zera tudo sem quebrar", () => {
    expect(contarSinais([]).ruptura).toBe(0);
  });
});

describe("resumoDoEstoque", () => {
  it("capital é estoque × custo médio", () => {
    const r = resumoDoEstoque([p({ estoqueTotal: 10, custoUnitario: 5 }), p({ estoqueTotal: 4, custoUnitario: 2.5 })]);
    expect(r.capitalEmEstoque).toBeCloseTo(60, 2);
  });

  it("produto inativo não entra no capital", () => {
    const r = resumoDoEstoque([p({ estoqueTotal: 10, custoUnitario: 5, ativo: false })]);
    expect(r.capitalEmEstoque).toBe(0);
  });

  it("conta quantos estão sem custo — o capital está subestimado por eles", () => {
    const r = resumoDoEstoque([p({ custoUnitario: 0 }), p()]);
    expect(r.semCusto).toBe(1);
  });

  it("conta ruptura, cobertura baixa e remessa pendente", () => {
    const r = resumoDoEstoque([
      p({ estoqueTotal: 0 }),
      p({ estoqueTotal: 3, mediaDiaria: 1 }),
      p({ duplicadas: 2 }),
    ]);
    expect(r.ruptura).toBe(1);
    expect(r.coberturaBaixa).toBe(1);
    expect(r.remessasPendentes).toBe(1);
  });
});

describe("ordenarPorUrgencia", () => {
  it("o que se resolve hoje aparece primeiro", () => {
    const r = ordenarPorUrgencia([
      p({ id: "custo", custoUnitario: 0 }),
      p({ id: "comprar", estoqueTotal: 0, emCasa: 0 }),
      p({ id: "despachar", estoqueTotal: 0, emCasa: 20 }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["despachar", "comprar", "custo"]);
  });

  it("empate desempata por nome — a lista não pode dançar", () => {
    const r = ordenarPorUrgencia([
      p({ id: "z", nome: "Zebra", estoqueTotal: 0, emCasa: 0 }),
      p({ id: "a", nome: "Alfa", estoqueTotal: 0, emCasa: 0 }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "z"]);
  });

  it("não modifica a lista original", () => {
    const lista = [p({ id: "a" }), p({ id: "b", estoqueTotal: 0 })];
    const copia = [...lista];
    ordenarPorUrgencia(lista);
    expect(lista).toEqual(copia);
  });
});

describe("saldo negativo no livro — o caso que a tela mostrava e o filtro ignorava", () => {
  it("saldo negativo é inconsistência", () => {
    expect(sinaisDoProduto(p({ saldoDoLivro: -17 }))).toContain("inconsistencia");
  });

  it("mas NÃO é remessa pendente — são problemas opostos", () => {
    // Remessa sem baixa conta a unidade DUAS vezes; saldo negativo PERDEU uma
    // entrada. Misturar os dois manda a pessoa pro lugar errado.
    const s = sinaisDoProduto(p({ saldoDoLivro: -17 }));
    expect(s).not.toContain("remessa_pendente");
  });

  it("não duplica o sinal quando também há remessa pendente", () => {
    const s = sinaisDoProduto(p({ saldoDoLivro: -5, duplicadas: 3 }));
    expect(s.filter((x) => x === "inconsistencia")).toHaveLength(1);
    expect(s).toContain("remessa_pendente");
  });

  it("saldo zero ou positivo não é inconsistência", () => {
    expect(sinaisDoProduto(p({ saldoDoLivro: 0 }))).not.toContain("inconsistencia");
    expect(sinaisDoProduto(p({ saldoDoLivro: 42 }))).not.toContain("inconsistencia");
  });

  it("a ação explica que falta lançar uma COMPRA, não uma baixa", () => {
    const a = proximaAcao(p({ saldoDoLivro: -17 }));
    expect(a.acao).toBe("conferir");
    expect(a.porque).toContain("-17");
    expect(a.porque).toContain("compra");
  });

  it("com duplicadas, a explicação é a da baixa", () => {
    const a = proximaAcao(p({ duplicadas: 3 }));
    expect(a.porque).toContain("baixa da remessa");
  });

  it("entra no contador de inconsistência do filtro", () => {
    expect(contarSinais([p({ saldoDoLivro: -17 })]).inconsistencia).toBe(1);
  });
});
