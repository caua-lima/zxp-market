import { describe, expect, it } from "vitest";
import {
  agruparPorDia,
  descricaoLimpa,
  diaPorExtenso,
  escopoDoCommit,
  normalizarCommits,
  resumir,
  tipoDoCommit,
  type CommitBruto,
} from "./mudancas";

/** Mensagens reais do histórico deste repositório. */
describe("tipoDoCommit", () => {
  it("reconhece os prefixos que o projeto usa", () => {
    expect(tipoDoCommit("feat(dre): apresentacao do fechamento")).toBe("recurso");
    expect(tipoDoCommit("fix(ads): margem sumia")).toBe("correcao");
    expect(tipoDoCommit("refactor(marca): dourado centralizado")).toBe("refino");
    expect(tipoDoCommit("test(marca): trava a geometria")).toBe("teste");
    expect(tipoDoCommit("docs: a fonte do ML foi lida em 07/09")).toBe("documentacao");
    expect(tipoDoCommit("chore: bump deps")).toBe("manutencao");
  });

  it("aguenta o `!` de mudança que quebra compatibilidade", () => {
    expect(tipoDoCommit("feat(api)!: troca o formato da resposta")).toBe("recurso");
  });

  it("sem escopo funciona igual", () => {
    expect(tipoDoCommit("fix: corrige o total")).toBe("correcao");
  });

  it("mensagem sem prefixo vira 'outro' — chutar pelo texto erraria", () => {
    // "Ajusta o cálculo do frete" fala de correção, mas adivinhar pelo texto
    // livre produz etiqueta errada, que é pior que etiqueta genérica.
    expect(tipoDoCommit("Ajusta o cálculo do frete")).toBe("outro");
    expect(tipoDoCommit("")).toBe("outro");
  });

  it("prefixo desconhecido não é forçado num tipo existente", () => {
    expect(tipoDoCommit("wip: mexendo")).toBe("outro");
  });
});

describe("descricaoLimpa e escopoDoCommit", () => {
  it("tira o prefixo e sobe a primeira letra", () => {
    expect(descricaoLimpa("fix(ads): margem sumia quando a venda entrava por outro anuncio"))
      .toBe("Margem sumia quando a venda entrava por outro anuncio");
  });

  it("mensagem sem prefixo passa inteira", () => {
    expect(descricaoLimpa("Ajusta o total")).toBe("Ajusta o total");
  });

  it("o escopo é a área do app que foi tocada", () => {
    expect(escopoDoCommit("feat(estoque): reposicao")).toBe("estoque");
    expect(escopoDoCommit("docs: sem escopo")).toBeNull();
  });
});

const commit = (over: Partial<CommitBruto> = {}): CommitBruto => ({
  sha: "abc123", data: "2026-09-08T18:13:34-03:00",
  titulo: "feat(dre): apresentacao", autor: "Cauã Lima", ...over,
});

describe("normalizarCommits", () => {
  it("separa dia e hora no fuso de São Paulo", () => {
    const [m] = normalizarCommits([commit()]);
    expect(m.dia).toBe("2026-09-08");
    expect(m.hora).toBe("18:13");
  });

  it("converte o fuso em vez de usar o do servidor", () => {
    /**
     * Um commit às 02:00 UTC é do dia ANTERIOR no Brasil. A Vercel roda em
     * UTC, então sem a conversão explícita o agrupamento por dia sairia
     * deslocado — e "quantas mudanças ontem" viraria um número errado.
     */
    const [m] = normalizarCommits([commit({ data: "2026-09-09T02:00:00Z" })]);
    expect(m.dia).toBe("2026-09-08");
    expect(m.hora).toBe("23:00");
  });

  it("ordena do mais recente pro mais antigo", () => {
    const ms = normalizarCommits([
      commit({ sha: "velho", data: "2026-09-01T10:00:00-03:00" }),
      commit({ sha: "novo", data: "2026-09-08T10:00:00-03:00" }),
    ]);
    expect(ms.map((m) => m.sha)).toEqual(["novo", "velho"]);
  });

  it("data inválida não some da lista — some da contagem por dia", () => {
    // Sumir seria mostrar menos trabalho do que houve; o commit fica visível
    // e só não entra no agrupamento por data.
    const [m] = normalizarCommits([commit({ data: "não é data" })]);
    expect(m.dia).toBe("");
    expect(m.descricao).toBe("Apresentacao");
  });

  it("entrada vazia ou sem sha não quebra", () => {
    expect(normalizarCommits([])).toEqual([]);
    expect(normalizarCommits([{ sha: "", data: "", titulo: "", autor: "" }])).toEqual([]);
  });
});

describe("agruparPorDia", () => {
  it("junta o mesmo dia e ordena do mais recente", () => {
    const ms = normalizarCommits([
      commit({ sha: "a", data: "2026-09-08T09:00:00-03:00" }),
      commit({ sha: "b", data: "2026-09-08T18:00:00-03:00" }),
      commit({ sha: "c", data: "2026-09-05T12:00:00-03:00" }),
    ]);
    const dias = agruparPorDia(ms);
    expect(dias.map((d) => d.dia)).toEqual(["2026-09-08", "2026-09-05"]);
    expect(dias[0].mudancas).toHaveLength(2);
  });
});

describe("resumir", () => {
  const HOJE = "2026-09-09";
  const muitos = normalizarCommits([
    commit({ sha: "1", titulo: "feat(a): x", data: "2026-09-08T10:00:00-03:00" }),
    commit({ sha: "2", titulo: "fix(b): y", data: "2026-09-08T11:00:00-03:00" }),
    commit({ sha: "3", titulo: "fix(c): z", data: "2026-09-08T12:00:00-03:00" }),
    commit({ sha: "4", titulo: "test(d): w", data: "2026-09-05T10:00:00-03:00" }),
    // Fora da janela de 30 dias.
    commit({ sha: "5", titulo: "feat(e): v", data: "2026-07-01T10:00:00-03:00" }),
  ]);

  it("conta o total e cada tipo", () => {
    const r = resumir(muitos, HOJE);
    expect(r.total).toBe(5);
    expect(r.porTipo.recurso).toBe(2);
    expect(r.porTipo.correcao).toBe(2);
    expect(r.porTipo.teste).toBe(1);
  });

  it("conta dias ATIVOS, não dias corridos", () => {
    expect(resumir(muitos, HOJE).diasAtivos).toBe(3);
  });

  it("a média é por dia ativo — dia parado não dilui o ritmo", () => {
    /**
     * Dividir pelo calendário afogaria o número em fins de semana e diria mais
     * sobre o tamanho da janela que sobre o trabalho. 5 mudanças em 3 dias de
     * trabalho é 1,67 — e é isso que descreve um dia típico.
     */
    expect(resumir(muitos, HOJE).mediaPorDiaAtivo).toBeCloseTo(5 / 3, 4);
  });

  it("a janela de 30 dias exclui o que é mais velho", () => {
    expect(resumir(muitos, HOJE).ultimos30).toBe(4);
  });

  it("acha o dia mais forte", () => {
    expect(resumir(muitos, HOJE).diaMaisForte).toEqual({ dia: "2026-09-08", quantas: 3 });
  });

  it("guarda a primeira e a última data", () => {
    const r = resumir(muitos, HOJE);
    expect(r.primeira).toBe("2026-07-01");
    expect(r.ultima).toBe("2026-09-08");
  });

  it("lista vazia devolve zeros, sem dividir por zero", () => {
    const r = resumir([], HOJE);
    expect(r.total).toBe(0);
    expect(r.mediaPorDiaAtivo).toBe(0);
    expect(r.diaMaisForte).toBeNull();
    expect(r.primeira).toBeNull();
  });
});

describe("diaPorExtenso", () => {
  it("escreve o dia como se fala", () => {
    expect(diaPorExtenso("2026-09-08")).toMatch(/8 de setembro de 2026/);
  });

  it("dia vazio não vira 'Invalid Date'", () => {
    expect(diaPorExtenso("")).toBe("sem data");
  });
});
