import { describe, expect, it } from "vitest";
import { chaveOrdenacao, corDoRoas } from "./ads-cores";

describe("corDoRoas — contra o equilibrio do anuncio, nao um corte fixo", () => {
  it("margem fina: 3,2x era VERDE e queimava dinheiro", () => {
    /**
     * O corte era `r >= 3 ? verde`. Um produto de margem fina precisa de mais
     * de 12x pra empatar — aos 3,2x ele perde dinheiro em toda venda, e a tela
     * pintava verde. A cor apontava pro lado errado justamente onde a decisao
     * e dificil.
     */
    const r = corDoRoas(3.2, 12.5, 18);
    expect(r.faixa).toBe("perde");
    expect(r.cor).toBe("var(--red)");
    expect(r.motivo).toContain("12.50x");
  });

  it("margem gorda: 2,8x era AMARELO e estava lucrativo", () => {
    const r = corDoRoas(2.8, 2.5, 3.4);
    expect(r.faixa).toBe("empata");
    expect(r.cor).toBe("var(--yellow)");
  });

  it("acima do ideal fecha a margem alvo", () => {
    const r = corDoRoas(20, 12.5, 18);
    expect(r.faixa).toBe("fecha");
    expect(r.cor).toBe("var(--green)");
  });

  it("exatamente no equilibrio nao perde", () => {
    // Empatar e empatar: nao e prejuizo.
    expect(corDoRoas(12.5, 12.5, 18).faixa).toBe("empata");
  });

  it("exatamente no ideal ja fecha", () => {
    expect(corDoRoas(18, 12.5, 18).faixa).toBe("fecha");
  });

  it("sem ideal alcancavel, passar do equilibrio ja e verde", () => {
    // roasIdeal null = o produto nao alcanca a margem alvo nem gastando zero.
    // Exigir um alvo inexistente deixaria a linha amarela pra sempre.
    const r = corDoRoas(15, 12.5, null);
    expect(r.faixa).toBe("fecha");
    expect(r.motivo).toContain("Não há margem alvo");
  });
});

describe("corDoRoas — quando nao da pra saber", () => {
  it("sem ROAS a celula nao recebe veredicto", () => {
    /**
     * A celula mostra "—" quando nao houve investimento, mas a cor caia num
     * valor ALTERNATIVO (`corRoas(l.roasMlAds ?? l.r)`): uma linha exibindo
     * traco aparecia pintada de verde ou vermelho.
     */
    for (const v of [null, undefined, Number.NaN]) {
      const r = corDoRoas(v, 12.5, 18);
      expect(r.faixa).toBe("sem_dado");
      expect(r.cor).toBe("var(--muted)");
    }
  });

  it("sem equilibrio conhecido, usa o generico E avisa que e generico", () => {
    const r = corDoRoas(3.5, null, null);
    expect(r.cor).toBe("var(--green)");
    expect(r.motivo).toContain("genérica");
  });

  it("equilibrio invalido conta como desconhecido", () => {
    expect(corDoRoas(3.5, 0, null).motivo).toContain("genérica");
    expect(corDoRoas(3.5, -2, null).motivo).toContain("genérica");
  });

  it("ROAS zero e um valor, nao ausencia", () => {
    // Investiu e nao vendeu nada: isso e vermelho, nao "sem dado".
    const r = corDoRoas(0, 12.5, 18);
    expect(r.faixa).toBe("perde");
  });
});

describe("chaveOrdenacao — ausente vai pro fim nos DOIS sentidos", () => {
  it("crescente joga o ausente pro fim", () => {
    expect(chaveOrdenacao(null, 1)).toBe(Infinity);
  });

  it("decrescente tambem joga o ausente pro fim", () => {
    /**
     * Com -Infinity fixo, inverter a ordem trazia os "sem dado" pro TOPO — e
     * eles ocupavam o lugar dos piores de verdade, que e o que se procura ao
     * ordenar.
     */
    expect(chaveOrdenacao(null, -1)).toBe(-Infinity);
  });

  it("valor presente passa direto", () => {
    expect(chaveOrdenacao(3.5, 1)).toBe(3.5);
    expect(chaveOrdenacao(0, 1)).toBe(0);
    expect(chaveOrdenacao(-2, 1)).toBe(-2);
  });

  it("NaN conta como ausente", () => {
    expect(chaveOrdenacao(Number.NaN, 1)).toBe(Infinity);
  });
});
