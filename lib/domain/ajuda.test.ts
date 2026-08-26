import { describe, expect, it } from "vitest";
import { TOPICOS, buscarTopicos, normalizar, sugestoesPara } from "./ajuda";

describe("buscarTopicos — acha a resposta certa", () => {
  it("a pergunta do usuário: como altero o custo de entrada", () => {
    const r = buscarTopicos("como altero preço de entrada");
    expect(r[0].id).toBe("editar-entrada");
  });

  it("acha mesmo escrito de outro jeito", () => {
    expect(buscarTopicos("lancei o custo errado, como corrijo?")[0].id).toBe("editar-entrada");
  });

  it("funciona sem acento e em maiúscula", () => {
    expect(buscarTopicos("CUSTO DA COLETA FULL")[0].id).toBe("custo-coleta-full");
  });

  it("pergunta sobre aviso de estoque", () => {
    expect(buscarTopicos("quando recebo alerta de estoque mínimo?")[0].id).toBe("estoque-minimo");
  });

  it("pergunta sobre faturamento que não bate", () => {
    expect(buscarTopicos("o faturamento não bate com o mercado livre")[0].id).toBe("faturamento-nao-bate");
  });

  it("devolve no máximo 3 — não despeja a base inteira", () => {
    expect(buscarTopicos("custo").length).toBeLessThanOrEqual(3);
  });

  it("pergunta sem relação não inventa resposta", () => {
    expect(buscarTopicos("qual a capital da França")).toEqual([]);
  });

  it("texto vazio não devolve nada", () => {
    expect(buscarTopicos("")).toEqual([]);
    expect(buscarTopicos("   ")).toEqual([]);
  });

  it("só palavras vazias não casa com tudo", () => {
    // Sem o filtro, "como eu faço isso" daria match em todo tópico.
    expect(buscarTopicos("como eu faço isso")).toEqual([]);
  });
});

describe("buscarTopicos — a aba atual desempata", () => {
  it("'custo' em Full prioriza coleta; em Estoque prioriza entrada", () => {
    const emFull = buscarTopicos("custo", "full");
    const emEstoque = buscarTopicos("custo", "estoque");
    expect(emFull[0].id).toBe("custo-coleta-full");
    expect(emEstoque[0].id).not.toBe("custo-coleta-full");
  });

  it("a aba NÃO cria relevância onde não havia", () => {
    // Estar na aba Full não faz uma pergunta sobre a França virar resposta.
    expect(buscarTopicos("capital da França", "full")).toEqual([]);
  });
});

describe("sugestoesPara", () => {
  it("sugere o que é da aba atual", () => {
    expect(sugestoesPara("full").some((t) => t.id === "custo-coleta-full")).toBe(true);
  });

  it("sem aba, sugere algo mesmo assim", () => {
    expect(sugestoesPara().length).toBeGreaterThan(0);
  });

  it("aba sem tópico próprio ainda sugere gerais", () => {
    expect(sugestoesPara("aba-que-nao-existe").length).toBeGreaterThan(0);
  });

  it("nunca sugere mais de 3", () => {
    expect(sugestoesPara("estoque").length).toBeLessThanOrEqual(3);
  });
});

describe("base de conhecimento", () => {
  it("todo tópico tem id único", () => {
    const ids = TOPICOS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo tópico tem pergunta, resposta e termos", () => {
    for (const t of TOPICOS) {
      expect(t.pergunta.length).toBeGreaterThan(0);
      expect(t.resposta.length).toBeGreaterThan(0);
      expect(t.termos.length).toBeGreaterThan(0);
    }
  });

  it("os termos estão normalizados — senão nunca casariam", () => {
    for (const t of TOPICOS) {
      for (const termo of t.termos) {
        expect(termo).toBe(normalizar(termo));
      }
    }
  });

  it("toda pergunta da base encontra o próprio tópico", () => {
    // Guarda contra tópico com termos que não batem com a própria pergunta.
    for (const t of TOPICOS) {
      const achados = buscarTopicos(t.pergunta, t.aba).map((x) => x.id);
      expect(achados).toContain(t.id);
    }
  });
});
