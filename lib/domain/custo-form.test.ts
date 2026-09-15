import { describe, expect, it } from "vitest";
import { parseBRNumber, totalCustosMes } from "./calc";
import type { Cost } from "./types";
import {
  custoDe,
  impactoNoMes,
  lerValorEmReais,
  mesDeReferencia,
  podeSalvar,
  rascunhoDe,
  rascunhoVazio,
  validarCusto,
  type RascunhoCusto,
} from "./custo-form";

const HOJE = "2026-09-10";

const rascunho = (over: Partial<RascunhoCusto> = {}): RascunhoCusto => ({
  ...rascunhoVazio({ hojeISO: HOJE }),
  nome: "Contador",
  valorTexto: "250,00",
  ...over,
});

describe("lerValorEmReais — como um brasileiro digita", () => {
  it("vírgula decimal, com e sem milhar", () => {
    expect(lerValorEmReais("1.234,56")).toBe(1234.56);
    expect(lerValorEmReais("1234,56")).toBe(1234.56);
    expect(lerValorEmReais("12,5")).toBe(12.5);
  });

  it("'1.234' é MIL duzentos e trinta e quatro, não 1,234", () => {
    /**
     * A leitura antiga (parseFloat) dava 1,234 — um custo mil vezes menor
     * que o digitado, sem nenhum aviso.
     */
    expect(lerValorEmReais("1.234")).toBe(1234);
    expect(lerValorEmReais("1.234.567")).toBe(1234567);
  });

  it("ponto com 1 ou 2 casas continua sendo decimal", () => {
    expect(lerValorEmReais("12.50")).toBe(12.5);
    expect(lerValorEmReais("12.5")).toBe(12.5);
    expect(lerValorEmReais("0.500")).toBe(0.5);
  });

  it("aceita o formato americano quando ele é inequívoco", () => {
    expect(lerValorEmReais("1,234.56")).toBe(1234.56);
  });

  it("tira R$ e espaços", () => {
    expect(lerValorEmReais("R$ 50")).toBe(50);
    expect(lerValorEmReais("  R$1.000,00 ")).toBe(1000);
  });

  it("arredonda pra centavo", () => {
    expect(lerValorEmReais("10,999")).toBe(11);
  });

  it("devolve null em vez de chutar", () => {
    expect(lerValorEmReais("")).toBeNull();
    expect(lerValorEmReais("abc")).toBeNull();
    expect(lerValorEmReais("1,2,3")).toBeNull();
    expect(lerValorEmReais("-50")).toBeNull();
    expect(lerValorEmReais(null)).toBeNull();
  });
});

describe("validarCusto", () => {
  it("rascunho completo passa", () => {
    expect(validarCusto(rascunho())).toEqual({});
    expect(podeSalvar(rascunho())).toBe(true);
  });

  it("sem nome não salva", () => {
    expect(validarCusto(rascunho({ nome: "   " })).nome).toMatch(/nome/);
  });

  it("sem valor, valor ilegível e valor zero têm mensagens diferentes", () => {
    // Cada caso pede uma correção diferente — uma mensagem só não diria qual.
    expect(validarCusto(rascunho({ valorTexto: "" })).valor).toMatch(/Informe/);
    expect(validarCusto(rascunho({ valorTexto: "abc" })).valor).toMatch(/Não consegui ler/);
    expect(validarCusto(rascunho({ valorTexto: "0" })).valor).toMatch(/maior que zero/);
  });

  it("avulso exige data; mensal não", () => {
    expect(validarCusto(rascunho({ freq: "avulso", data: "" })).data).toMatch(/data/);
    expect(validarCusto(rascunho({ freq: "mensal", data: "" })).data).toBeUndefined();
  });

  it("nome gigante é recusado", () => {
    expect(validarCusto(rascunho({ nome: "x".repeat(81) })).nome).toMatch(/longo/);
  });
});

describe("custoDe — o documento que vai pro banco", () => {
  it("grava o valor SEMPRE como '1234.56'", () => {
    /**
     * A rota de métricas lê com Number(). Number("1.234,56") é NaN, e um NaN
     * em custosOp contamina o lucro do Dashboard inteiro.
     */
    const c = custoDe(rascunho({ valorTexto: "1.234,56" }), "c1");
    expect(c.valor).toBe("1234.56");
    expect(Number(c.valor)).toBe(1234.56);
    expect(parseBRNumber(c.valor)).toBe(1234.56);
  });

  it("não grava opcional vazio como string vazia", () => {
    const c = custoDe(rascunho({ centroCusto: "  ", observacao: "" }), "c1");
    expect("centroCusto" in c).toBe(false);
    expect("observacao" in c).toBe(false);
    expect("categoria" in c).toBe(false);
  });

  it("apara o nome", () => {
    expect(custoDe(rascunho({ nome: "  Contador  " }), "c1").nome).toBe("Contador");
  });

  it("editar um custo arquivado NÃO o desarquiva", () => {
    const arquivado: Cost = {
      id: "c1", nome: "Velho", valor: "10.00", freq: "mensal", data: HOJE, ativo: false,
    };
    const c = custoDe(rascunhoDe(arquivado, HOJE), "c1", arquivado);
    expect(c.ativo).toBe(false);
  });

  it("recusa gravar rascunho inválido em vez de gravar lixo", () => {
    expect(() => custoDe(rascunho({ valorTexto: "abc" }), "c1")).toThrow();
    expect(() => custoDe(rascunho({ nome: "" }), "c1")).toThrow();
  });
});

describe("rascunhoDe e rascunhoVazio", () => {
  it("o custo novo nasce MENSAL, não diário", () => {
    // R$ 250 esquecido em "diário" vira R$ 7.500 no mês.
    expect(rascunhoVazio({ hojeISO: HOJE }).freq).toBe("mensal");
  });

  it("pela DRE, nasce como despesa da empresa", () => {
    expect(rascunhoVazio({ hojeISO: HOJE, escopo: "dre" }).escopo).toBe("dre");
    expect(rascunhoVazio({ hojeISO: HOJE }).escopo).toBe("dash");
  });

  it("ao editar, o valor volta em pt-BR", () => {
    const c: Cost = { id: "c1", nome: "Contabilidade", valor: "250.00", freq: "mensal", data: HOJE, escopo: "dre" };
    expect(rascunhoDe(c, HOJE).valorTexto).toBe("250,00");
  });

  it("ida e volta preserva o custo", () => {
    const c: Cost = {
      id: "c1", nome: "Contabilidade", valor: "1234.56", freq: "mensal", data: HOJE,
      escopo: "dre", categoria: "contabilidade", observacao: "até dez",
    };
    expect(custoDe(rascunhoDe(c, HOJE), "c1", c)).toEqual(c);
  });
});

describe("impactoNoMes — a prévia antes de salvar", () => {
  it("é a MESMA conta dos totais da aba", () => {
    /**
     * Uma prévia com conta própria prometeria um número e a tela mostraria
     * outro depois de salvo — a origem conhecida de quase todo valor errado
     * nesta base.
     */
    const r = rascunho({ valorTexto: "30", freq: "diario" });
    const esperado = totalCustosMes([custoDe(r, "x")], "2026-09", r.data);
    expect(impactoNoMes(r, "2026-09")!.valor).toBe(esperado);
  });

  it("diário criado hoje cobra só os dias que restam do mês", () => {
    /**
     * Antes multiplicava pelos 30 dias de setembro inteiro, mesmo sendo
     * cadastrado no dia 14 — cobrava treze dias em que a despesa não existia.
     */
    // HOJE = 2026-09-10, entao restam os dias 10..30 = 21 dias.
    const r = rascunho({ valorTexto: "30", freq: "diario" });
    expect(impactoNoMes(r, "2026-09")).toEqual({ valor: 30 * 21, mes: "2026-09" });
  });

  it("mensal criado no meio do mês só pesa no mês SEGUINTE", () => {
    /**
     * A prévia dizia "vai pesar R$ 250 em setembro". Não vai: custo mensal
     * entra por competência, uma vez por mês de calendário inteiramente
     * vigente, e setembro já estava pela metade quando a despesa nasceu. Na
     * DRE ele aparece em outubro — e a prévia prometia o que a tela seguinte
     * desmentiria.
     */
    expect(impactoNoMes(rascunho({ valorTexto: "250" }), "2026-09"))
      .toEqual({ valor: 250, mes: "2026-10" });
  });

  it("mensal criado no dia 1º pesa no próprio mês", () => {
    const r = rascunho({ valorTexto: "250", data: "2026-09-01" });
    expect(impactoNoMes(r, "2026-09")).toEqual({ valor: 250, mes: "2026-09" });
  });

  it("a virada de ano acha o mês certo", () => {
    const r = rascunho({ valorTexto: "250", data: "2026-12-10" });
    expect(impactoNoMes(r, "2026-12")).toEqual({ valor: 250, mes: "2027-01" });
  });

  it("avulso só pesa no mês da própria data", () => {
    const r = rascunho({ valorTexto: "400", freq: "avulso", data: "2026-08-15" });
    expect(impactoNoMes(r, "2026-08")).toEqual({ valor: 400, mes: "2026-08" });
    // Consultando setembro, o único mês em que pesa continua sendo agosto —
    // e como ele está no PASSADO, a busca à frente não o encontra.
    expect(impactoNoMes(r, "2026-09")).toBeNull();
  });

  it("sem valor legível não há prévia", () => {
    expect(impactoNoMes(rascunho({ valorTexto: "abc" }), "2026-09")).toBeNull();
  });
});

describe("mesDeReferencia", () => {
  it("avulso usa o mês da data; o resto usa o mês corrente", () => {
    expect(mesDeReferencia(rascunho({ freq: "avulso", data: "2026-08-15" }), HOJE)).toBe("2026-08");
    expect(mesDeReferencia(rascunho({ freq: "mensal" }), HOJE)).toBe("2026-09");
    expect(mesDeReferencia(rascunho({ freq: "diario" }), HOJE)).toBe("2026-09");
  });
});
