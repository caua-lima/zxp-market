import { describe, expect, it } from "vitest";
import {
  TOPICOS_ADS, buscarConceitos, conceitosSugeridos, normalizar, type ContextoAds,
} from "./ads-conhecimento";

function ctx(over: Partial<ContextoAds> = {}): ContextoAds {
  return {
    comInvestimento: 12,
    investidoTotal: 429.97,
    vendaDiretaTotal: 5300,
    vendaTotal: 19476,
    metaMargem: 10,
    abaixoDoBreakEven: 3,
    abaixoDoIdeal: 5,
    negativosAntesDoAds: 2,
    roasIdealMedio: 6.2,
    semVinculo: 1,
    ...over,
  };
}

describe("buscarConceitos — responde pergunta de conhecimento", () => {
  it("'o que é ROAS' acha o conceito de ROAS", () => {
    expect(buscarConceitos("o que é ROAS?")[0].id).toBe("roas");
  });

  it("'qual o ROAS ideal' acha o tópico de ROAS ideal, não o de ROAS", () => {
    expect(buscarConceitos("qual o roas ideal?")[0].id).toBe("roas-ideal");
  });

  it("'meu roas está ótimo mas dá prejuízo' acha a explicação certa", () => {
    expect(buscarConceitos("meu roas está ótimo mas dá prejuízo")[0].id).toBe("roas-alto-prejuizo");
  });

  it("'devo desligar anúncio no vermelho' cai em dependência", () => {
    expect(buscarConceitos("devo desligar um anúncio no vermelho?")[0].id).toBe("dependencia");
  });

  it("'quanto de orçamento' acha orçamento", () => {
    expect(buscarConceitos("quanto devo colocar de orçamento diário?")[0].id).toBe("orcamento");
  });

  it("'diferença entre acos e tacos'", () => {
    expect(buscarConceitos("qual a diferença entre acos e tacos?")[0].id).toBe("acos-tacos");
  });

  it("funciona sem acento e em maiúscula", () => {
    expect(buscarConceitos("BREAK EVEN")[0].id).toBe("break-even");
  });

  it("devolve no máximo 2 — resposta curta é resposta lida", () => {
    expect(buscarConceitos("roas").length).toBeLessThanOrEqual(2);
  });

  it("pergunta fora do assunto não inventa conceito", () => {
    expect(buscarConceitos("qual a capital da França")).toEqual([]);
  });

  it("só palavras vazias não casa com tudo", () => {
    expect(buscarConceitos("o que é isso")).toEqual([]);
  });

  it("prefixo curto demais não casa — 'ro' não é 'roas'", () => {
    expect(buscarConceitos("ro")).toEqual([]);
  });
});

describe("contextualizar — o conceito vem com o SEU número", () => {
  it("ROAS cita o investido e a venda direta reais", () => {
    const t = TOPICOS_ADS.find((x) => x.id === "roas")!;
    const frase = t.contextualizar!(ctx());
    expect(frase).toMatch(/429,97|429\.97/);
    expect(frase).toMatch(/12,33x/); // 5300 / 429,97
  });

  it("break-even avisa quantos anúncios estão abaixo", () => {
    const t = TOPICOS_ADS.find((x) => x.id === "break-even")!;
    expect(t.contextualizar!(ctx({ abaixoDoBreakEven: 3 }))).toMatch(/3 anúncio/);
  });

  it("break-even diz que está tudo bem quando nenhum está abaixo", () => {
    const t = TOPICOS_ADS.find((x) => x.id === "break-even")!;
    expect(t.contextualizar!(ctx({ abaixoDoBreakEven: 0 }))).toMatch(/nenhum/i);
  });

  it("ROAS ideal usa a meta de margem configurada", () => {
    const t = TOPICOS_ADS.find((x) => x.id === "roas-ideal")!;
    const frase = t.contextualizar!(ctx({ metaMargem: 15, roasIdealMedio: 6.2 }));
    expect(frase).toMatch(/15,0%/);
    expect(frase).toMatch(/6,20x/);
  });

  it("sem investimento não inventa frase — devolve null", () => {
    const t = TOPICOS_ADS.find((x) => x.id === "roas")!;
    expect(t.contextualizar!(ctx({ investidoTotal: 0 }))).toBeNull();
  });

  it("sem anúncio negativo antes do ads, não afirma que há", () => {
    const t = TOPICOS_ADS.find((x) => x.id === "roas-alto-prejuizo")!;
    expect(t.contextualizar!(ctx({ negativosAntesDoAds: 0 }))).toBeNull();
  });

  it("nenhuma contextualização devolve NaN ou undefined", () => {
    const vazio = ctx({
      comInvestimento: 0, investidoTotal: 0, vendaDiretaTotal: 0, vendaTotal: 0,
      abaixoDoBreakEven: 0, abaixoDoIdeal: 0, negativosAntesDoAds: 0,
      roasIdealMedio: null, semVinculo: 0,
    });
    for (const t of TOPICOS_ADS) {
      const frase = t.contextualizar?.(vazio);
      if (frase != null) expect(frase).not.toMatch(/NaN|undefined|null|Infinity/);
    }
  });
});

describe("base de conhecimento", () => {
  it("todo tópico tem id único", () => {
    const ids = TOPICOS_ADS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo tópico tem pergunta, resposta e termos", () => {
    for (const t of TOPICOS_ADS) {
      expect(t.pergunta.length).toBeGreaterThan(0);
      expect(t.resposta.length).toBeGreaterThan(30);
      expect(t.termos.length).toBeGreaterThan(0);
    }
  });

  it("os termos estão normalizados — senão nunca casariam", () => {
    for (const t of TOPICOS_ADS) {
      for (const termo of t.termos) expect(termo).toBe(normalizar(termo));
    }
  });

  it("toda pergunta da base encontra o próprio tópico", () => {
    for (const t of TOPICOS_ADS) {
      expect(buscarConceitos(t.pergunta).map((x) => x.id)).toContain(t.id);
    }
  });

  it("o texto fixo não afirma estado ATUAL — isso é papel do contextualizar", () => {
    /**
     * Exemplo didático com número redondo ("cada R$ 1 trouxe R$ 5") é
     * legítimo e ajuda a explicar. O que não pode é o texto fixo falar do
     * agora, porque ele envelhece e vira mentira. Frases sobre o estado atual
     * só podem vir de contextualizar(), que recebe os dados medidos.
     */
    for (const t of TOPICOS_ADS) {
      expect(t.resposta).not.toMatch(/agora|no período|seus anúncios estão/i);
    }
  });

  it("as sugestões existem na base", () => {
    const ids = TOPICOS_ADS.map((t) => t.id);
    for (const s of conceitosSugeridos()) expect(ids).toContain(s.id);
  });
});
