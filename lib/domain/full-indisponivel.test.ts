import { describe, expect, it } from "vitest";
import {
  traduzirStatusIndisponivel, unidadesComPerda, unidadesEmTransito, valorRetido,
  voltaAVenderSozinha, composicaoDoEstoque, baseDaReposicao, composicaoCompleta,
} from "./full-indisponivel";

describe("traduzirStatusIndisponivel — cada motivo pede uma acao diferente", () => {
  it("transferencia se resolve sozinha e nao e perda", () => {
    const t = traduzirStatusIndisponivel("transfer");
    expect(t.label).toMatch(/transferência/i);
    expect(t.perda).toBe(false);
  });

  it("avaria e perda e manda pedir reembolso", () => {
    const t = traduzirStatusIndisponivel("damaged");
    expect(t.perda).toBe(true);
    expect(t.acao).toMatch(/reembolso/i);
  });

  it("perdido pelo ML tambem e reembolso", () => {
    expect(traduzirStatusIndisponivel("lost").perda).toBe(true);
  });

  it("item nao aceito no Full e perda — parado la nao vende nunca", () => {
    const t = traduzirStatusIndisponivel("not_supported");
    expect(t.perda).toBe(true);
    expect(t.acao).toMatch(/Retire/i);
  });

  it("retirada pedida por voce NAO e perda", () => {
    expect(traduzirStatusIndisponivel("withdrawal").perda).toBe(false);
  });

  it("nao depende de caixa nem de espaco", () => {
    expect(traduzirStatusIndisponivel("  DAMAGED ").perda).toBe(true);
  });

  it("codigo desconhecido aparece com o nome CRU, nao escondido", () => {
    // Unidade retida por motivo novo continua retida — sumir seria pior.
    const t = traduzirStatusIndisponivel("motivo_novo_do_ml");
    expect(t.label).toContain("motivo_novo_do_ml");
    expect(t.perda).toBe(false);
  });

  it("status vazio nao quebra", () => {
    expect(traduzirStatusIndisponivel("").label).toMatch(/não informado/i);
  });
});

describe("separacao entre perda e transito", () => {
  const linhas = [
    { status: "transfer", qtd: 10 },
    { status: "damaged", qtd: 3 },
    { status: "internal_process", qtd: 5 },
    { status: "lost", qtd: 2 },
  ];

  it("perda soma so avaria e extravio", () => {
    expect(unidadesComPerda(linhas)).toBe(5);
  });

  it("transito soma o que volta a vender sozinho", () => {
    expect(unidadesEmTransito(linhas)).toBe(15);
  });

  it("as duas somadas dao o total retido — nada some da conta", () => {
    const total = linhas.reduce((s, l) => s + l.qtd, 0);
    expect(unidadesComPerda(linhas) + unidadesEmTransito(linhas)).toBe(total);
  });

  it("lista vazia da zero nos dois", () => {
    expect(unidadesComPerda([])).toBe(0);
    expect(unidadesEmTransito([])).toBe(0);
  });
});

describe("valorRetido — o tamanho do problema em dinheiro", () => {
  it("multiplica pelo custo medio", () => {
    expect(valorRetido(12, 13.81)).toBeCloseTo(165.72, 2);
  });

  it("entradas negativas viram zero, nunca credito", () => {
    expect(valorRetido(-5, 10)).toBe(0);
    expect(valorRetido(5, -10)).toBe(0);
  });

  it("sem custo cadastrado o valor e zero, nao NaN", () => {
    expect(valorRetido(5, 0)).toBe(0);
  });
});

describe("voltaAVenderSozinha", () => {
  it("transferência entre centros volta a vender", () => {
    expect(voltaAVenderSozinha("transfer")).toBe(true);
    expect(voltaAVenderSozinha("internal_process")).toBe(true);
    expect(voltaAVenderSozinha("in_review")).toBe(true);
  });

  it("retirada NÃO volta — não é perda, mas sai do Full", () => {
    expect(traduzirStatusIndisponivel("withdrawal").perda).toBe(false);
    expect(voltaAVenderSozinha("withdrawal")).toBe(false);
  });

  it("avaria e vencido não voltam", () => {
    expect(voltaAVenderSozinha("damaged")).toBe(false);
    expect(voltaAVenderSozinha("expired")).toBe(false);
  });

  it("motivo desconhecido não conta — errar pra cima faz faltar produto", () => {
    expect(voltaAVenderSozinha("motivo_novo_do_ml")).toBe(false);
    expect(voltaAVenderSozinha("")).toBe(false);
  });
});

describe("composicaoDoEstoque", () => {
  it("separa os quatro estados", () => {
    const c = composicaoDoEstoque(100, [
      { status: "transfer", qtd: 10 },
      { status: "withdrawal", qtd: 5 },
      { status: "damaged", qtd: 3 },
    ]);
    expect(c).toEqual({ disponivel: 100, transito: 10, retidoSemVolta: 5, perdido: 3, fisico: 118 });
  });

  it("sem nada retido, físico é o disponível", () => {
    expect(composicaoDoEstoque(42, []).fisico).toBe(42);
  });

  it("ignora quantidade zero ou negativa", () => {
    const c = composicaoDoEstoque(10, [{ status: "transfer", qtd: 0 }, { status: "damaged", qtd: -5 }]);
    expect(c.fisico).toBe(10);
  });

  it("disponível negativo vira zero, não estraga o total", () => {
    expect(composicaoDoEstoque(-4, []).disponivel).toBe(0);
  });

  it("soma vários do mesmo status", () => {
    const c = composicaoDoEstoque(0, [{ status: "transfer", qtd: 3 }, { status: "transfer", qtd: 4 }]);
    expect(c.transito).toBe(7);
  });

  it("status desconhecido cai em retidoSemVolta, não some", () => {
    const c = composicaoDoEstoque(10, [{ status: "coisa_nova", qtd: 6 }]);
    expect(c.retidoSemVolta).toBe(6);
    expect(c.fisico).toBe(16);
  });
});

describe("baseDaReposicao", () => {
  const c = composicaoDoEstoque(100, [
    { status: "transfer", qtd: 10 },
    { status: "withdrawal", qtd: 5 },
    { status: "damaged", qtd: 3 },
  ]);

  it("é disponível + trânsito", () => {
    expect(baseDaReposicao(c)).toBe(110);
  });

  it("NÃO é o físico — avaria nunca volta a vender", () => {
    expect(baseDaReposicao(c)).toBeLessThan(c.fisico);
  });

  it("NÃO é só o disponível — a transferência já foi paga", () => {
    expect(baseDaReposicao(c)).toBeGreaterThan(c.disponivel);
  });

  it("sem retenção, coincide com o disponível", () => {
    expect(baseDaReposicao(composicaoDoEstoque(50, []))).toBe(50);
  });
});

describe("composicaoCompleta", () => {
  it("com o detalhe, é completa", () => {
    expect(composicaoCompleta(true, composicaoDoEstoque(10, [{ status: "transfer", qtd: 2 }]))).toBe(true);
  });

  it("sem o detalhe e sem retenção conhecida, não dá pra afirmar... a menos que nada esteja retido", () => {
    // fisico === disponivel: não há o que o detalhe pudesse acrescentar aqui
    expect(composicaoCompleta(false, composicaoDoEstoque(10, []))).toBe(true);
  });

  it("sem o detalhe, uma composição com retenção conhecida ainda é parcial pro resto", () => {
    expect(composicaoCompleta(false, composicaoDoEstoque(10, [{ status: "damaged", qtd: 1 }]))).toBe(false);
  });
});
