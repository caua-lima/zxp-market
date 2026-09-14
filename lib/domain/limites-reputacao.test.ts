import { describe, expect, it } from "vitest";
import {
  baseDaMetrica,
  baseImplicita,
  dentroDoLimite,
  emPorcento,
  FAIXAS_MLB,
  folgaEmCasos,
  lerMetrica,
  periodoDaMetrica,
  TETOS,
} from "./limites-reputacao";

describe("dentroDoLimite — a igualdade em que os painéis discordavam", () => {
  it("abaixo do teto passa", () => {
    expect(dentroDoLimite(0.009, 0.01)).toBe(true);
  });

  it("acima do teto não passa", () => {
    expect(dentroDoLimite(0.011, 0.01)).toBe(false);
  });

  it("EXATAMENTE no teto passa — a documentação oficial decide", () => {
    /**
     * `reputation.ts` fazia `pct > limite` (igual = ok) e
     * `proxima-medalha.ts` fazia `taxa < limite` (igual = NÃO ok). Os dois
     * painéis ficam lado a lado na aba Desempenho: com a taxa no teto, um
     * pintava verde e o outro dizia que a medalha não sai.
     *
     * A tabela oficial do MLB marca a faixa vermelha como "> 8%", ou seja, 8%
     * ainda é laranja. Os limites são inclusivos, e quem estava certo era o
     * reputation.ts.
     */
    expect(dentroDoLimite(0.01, 0.01)).toBe(true);
    expect(dentroDoLimite(0.005, 0.005)).toBe(true);
    expect(dentroDoLimite(0.06, 0.06)).toBe(true);
    expect(dentroDoLimite(0.08, 0.08)).toBe(true);
  });

  it("ruído de ponto flutuante não decide o resultado", () => {
    // 3 * 0.02 não é exatamente 0.06 em binário.
    expect(dentroDoLimite(3 * 0.02, 0.06)).toBe(true);
    expect(dentroDoLimite(0.1 + 0.02 - 0.06, 0.06)).toBe(true);
  });

  it("zero sempre passa", () => {
    expect(dentroDoLimite(0, 0.01)).toBe(true);
  });
});

describe("folgaEmCasos — derivada do comparador, nunca em paralelo com ele", () => {
  it("a folga é sempre exatamente o máximo que o comparador aceita", () => {
    /**
     * A propriedade que amarra as duas coisas, varrida numa grade. É ela que
     * impede a volta do bug: a folga não é calculada ao lado do comparador,
     * é definida por ele.
     */
    for (const base of [50, 100, 137, 500, 937, 1000, 1725]) {
      for (const teto of [0.01, 0.005, 0.06, 0.02, 0.015, 0.1]) {
        for (const casos of [0, 1, 3, 10]) {
          const k = folgaEmCasos(casos, base, teto);
          if (k == null) continue;
          const ctx = `base=${base} teto=${teto} casos=${casos} folga=${k}`;

          if (!dentroDoLimite(casos / base, teto)) {
            // Já estourado: a única resposta honesta é zero.
            expect(k, ctx + " ja estourado deveria dar folga zero").toBe(0);
            continue;
          }

          expect(dentroDoLimite((casos + k) / base, teto), ctx + " deveria passar").toBe(true);
          // E um a mais NÃO pode passar — senão a folga estaria apertada demais.
          expect(dentroDoLimite((casos + k + 1) / base, teto), ctx + " deveria ser o maximo").toBe(false);
        }
      }
    }
  });

  it("o caso de fronteira em que as duas contas divergiam", () => {
    // 100 vendas, teto 1%: cabe 1, e 1/100 = exatamente 1%, que passa.
    expect(folgaEmCasos(0, 100, 0.01)).toBe(1);
    expect(dentroDoLimite(1 / 100, 0.01)).toBe(true);
    expect(dentroDoLimite(2 / 100, 0.01)).toBe(false);
  });

  it("os números reais da conta em 01/09/2026 continuam valendo", () => {
    // 937 vendas, 2 envios com atraso, teto de 6%: 6% de 937 = 56,22.
    expect(folgaEmCasos(2, 937, 0.06)).toBe(54);
    // 1% de 937 = 9,37 — cabem 9, e 9/937 = 0,96% ainda passa.
    expect(folgaEmCasos(0, 937, 0.01)).toBe(9);
    // 0,5% de 937 = 4,685.
    expect(folgaEmCasos(0, 937, 0.005)).toBe(4);
  });

  it("já estourado tem folga zero, nunca negativa", () => {
    expect(folgaEmCasos(47, 937, 0.01)).toBe(0);
    expect(folgaEmCasos(100, 100, 0.01)).toBe(0);
  });

  it("sem base não há folga", () => {
    expect(folgaEmCasos(0, 0, 0.01)).toBeNull();
    expect(folgaEmCasos(0, -5, 0.01)).toBeNull();
    expect(folgaEmCasos(0, Number.NaN, 0.01)).toBeNull();
  });
});

describe("lerMetrica — vendedor protegido", () => {
  it("expõe os números reais quando há proteção", () => {
    /**
     * Protegido recebe rate/value ZERADOS e os verdadeiros em `excluded`.
     * Mostrar o zero é confortável e falso: a proteção acaba numa data, e aí
     * o número real aparece de uma vez.
     */
    const m = lerMetrica({ rate: 0, value: 0, excluded: { real_rate: 0.0912, real_value: 24 } });
    expect(m.taxa).toBe(0);
    expect(m.taxaReal).toBe(0.0912);
    expect(m.casosReais).toBe(24);
    expect(m.protegida).toBe(true);
  });

  it("sem excluded, não está protegida", () => {
    expect(lerMetrica({ rate: 0.01, value: 5 }).protegida).toBe(false);
  });

  it("métrica ausente não quebra", () => {
    const m = lerMetrica(null);
    expect(m.taxa).toBeNull();
    expect(m.casos).toBeNull();
    expect(m.protegida).toBe(false);
  });
});

describe("baseDaMetrica — o denominador NÃO é o mesmo pras três", () => {
  it("a taxa revela o denominador que o ML usou", () => {
    expect(baseImplicita(2, 0.0022)).toBeCloseTo(909.09, 1);
  });

  it("reclamações: a base implícita vence a contagem do app", () => {
    // 2 casos a 0,22% implica ~909, mesmo com o app tendo contado 937.
    const b = baseDaMetrica("claims", { rate: 0.0022, value: 2 }, 937);
    expect(b).toBeCloseTo(909.09, 1);
  });

  it("reclamações sem casos caem pra sales.completed", () => {
    // Zero casos: a taxa é zero e não revela nada. A doc diz que claims
    // divide por vendas totais, então sales.completed serve.
    expect(baseDaMetrica("claims", { rate: 0, value: 0 }, 937)).toBe(937);
  });

  it("cancelamentos também dividem por vendas totais", () => {
    expect(baseDaMetrica("cancellations", { rate: 0, value: 0 }, 937)).toBe(937);
  });

  it("atraso no envio SEM base implícita não inventa denominador", () => {
    /**
     * A fórmula oficial é "vendas com envio atrasado / vendas ENVIADAS COM
     * ME2" — não o total de vendas, e esse número não vem na resposta. A tela
     * usava o total pras três métricas; pra esta, o "cabem mais X" não
     * correspondia a nada.
     */
    expect(baseDaMetrica("delayed_handling_time", { rate: 0, value: 0 }, 937)).toBeNull();
  });

  it("atraso no envio COM base implícita usa a do próprio ML", () => {
    // 2 atrasos a 0,22% implica ~909 envios ME2 — número do ML, não nosso.
    expect(baseDaMetrica("delayed_handling_time", { rate: 0.0022, value: 2 }, 937)).toBeCloseTo(909.09, 1);
  });

  it("protegida: usa os números reais pra achar a base", () => {
    const b = baseDaMetrica("claims", { rate: 0, value: 0, excluded: { real_rate: 0.0912, real_value: 24 } }, 937);
    expect(b).toBeCloseTo(263.16, 1);
  });

  it("sem vendas e sem base implícita, não há base", () => {
    expect(baseDaMetrica("claims", { rate: 0, value: 0 }, 0)).toBeNull();
    expect(baseDaMetrica("claims", null, null)).toBeNull();
  });
});

describe("periodoDaMetrica — a janela é do ML, não uma constante nossa", () => {
  it("lê o período que a resposta traz", () => {
    /**
     * No MLB o período é 60 dias pra quem teve 60+ vendas nos ultimos 60
     * dias, e 365 dias pra quem teve menos. Fixar 60 na tela mente pra uma
     * conta em recuperação — justamente a que mais precisa do número certo.
     */
    expect(periodoDaMetrica({ period: "60 days", rate: 0, value: 0 })).toBe("60 days");
    expect(periodoDaMetrica({ period: "365 days", rate: 0, value: 0 })).toBe("365 days");
  });

  it("sem período na resposta, não inventa", () => {
    expect(periodoDaMetrica({ rate: 0, value: 0 })).toBeNull();
    expect(periodoDaMetrica(null)).toBeNull();
  });
});

describe("TETOS e FAIXAS — conferidos contra a tabela oficial do MLB", () => {
  it("o teto de MercadoLíder é sempre mais apertado que o permitido", () => {
    for (const [chave, t] of Object.entries(TETOS)) {
      expect(t.mercadoLider, chave).toBeLessThan(t.permitido);
    }
  });

  it("estão em decimal, na unidade que a API devolve", () => {
    // Um teto maior que 1 seria porcento escrito no lugar errado.
    for (const [chave, t] of Object.entries(TETOS)) {
      expect(t.permitido, chave).toBeLessThan(1);
      expect(t.mercadoLider, chave).toBeGreaterThan(0);
    }
  });

  it("linha MLB: Líderes 1% / 0,5% / 6% e Green 2% / 1,5% / 10%", () => {
    expect(emPorcento(TETOS.claims.mercadoLider)).toBeCloseTo(1);
    expect(emPorcento(TETOS.claims.permitido)).toBeCloseTo(2);
    expect(emPorcento(TETOS.cancellations.mercadoLider)).toBeCloseTo(0.5);
    expect(emPorcento(TETOS.cancellations.permitido)).toBeCloseTo(1.5);
    expect(emPorcento(TETOS.delayed_handling_time.mercadoLider)).toBeCloseTo(6);
    expect(emPorcento(TETOS.delayed_handling_time.permitido)).toBeCloseTo(10);
  });

  it("as faixas de cor sobem: green < yellow < orange", () => {
    for (const [chave, f] of Object.entries(FAIXAS_MLB)) {
      expect(f.green, chave).toBeLessThan(f.yellow);
      expect(f.yellow, chave).toBeLessThan(f.orange);
    }
  });

  it("o green da faixa é o mesmo 'permitido' dos tetos", () => {
    for (const chave of Object.keys(TETOS) as (keyof typeof TETOS)[]) {
      expect(FAIXAS_MLB[chave].green, chave).toBe(TETOS[chave].permitido);
    }
  });
});
