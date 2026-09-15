import { describe, expect, it } from "vitest";
import {
  ESTADO_INICIAL,
  etapaFalhou,
  etapaOk,
  etapaParcial,
  proximoEstado,
  resumir,
  resumirErro,
} from "./sync-resultado";

const AGORA = 1_757_000_000_000;

describe("zero por falha nao pode parecer zero por vazio", () => {
  it("etapa que nao completou e distinguivel de etapa vazia", () => {
    /**
     * `syncClaimsRange` fazia `if (!res.ok) return 0;`. Falta de permissao
     * devolvia ZERO DEVOLUCOES SINCRONIZADAS — exatamente o que o app devolve
     * quando nao houve devolucao nenhuma. A rota reportava `savedClaims: 0` e
     * `ok: true`, e ninguem tinha como saber a diferenca.
     */
    const vazio = etapaOk("reclamacoes", 0);
    const falhou = etapaFalhou("reclamacoes", new Error("403 Forbidden"));

    expect(vazio.gravados).toBe(0);
    expect(falhou.gravados).toBe(0);
    // O numero e o mesmo; o que separa e o `completo`.
    expect(vazio.completo).toBe(true);
    expect(falhou.completo).toBe(false);
  });

  it("o que ja veio NAO e descartado", () => {
    /**
     * `fetchAllOrders` acumulava paginas e fazia `throw` na primeira que
     * falhasse — as paginas ja buscadas iam junto. 700 pedidos lidos com
     * sucesso viravam nada porque a pagina 15 deu erro.
     */
    const p = etapaParcial("pedidos", 700, 700, new Error("ML orders fetch failed"));
    expect(p.gravados).toBe(700);
    expect(p.completo).toBe(false);
    expect(p.cursor).toBe(700);
  });
});

describe("resumir", () => {
  it("uma etapa incompleta torna a rodada incompleta", () => {
    const r = resumir([
      etapaOk("pedidos", 120),
      etapaOk("devolucoes", 3),
      etapaFalhou("reclamacoes", "403"),
    ]);
    expect(r.completo).toBe(false);
    expect(r.incompletas).toEqual(["reclamacoes"]);
    expect(r.gravados).toBe(123);
  });

  it("tudo completo e rodada completa", () => {
    const r = resumir([etapaOk("pedidos", 10), etapaOk("devolucoes", 0)]);
    expect(r.completo).toBe(true);
    expect(r.incompletas).toEqual([]);
  });

  it("lista vazia nao conta como sucesso silencioso", () => {
    // Nenhuma etapa rodou: tecnicamente nada falhou, mas nada foi feito.
    const r = resumir([]);
    expect(r.gravados).toBe(0);
    expect(r.completo).toBe(true);
    expect(r.incompletas).toEqual([]);
  });
});

describe("resumirErro — curto e sem vazamento", () => {
  it("corta corpo longo", () => {
    const r = resumirErro(new Error("x".repeat(500)));
    expect(r.length).toBeLessThanOrEqual(200);
  });

  it("achata quebras de linha", () => {
    expect(resumirErro(new Error("linha1\n\nlinha2"))).toBe("linha1 linha2");
  });

  it("nao explode com valor estranho", () => {
    expect(resumirErro(null)).toBe("erro");
    expect(resumirErro(undefined)).toBe("erro");
    expect(resumirErro("")).toBe("erro");
    expect(resumirErro({ a: 1 })).toBeTruthy();
  });
});

describe("proximoEstado — continuar de onde parou", () => {
  it("rodada completa zera cursores e tentativas", () => {
    const anterior = { ...ESTADO_INICIAL, tentativasSeguidas: 4, cursores: { pedidos: 700 }, ultimoErro: "x" };
    const e = proximoEstado(anterior, resumir([etapaOk("pedidos", 900)]), AGORA);
    expect(e.ultimoSucesso).toBe(AGORA);
    expect(e.tentativasSeguidas).toBe(0);
    expect(e.cursores).toEqual({});
    expect(e.ultimoErro).toBeNull();
  });

  it("rodada incompleta GUARDA o cursor pra proxima continuar", () => {
    /**
     * Sem cursor, a rodada seguinte comecava do offset 0, batia na mesma
     * falha e descartava tudo de novo — o rabo do periodo nunca era
     * sincronizado, indefinidamente.
     */
    const e = proximoEstado(ESTADO_INICIAL, resumir([etapaParcial("pedidos", 700, 700, "falhou")]), AGORA);
    expect(e.cursores).toEqual({ pedidos: 700 });
    expect(e.tentativasSeguidas).toBe(1);
  });

  it("falhas seguidas acumulam — da pra saber que esta travado", () => {
    let e = proximoEstado(ESTADO_INICIAL, resumir([etapaFalhou("pedidos", "x")]), AGORA);
    e = proximoEstado(e, resumir([etapaFalhou("pedidos", "x")]), AGORA + 1000);
    e = proximoEstado(e, resumir([etapaFalhou("pedidos", "x")]), AGORA + 2000);
    expect(e.tentativasSeguidas).toBe(3);
  });

  it("falha PRESERVA o ultimo sucesso — e ele que diz quao velho o dado esta", () => {
    const completo = proximoEstado(ESTADO_INICIAL, resumir([etapaOk("pedidos", 10)]), AGORA);
    const depois = proximoEstado(completo, resumir([etapaFalhou("pedidos", "x")]), AGORA + 60_000);
    expect(depois.ultimoSucesso).toBe(AGORA);
    expect(depois.ultimaTentativa).toBe(AGORA + 60_000);
  });

  it("etapa que completou limpa o proprio cursor, mesmo com outra falhando", () => {
    const anterior = { ...ESTADO_INICIAL, cursores: { pedidos: 700, devolucoes: 20 } };
    const e = proximoEstado(
      anterior,
      resumir([etapaOk("pedidos", 900), etapaFalhou("devolucoes", "x")]),
      AGORA,
    );
    expect(e.cursores.pedidos).toBeUndefined();
    expect(e.cursores.devolucoes).toBe(0);
  });

  it("sem estado anterior nao quebra", () => {
    const e = proximoEstado(null, resumir([etapaOk("pedidos", 1)]), AGORA);
    expect(e.ultimoSucesso).toBe(AGORA);
  });
});
