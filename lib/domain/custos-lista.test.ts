import { describe, it, expect } from "vitest";
import {
  acumuladoEProjetado, impactoDaLista, rotuloDaVigencia,
  filtrarCustos, ordenarCustos, filtrosAtivos, FILTRO_VAZIO,
  situacaoDoCusto, contarPorSituacao, vistaDaLista, temFiltroRestritivo,
} from "./custos-lista";
import type { Cost } from "./types";

const custo = (over: Partial<Cost> = {}): Cost => ({
  id: "c1", nome: "Custo", valor: "1000", freq: "mensal", data: "2026-09-01", ...over,
});

describe("acumuladoEProjetado — acumulado não é projeção", () => {
  it("no meio do mês, o acumulado é menor que a projeção", () => {
    const i = acumuladoEProjetado(custo({ valor: "3000" }), "2026-09", "2026-09-10");
    expect(i.projetado).toBeCloseTo(3000, 2);
    expect(i.acumulado).toBeLessThan(i.projetado);
    expect(i.mesFechado).toBe(false);
  });

  it("mês passado: os dois são o mesmo, e não há o que projetar", () => {
    const i = acumuladoEProjetado(custo(), "2026-08", "2026-09-15");
    expect(i.acumulado).toBeCloseTo(i.projetado, 2);
    expect(i.mesFechado).toBe(true);
  });

  it("mês futuro: nada aconteceu ainda", () => {
    const i = acumuladoEProjetado(custo(), "2026-12", "2026-09-15");
    expect(i.acumulado).toBe(0);
    expect(i.projetado).toBeGreaterThan(0);
  });

  it("último dia do mês fecha o mês", () => {
    expect(acumuladoEProjetado(custo(), "2026-09", "2026-09-30").mesFechado).toBe(true);
  });

  it("custo arquivado não projeta nada", () => {
    const i = acumuladoEProjetado(custo({ ativo: false, vigenteAte: "2026-08-31" }), "2026-09", "2026-09-10");
    expect(i.projetado).toBe(0);
  });

  it("custo que começa no meio do mês só conta a partir dali", () => {
    const cheio = acumuladoEProjetado(custo(), "2026-09", "2026-09-30").projetado;
    const meio = acumuladoEProjetado(custo({ vigenteDe: "2026-09-16" }), "2026-09", "2026-09-30").projetado;
    expect(meio).toBeLessThan(cheio);
  });

  it("avulso do dia 20 não está no acumulado do dia 10", () => {
    const c = custo({ freq: "avulso", data: "2026-09-20", valor: "500" });
    const i = acumuladoEProjetado(c, "2026-09", "2026-09-10");
    expect(i.acumulado).toBe(0);
    expect(i.projetado).toBeCloseTo(500, 2);
  });

  it("avulso já passado entra nos dois", () => {
    const c = custo({ freq: "avulso", data: "2026-09-05", valor: "500" });
    const i = acumuladoEProjetado(c, "2026-09", "2026-09-10");
    expect(i.acumulado).toBeCloseTo(500, 2);
    expect(i.projetado).toBeCloseTo(500, 2);
  });

  it("valor no formato brasileiro é lido certo", () => {
    const i = acumuladoEProjetado(custo({ valor: "1.234,56", freq: "avulso", data: "2026-09-05" }), "2026-09", "2026-09-30");
    expect(i.projetado).toBeCloseTo(1234.56, 2);
  });
});

describe("impactoDaLista", () => {
  it("soma os dois lados separadamente", () => {
    const l = impactoDaLista([custo({ valor: "3000" }), custo({ id: "c2", valor: "600" })], "2026-09", "2026-09-10");
    expect(l.projetado).toBeCloseTo(3600, 2);
    expect(l.acumulado).toBeLessThan(l.projetado);
  });

  it("um custo em curso basta pra lista não estar fechada", () => {
    const l = impactoDaLista(
      [custo({ freq: "avulso", data: "2026-09-01" }), custo({ id: "c2" })],
      "2026-09", "2026-09-10",
    );
    expect(l.mesFechado).toBe(false);
  });

  it("lista vazia não é mês fechado — é lista vazia", () => {
    expect(impactoDaLista([], "2026-08", "2026-09-15").mesFechado).toBe(false);
  });
});

describe("rotuloDaVigencia", () => {
  it("avulso mostra a data dele", () => {
    expect(rotuloDaVigencia(custo({ freq: "avulso", data: "2026-09-20" }), "2026-09-15")).toBe("em 20/09/2026");
  });

  it("arquivado com fim mostra até quando valeu", () => {
    const r = rotuloDaVigencia(custo({ ativo: false, vigenteAte: "2026-08-31" }), "2026-09-15");
    expect(r).toBe("até 31/08/2026");
  });

  it("arquivado sem fim ainda diz que está arquivado", () => {
    expect(rotuloDaVigencia(custo({ ativo: false }), "2026-09-15")).toBe("arquivado");
  });

  it("custo que ainda não começou diz a partir de quando", () => {
    expect(rotuloDaVigencia(custo({ vigenteDe: "2026-10-01" }), "2026-09-15")).toBe("a partir de 01/10/2026");
  });

  it("custo em vigor diz desde quando", () => {
    expect(rotuloDaVigencia(custo({ vigenteDe: "2026-03-01" }), "2026-09-15")).toBe("desde 01/03/2026");
  });

  it("avulso sem data não inventa data", () => {
    expect(rotuloDaVigencia(custo({ freq: "avulso", data: "" }), "2026-09-15")).toBe("sem data");
  });
});

describe("filtrarCustos", () => {
  const lista = [
    custo({ id: "a", nome: "Água do galpão", categoria: "logistica", centroCusto: "Galpão" }),
    custo({ id: "b", nome: "Contador", categoria: "servico", freq: "mensal" }),
    custo({ id: "c", nome: "Etiquetas", freq: "avulso", observacao: "compra única" }),
    custo({ id: "d", nome: "Antigo", ativo: false }),
  ];

  it("esconde arquivado por padrão", () => {
    expect(filtrarCustos(lista, FILTRO_VAZIO).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("mostra arquivado quando pedido", () => {
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, incluirArquivados: true })).toHaveLength(4);
  });

  it("busca ignora acento nos dois lados — 'agua' acha 'Água'", () => {
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, busca: "agua" }).map((c) => c.id)).toEqual(["a"]);
  });

  it("busca acha pela observação", () => {
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, busca: "única" }).map((c) => c.id)).toEqual(["c"]);
  });

  it("duas palavras é E, não OU", () => {
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, busca: "agua galpao" }).map((c) => c.id)).toEqual(["a"]);
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, busca: "agua contador" })).toHaveLength(0);
  });

  it("filtra por categoria", () => {
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, categorias: ["servico"] }).map((c) => c.id)).toEqual(["b"]);
  });

  it("filtra por frequência", () => {
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, frequencias: ["avulso"] }).map((c) => c.id)).toEqual(["c"]);
  });

  it("filtros combinam", () => {
    const r = filtrarCustos(lista, { ...FILTRO_VAZIO, frequencias: ["mensal"], busca: "contador" });
    expect(r.map((c) => c.id)).toEqual(["b"]);
  });

  it("busca só com espaço não filtra nada", () => {
    expect(filtrarCustos(lista, { ...FILTRO_VAZIO, busca: "   " })).toHaveLength(3);
  });
});

describe("ordenarCustos", () => {
  const lista = [
    custo({ id: "a", nome: "Zebra", valor: "100", vigenteDe: "2026-01-01" }),
    custo({ id: "b", nome: "Alfa", valor: "900", vigenteDe: "2026-07-01" }),
    custo({ id: "c", nome: "Meio", valor: "500", vigenteDe: "2026-03-01" }),
  ];

  it("o padrão é por impacto, maior primeiro — a pergunta é o que custa mais", () => {
    expect(ordenarCustos(lista, "impacto", "2026-09", "2026-09-15").map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("por nome usa ordem do português", () => {
    expect(ordenarCustos(lista, "nome", "2026-09", "2026-09-15").map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("por vigência, o que mudou por último vem primeiro", () => {
    expect(ordenarCustos(lista, "vigencia", "2026-09", "2026-09-15").map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("por valor, maior primeiro", () => {
    expect(ordenarCustos(lista, "valor", "2026-09", "2026-09-15").map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("empate desempata por nome — lista não pode se reorganizar sozinha", () => {
    const iguais = [custo({ id: "z", nome: "Zebra", valor: "100" }), custo({ id: "a", nome: "Alfa", valor: "100" })];
    expect(ordenarCustos(iguais, "valor", "2026-09", "2026-09-15").map((c) => c.id)).toEqual(["a", "z"]);
    expect(ordenarCustos(iguais, "impacto", "2026-09", "2026-09-15").map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("não modifica a lista original", () => {
    const orig = [...lista];
    ordenarCustos(lista, "nome", "2026-09", "2026-09-15");
    expect(lista).toEqual(orig);
  });
});

describe("filtrosAtivos", () => {
  it("nenhum é zero", () => {
    expect(filtrosAtivos(FILTRO_VAZIO)).toBe(0);
  });

  it("conta busca, categoria, frequência e arquivados", () => {
    expect(filtrosAtivos({
      busca: "x", categorias: ["a", "b"], frequencias: ["mensal"], incluirArquivados: true,
    })).toBe(5);
  });

  it("busca só com espaço não conta", () => {
    expect(filtrosAtivos({ ...FILTRO_VAZIO, busca: "  " })).toBe(0);
  });
});

describe("situacaoDoCusto — futuro não é arquivado", () => {
  const HOJE = "2026-09-20";
  it("vigente e sem arquivar é ativo", () => {
    expect(situacaoDoCusto(custo(), HOJE)).toBe("ativo");
  });
  it("a vigência começa depois de hoje: futuro", () => {
    expect(situacaoDoCusto(custo({ vigenteDe: "2026-10-01" }), HOJE)).toBe("futuro");
  });
  it("vigência que já acabou: encerrado", () => {
    expect(situacaoDoCusto(custo({ vigenteAte: "2026-03-31" }), HOJE)).toBe("encerrado");
  });
  it("marcado como arquivado é encerrado, mesmo com a vigência ainda aberta hoje", () => {
    expect(situacaoDoCusto(custo({ ativo: false, vigenteAte: HOJE }), HOJE)).toBe("encerrado");
  });
  it("conta cada situação", () => {
    const lista = [custo({ id: "a" }), custo({ id: "b", vigenteDe: "2026-12-01" }), custo({ id: "c", ativo: false })];
    expect(contarPorSituacao(lista, HOJE)).toEqual({ ativo: 1, futuro: 1, encerrado: 1 });
  });
});

describe("vistaDaLista — quatro situações, quatro mensagens", () => {
  const base = { totalCadastrado: 5, visiveis: 0, incluirArquivados: false, filtroRestritivo: false };
  it("nada cadastrado", () => {
    expect(vistaDaLista({ ...base, totalCadastrado: 0 })).toBe("sem-cadastro");
  });
  it("cinco cadastrados, nenhum ativo, encerrados escondidos: sem-ativos (não 'nenhum cadastrado')", () => {
    expect(vistaDaLista(base)).toBe("sem-ativos");
  });
  it("cinco arquivados e o filtro os mostra: há o que listar", () => {
    expect(vistaDaLista({ ...base, visiveis: 5, incluirArquivados: true })).toBe("com-itens");
  });
  it("busca que esconde tudo é filtro-vazio, não cadastro vazio", () => {
    expect(vistaDaLista({ ...base, filtroRestritivo: true })).toBe("filtro-vazio");
  });
  it("'incluir arquivados' sozinho não é filtro restritivo", () => {
    expect(temFiltroRestritivo({ ...FILTRO_VAZIO, incluirArquivados: true })).toBe(false);
    expect(temFiltroRestritivo({ ...FILTRO_VAZIO, busca: " aluguel " })).toBe(true);
  });
});
