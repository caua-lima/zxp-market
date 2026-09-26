import { describe, expect, it } from "vitest";
import {
  CacheDeFonte,
  PERIODO_PADRAO_DIAS,
  estadoDaFonte,
  lerJanelasNomeadas,
  periodoOficialDaReputacao,
} from "./fonte-desempenho";

describe("periodoOficialDaReputacao (S10)", () => {
  it("usa o período que o ML informa — 365 dias pra quem vendeu pouco, não os 60 fixos", () => {
    expect(periodoOficialDaReputacao({ sales: { period: "365 days" } })).toEqual({ dias: 365, oficial: true, texto: "365 days" });
    expect(periodoOficialDaReputacao({ sales: { period: "60 days" } }).dias).toBe(60);
  });

  it("sales primeiro (é o período do denominador); na falta, qualquer outra métrica", () => {
    expect(periodoOficialDaReputacao({ sales: { period: "60 days" }, claims: { period: "365 days" } }).dias).toBe(60);
    expect(periodoOficialDaReputacao({ claims: { period: "365 days" } }).dias).toBe(365);
  });

  it("sem período legível, cai no padrão MARCADO como não oficial — não adivinha formato", () => {
    for (const m of [null, undefined, {}, { sales: { period: "2 months" } }, { sales: { period: "0 days" } }, { sales: { period: "999 days" } }]) {
      expect(periodoOficialDaReputacao(m)).toEqual({ dias: PERIODO_PADRAO_DIAS, oficial: false, texto: null });
    }
  });
});

describe("lerJanelasNomeadas — as duas contagens numa busca", () => {
  const cobertura = { de: "2026-06-01", ate: "2026-09-26" };

  it("lê várias janelas nomeadas dentro do período buscado", () => {
    expect(lerJanelasNomeadas(["medalha:2026-06-01:2026-09-26", "reputacao:2026-07-29:2026-09-26"], cobertura)).toEqual({
      ok: true,
      janelas: [
        { nome: "medalha", de: "2026-06-01", ate: "2026-09-26" },
        { nome: "reputacao", de: "2026-07-29", ate: "2026-09-26" },
      ],
    });
  });

  it("janela fora do buscado é recusada — a contagem sairia menor sem aviso", () => {
    expect(lerJanelasNomeadas(["reputacao:2025-09-27:2026-09-26"], cobertura).ok).toBe(false);
  });

  it("recusa formato torto, invertida, repetida e excesso", () => {
    expect(lerJanelasNomeadas(["Medalha:2026-06-01:2026-09-26"], cobertura).ok).toBe(false);
    expect(lerJanelasNomeadas(["m:2026-06-01"], cobertura).ok).toBe(false);
    expect(lerJanelasNomeadas(["m:2026-09-26:2026-06-01"], cobertura).ok).toBe(false);
    expect(lerJanelasNomeadas(["m:2026-06-01:2026-09-26", "m:2026-07-01:2026-09-26"], cobertura).ok).toBe(false);
    expect(lerJanelasNomeadas(Array.from({ length: 5 }, (_, i) => `j${"abcde"[i]}:2026-07-01:2026-09-26`), cobertura).ok).toBe(false);
  });
});

describe("CacheDeFonte — sabe de qual conta é", () => {
  it("reconectar outra conta (geração nova) não acha o que era da anterior", () => {
    const c = new CacheDeFonte<string>(8, 60_000);
    c.gravar(CacheDeFonte.chave(1, "60"), "conta A", 0);
    expect(c.ler(CacheDeFonte.chave(1, "60"), 10)?.valor).toBe("conta A");
    expect(c.ler(CacheDeFonte.chave(2, "60"), 10)).toBeNull();
  });

  it("várias janelas convivem — duas chaves não se expulsam (era o cache de uma entrada só)", () => {
    const c = new CacheDeFonte<string>(8, 60_000);
    c.gravar("a", "1", 0);
    c.gravar("b", "2", 0);
    expect(c.ler("a", 1)?.valor).toBe("1");
    expect(c.ler("b", 1)?.valor).toBe("2");
  });

  it("vence pela validade", () => {
    const c = new CacheDeFonte<string>(8, 1000);
    c.gravar("a", "1", 0);
    expect(c.ler("a", 999)).not.toBeNull();
    expect(c.ler("a", 1000)).toBeNull();
    expect(c.tamanho).toBe(0);
  });

  it("tem teto: o mais antigo sai primeiro", () => {
    const c = new CacheDeFonte<number>(2, 60_000);
    c.gravar("a", 1, 0);
    c.gravar("b", 2, 0);
    c.gravar("c", 3, 0);
    expect(c.ler("a", 1)).toBeNull();
    expect(c.tamanho).toBe(2);
  });
});

describe("estadoDaFonte — erro nunca é zero", () => {
  it("falha é 'unavailable' com o código, sem último sucesso inventado", () => {
    expect(estadoDaFonte({ ok: false, buscadoEm: 0, geracao: 3, erro: "pedidos_indisponiveis" })).toMatchObject({
      status: "unavailable", errorCode: "pedidos_indisponiveis", lastSuccessAt: null, connectionGeneration: 3,
    });
  });

  it("veio vazio é 'empty' — diferente de indisponível", () => {
    expect(estadoDaFonte({ ok: true, vazio: true, buscadoEm: 0, geracao: 1 }).status).toBe("empty");
  });

  it("cobertura incompleta é 'partial'; completa e com dado, 'fresh' com o instante da busca", () => {
    expect(estadoDaFonte({ ok: true, buscadoEm: 0, geracao: 1, cobertura: { de: "a", ate: "b", completa: false } }).status).toBe("partial");
    const f = estadoDaFonte({ ok: true, buscadoEm: Date.UTC(2026, 8, 26), geracao: 1, cobertura: { de: "2026-07-29", ate: "2026-09-26", completa: true } });
    expect(f).toMatchObject({ status: "fresh", fetchedAt: "2026-09-26T00:00:00.000Z", coverage: { from: "2026-07-29", to: "2026-09-26", complete: true } });
  });
});
