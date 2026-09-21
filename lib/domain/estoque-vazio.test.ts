import { describe, it, expect } from "vitest";
import { motivoDaListaVazia } from "./estoque-vazio";

const base = {
  totalProdutos: 12, vista: "acao" as const, busca: "", filtrosRestritivos: 0,
  incluirInativos: false, totalInativos: 0, fonteIndisponivel: false,
};

describe("motivoDaListaVazia (U12)", () => {
  it("todos saudáveis na vista 'precisa de ação' NÃO vira 'nenhum produto cadastrado'", () => {
    expect(motivoDaListaVazia(base)).toBe("sem-pendencia");
  });

  it("nenhum produto e a fonte respondeu: sem cadastro", () => {
    expect(motivoDaListaVazia({ ...base, totalProdutos: 0 })).toBe("sem-cadastro");
  });

  it("nenhum produto porque a fonte falhou: não afirma que o cadastro está vazio", () => {
    expect(motivoDaListaVazia({ ...base, totalProdutos: 0, fonteIndisponivel: true })).toBe("fonte-indisponivel");
  });

  it("busca que esconde tudo: sem-resultado, mesmo estando na vista 'ação'", () => {
    expect(motivoDaListaVazia({ ...base, busca: "menta" })).toBe("sem-resultado");
  });

  it("sinal/logística escolhido que esconde tudo: sem-resultado", () => {
    expect(motivoDaListaVazia({ ...base, vista: "todos", filtrosRestritivos: 2 })).toBe("sem-resultado");
  });

  it("só existem inativos e eles estão escondidos: diz isso e oferece mostrá-los", () => {
    expect(motivoDaListaVazia({ ...base, vista: "todos", totalProdutos: 3, totalInativos: 3 })).toBe("so-inativos");
  });

  it("com inativos visíveis, esse motivo não se aplica", () => {
    expect(motivoDaListaVazia({ ...base, vista: "todos", totalProdutos: 3, totalInativos: 3, incluirInativos: true })).toBe("sem-resultado");
  });

  it("vista 'todos', sem filtro e com produtos ativos, não deveria estar vazia — cai em sem-resultado", () => {
    expect(motivoDaListaVazia({ ...base, vista: "todos" })).toBe("sem-resultado");
  });

  it("uma busca só com espaços não conta como busca", () => {
    expect(motivoDaListaVazia({ ...base, busca: "   " })).toBe("sem-pendencia");
  });
});
