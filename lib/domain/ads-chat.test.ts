import { describe, expect, it } from "vitest";
import { casarAnuncios, interpretarPergunta, normalizar } from "./ads-chat";

const TITULOS = [
  "Bala Menta Stronger 50un",
  "Bala Menta & Cereja 40un",
  "Chiclete Tutti Frutti",
  "Pastilha Eucalipto Extra Forte",
];

describe("normalizar", () => {
  it("tira acento e caixa", () => {
    expect(normalizar("Eucalípto EXTRA")).toBe("eucalipto extra");
  });

  it("tira pontuação sem colar as palavras", () => {
    expect(normalizar("Menta & Cereja")).toBe("menta cereja");
  });
});

describe("casarAnuncios — não pode responder sobre o produto errado", () => {
  it("acha o produto pelo nome parcial", () => {
    expect(casarAnuncios("menta stronger", TITULOS)).toEqual([0]);
  });

  it("'menta stronger' NÃO casa com 'Menta & Cereja'", () => {
    // A pior falha possível: responder com confiança sobre outro produto.
    const alvos = casarAnuncios("menta stronger", TITULOS);
    expect(alvos).not.toContain(1);
  });

  it("'menta' sozinho casa com os dois de menta", () => {
    expect(casarAnuncios("menta", TITULOS)).toEqual([0, 1]);
  });

  it("ignora as palavras da pergunta, casa só o produto", () => {
    expect(casarAnuncios("o que eu devo fazer com o menta stronger?", TITULOS)).toEqual([0]);
  });

  it("funciona sem acento e em maiúscula", () => {
    expect(casarAnuncios("EUCALIPTO", TITULOS)).toEqual([3]);
  });

  it("não casa nada quando o produto não existe", () => {
    expect(casarAnuncios("chocolate belga", TITULOS)).toEqual([]);
  });

  it("pergunta só com palavras vazias não casa com tudo", () => {
    // Sem o filtro de stopwords, "o que fazer" daria match em todos.
    expect(casarAnuncios("o que devo fazer", TITULOS)).toEqual([]);
  });
});

describe("interpretarPergunta — intenção", () => {
  it("'o que é melhor fazer com o menta stronger' = analisar", () => {
    const r = interpretarPergunta("o que é o melhor a se fazer do ads da campanha do menta stronger", TITULOS);
    expect(r.intencao).toBe("analisar");
    expect(r.alvos).toEqual([0]);
  });

  it("'me traga as infos do eucalipto' = info", () => {
    const r = interpretarPergunta("me traga as infos de ads do eucalipto", TITULOS);
    expect(r.intencao).toBe("info");
    expect(r.alvos).toEqual([3]);
  });

  it("'o que está dando prejuízo' = varredura, não produto", () => {
    const r = interpretarPergunta("o que está dando prejuízo?", TITULOS);
    expect(r.intencao).toBe("listar-ruins");
    expect(r.alvos).toEqual([]);
  });

  it("'o que está lucrando' = listar bons", () => {
    expect(interpretarPergunta("quais estão lucrando?", TITULOS).intencao).toBe("listar-bons");
  });

  it("'como está o ads no geral' = resumo", () => {
    expect(interpretarPergunta("como está o ads no geral?", TITULOS).intencao).toBe("resumo");
  });

  it("só o nome do produto já vale como análise", () => {
    const r = interpretarPergunta("tutti frutti", TITULOS);
    expect(r.intencao).toBe("analisar");
    expect(r.alvos).toEqual([2]);
  });

  it("produto inexistente com intenção clara vira nao-encontrado", () => {
    const r = interpretarPergunta("o que faço com o chocolate belga?", TITULOS);
    expect(r.intencao).toBe("nao-encontrado");
    expect(r.termo).toContain("chocolate");
  });

  it("texto vazio pede ajuda em vez de adivinhar", () => {
    expect(interpretarPergunta("   ", TITULOS).intencao).toBe("ajuda");
  });

  it("'desligar' é lido como varredura do que está ruim", () => {
    expect(interpretarPergunta("o que eu devo desligar?", TITULOS).intencao).toBe("listar-ruins");
  });
});

describe("interpretarPergunta — entender x varrer", () => {
  it("'o que está dando prejuízo' VARRE; 'meu roas é ótimo mas dá prejuízo' EXPLICA", () => {
    // As duas contêm "prejuízo". O que separa é a marca de entendimento.
    expect(interpretarPergunta("o que está dando prejuízo?", TITULOS).intencao).toBe("listar-ruins");
    expect(interpretarPergunta("meu roas está ótimo mas dá prejuízo, por quê?", TITULOS).intencao).toBe("conceito");
  });

  it("'o que devo desligar' VARRE; 'devo desligar no vermelho?' EXPLICA a regra", () => {
    // "o que devo" pergunta QUAIS; "devo" no início pergunta a regra.
    expect(interpretarPergunta("o que eu devo desligar?", TITULOS).intencao).toBe("listar-ruins");
    expect(interpretarPergunta("devo desligar anúncio no vermelho?", TITULOS).intencao).toBe("conceito");
  });

  it("'quais estão lucrando' VARRE; 'quando vale a pena escalar' EXPLICA", () => {
    expect(interpretarPergunta("quais estão lucrando?", TITULOS).intencao).toBe("listar-bons");
    expect(interpretarPergunta("quando vale a pena escalar?", TITULOS).intencao).toBe("conceito");
  });

  it("conceito NÃO rouba pergunta sobre produto específico", () => {
    // "o que fazer com o Menta" tem "o que"; produto é mais específico e ganha.
    const r = interpretarPergunta("o que fazer com o menta stronger?", TITULOS);
    expect(r.intencao).toBe("analisar");
    expect(r.alvos).toEqual([0]);
  });

  it("marca de entendimento sem conceito que responda NÃO vira conceito", () => {
    // Só desvia quando há resposta; senão a varredura continua melhor.
    expect(interpretarPergunta("por que a capital da França?", TITULOS).intencao).not.toBe("conceito");
  });

  it("perguntas de conceito puras", () => {
    for (const [q, esperado] of [
      ["o que é ROAS?", "conceito"],
      ["qual o ROAS ideal?", "conceito"],
      ["quanto devo colocar de orçamento?", "conceito"],
      ["qual a diferença entre ACOS e TACOS?", "conceito"],
      ["o que são CTR e CPC?", "conceito"],
    ] as const) {
      expect(interpretarPergunta(q, TITULOS).intencao).toBe(esperado);
    }
  });
});
