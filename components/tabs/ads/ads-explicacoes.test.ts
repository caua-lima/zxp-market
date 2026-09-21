import { describe, it, expect } from "vitest";
import {
  explicacaoLucro, explicacaoRoas, explicacaoRoasObjetivo, explicacaoViaAds, explicacoesDoAnuncio,
} from "./ads-explicacoes";
import type { LinhaAds } from "./ads-types";

/** Só os campos que as explicações leem — o resto do LinhaAds não importa aqui. */
function linha(over: Record<string, unknown> = {}, i: Record<string, unknown> = {}): LinhaAds {
  return {
    i: {
      cost: 100, adSales: 471, totalSales: 800, prints: 5000, clicks: 200, roasTarget: 0,
      adUnitsAtribuidas: 6, directUnits: 4, indirectUnits: 2, ...i,
    },
    v: 471, r: 4.71, ctr: 4, cpc: 0.5, roasMlAds: 4.71,
    breakEven: 3, roasIdeal: 5, lucroAtual: 20, lucroNoIdeal: 45,
    motivoSemBreakEven: null, motivoSemIdeal: null,
    ...over,
  } as unknown as LinhaAds;
}

describe("explicações dos números de Ads (U14: o que era só tooltip agora é texto)", () => {
  it("o ROAS explica os DOIS números: o do painel do ML e o do modo escolhido", () => {
    const t = explicacaoRoas(linha({ r: 10.77, roasMlAds: 4.71 }), true);
    expect(t).toContain("Publicidade direta");
    expect(t).toMatch(/10,77x/);
    expect(t).toMatch(/painel do Mercado Ads/);
  });

  it("sem venda vinculada, o lucro '—' diz que é falta de dado e não prejuízo", () => {
    expect(explicacaoLucro(linha({ lucroAtual: null }))).toMatch(/não é prejuízo, é falta de dado/);
  });

  it("'Via Ads' sem venda não inventa dependência", () => {
    expect(explicacaoViaAds(linha({}, { totalSales: 0 }))).toMatch(/não há dependência a medir/);
  });

  it("meta de ROAS abaixo do ideal é dita como problema da meta", () => {
    const t = explicacaoRoasObjetivo(linha({ roasIdeal: 5 }, { roasTarget: 3 }));
    expect(t).toMatch(/ABAIXO do ROAS que entrega a sua margem alvo/);
  });

  it("sem meta configurada, diz isso", () => {
    expect(explicacaoRoasObjetivo(linha())).toMatch(/Nenhum ROAS Objetivo/);
  });

  it("o drawer recebe TODAS as explicações, cada uma com título e texto", () => {
    const todas = explicacoesDoAnuncio(linha(), false);
    expect(todas.map((x) => x.chave)).toEqual(["roas", "roasobj", "receita", "investido", "lucro", "viaads"]);
    for (const x of todas) {
      expect(x.titulo.length).toBeGreaterThan(0);
      expect(x.texto.length).toBeGreaterThan(10);
    }
  });
});
