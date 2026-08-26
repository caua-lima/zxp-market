import { describe, expect, it } from "vitest";
import {
  distancia, melhores, normalizar, pareceMesmaPalavra, pontuar,
} from "./busca-texto";

const ITENS = [
  { id: "estoque", termos: ["estoque", "produto", "unidades"] },
  { id: "roas-ideal", termos: ["roas ideal", "roas alvo", "ideal", "alvo"] },
  { id: "roas", termos: ["roas", "retorno"] },
  { id: "coleta", termos: ["coleta", "full", "remessa"] },
];

describe("normalizar", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(normalizar("Coleta do FULL?")).toBe("coleta do full");
  });

  it("não cola palavras ao tirar pontuação", () => {
    expect(normalizar("Menta&Cereja")).toBe("menta cereja");
  });

  it("aguenta null e vazio sem quebrar", () => {
    expect(normalizar("")).toBe("");
    expect(normalizar(null as unknown as string)).toBe("");
  });
});

describe("distancia — com corte", () => {
  it("iguais é zero", () => {
    expect(distancia("estoque", "estoque", 1)).toBe(0);
  });

  it("uma letra trocada é 1", () => {
    expect(distancia("extoque", "estoque", 1)).toBe(1);
  });

  it("palavras muito diferentes passam do limite, não devolvem número finito baixo", () => {
    // Sem o corte, isto casaria se o limite fosse generoso.
    expect(distancia("faturamento", "notificacao", 1)).toBeGreaterThan(1);
  });

  it("tamanho muito diferente sai antes de calcular", () => {
    expect(distancia("a", "abcdefgh", 1)).toBeGreaterThan(1);
  });
});

describe("pareceMesmaPalavra — perdoa erro só onde é seguro", () => {
  it("perdoa uma letra em palavra longa", () => {
    expect(pareceMesmaPalavra("extoque", "estoque")).toBe(true);
    expect(pareceMesmaPalavra("custu", "custo")).toBe(true);
  });

  it("NÃO perdoa em palavra curta — vira outra palavra", () => {
    // "full"/"fill", "ads"/"add": uma letra muda o significado.
    expect(pareceMesmaPalavra("fill", "full")).toBe(false);
    expect(pareceMesmaPalavra("add", "ads")).toBe(false);
  });

  it("duas letras erradas já não passa", () => {
    expect(pareceMesmaPalavra("extoqui", "estoque")).toBe(false);
  });

  it("plural comum casa com o singular", () => {
    expect(pareceMesmaPalavra("custos", "custo")).toBe(true);
    expect(pareceMesmaPalavra("meta", "metas")).toBe(true);
  });

  it("plural de -ão casa — é a forma das palavras centrais daqui", () => {
    // devoluções, notificações, impressões, promoções.
    expect(pareceMesmaPalavra("devolucoes", "devolucao")).toBe(true);
    expect(pareceMesmaPalavra("impressoes", "impressao")).toBe(true);
    expect(pareceMesmaPalavra("notificacoes", "notificacao")).toBe(true);
  });

  it("plural não junta palavras diferentes que terminam igual", () => {
    expect(pareceMesmaPalavra("acoes", "opcao")).toBe(false);
  });
});

describe("pontuar — pesos", () => {
  it("expressão composta vale mais que termo solto", () => {
    const r = pontuar("qual o roas ideal", ITENS);
    expect(r[0].item.id).toBe("roas-ideal");
  });

  it("termo solto ainda ganha de quem não casou", () => {
    expect(pontuar("o que é roas", ITENS)[0].item.id).toBe("roas");
  });

  it("erro de digitação casa, com peso menor", () => {
    const r = pontuar("extoque", ITENS);
    expect(r[0].item.id).toBe("estoque");
  });

  it("só palavras vazias não casa com nada", () => {
    expect(pontuar("como eu faço isso", ITENS)).toEqual([]);
  });

  it("texto vazio devolve vazio", () => {
    expect(pontuar("", ITENS)).toEqual([]);
    expect(pontuar("   ", ITENS)).toEqual([]);
  });

  it("assunto fora da base não casa", () => {
    expect(pontuar("capital da França", ITENS)).toEqual([]);
  });

  it("ordena do mais pontuado pro menos", () => {
    const r = pontuar("roas ideal alvo", ITENS);
    expect(r[0].pontos).toBeGreaterThanOrEqual(r[r.length - 1].pontos);
  });
});

describe("melhores — corta o ruído", () => {
  it("descarta quem ficou com menos da metade do primeiro", () => {
    // "roas ideal" casa forte em roas-ideal e fraco em roas.
    const r = melhores("qual o roas ideal", ITENS);
    expect(r[0].id).toBe("roas-ideal");
    expect(r.map((x) => x.id)).not.toContain("coleta");
  });

  it("respeita o máximo pedido", () => {
    expect(melhores("roas ideal alvo estoque coleta", ITENS, 2).length).toBeLessThanOrEqual(2);
  });

  it("nada casou devolve lista vazia, não o primeiro item", () => {
    expect(melhores("capital da França", ITENS)).toEqual([]);
  });

  it("empate real devolve os dois — a pergunta é ambígua mesmo", () => {
    const itens = [
      { id: "a", termos: ["custo"] },
      { id: "b", termos: ["custo"] },
    ];
    expect(melhores("custo", itens).length).toBe(2);
  });
});
