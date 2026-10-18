import { describe, expect, it } from "vitest";
import { larguraDaBarra, PESO_DO_TOM, seloDaDecisao } from "./ads-decisao";

describe("seloDaDecisao", () => {
  it("cada ação vira uma palavra e um tom", () => {
    expect(seloDaDecisao({ acao: "escalar", label: "Escalar com cautela" })).toEqual({ rotulo: "Escalar", tom: "bom" });
    expect(seloDaDecisao({ acao: "pausar", label: "Revisar ou reduzir — prejuízo confirmado" })).toEqual({ rotulo: "Prejuízo", tom: "ruim" });
    expect(seloDaDecisao({ acao: "reduzir", label: "Revisar ou reduzir orçamento" })).toEqual({ rotulo: "Revisar", tom: "atencao" });
  });
  it("'dentro do esperado' é Manter; o resto sem dado é Sem dados", () => {
    expect(seloDaDecisao({ acao: "sem-dados", label: "Dentro do esperado — nada a ajustar agora" })).toEqual({ rotulo: "Manter", tom: "neutro" });
    expect(seloDaDecisao({ acao: "sem-dados", label: "Sem cliques no período" })).toEqual({ rotulo: "Sem dados", tom: "vazio" });
    expect(seloDaDecisao({ acao: "sem-dados", label: "Volume baixo pra concluir (3 clique(s) de 30)" }).rotulo).toBe("Sem dados");
  });
  it("prejuízo vem antes de tudo na ordem de urgência", () => {
    const tons = (["vazio", "bom", "ruim", "neutro", "atencao"] as const).slice().sort((a, b) => PESO_DO_TOM[a] - PESO_DO_TOM[b]);
    expect(tons).toEqual(["ruim", "atencao", "bom", "neutro", "vazio"]);
  });
});

describe("larguraDaBarra", () => {
  it("fica entre 0 e 100", () => {
    expect(larguraDaBarra(72)).toBe(72);
    expect(larguraDaBarra(117)).toBe(100);
    expect(larguraDaBarra(-3)).toBe(0);
    expect(larguraDaBarra(NaN)).toBe(0);
  });
});
