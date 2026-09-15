import { describe, expect, it } from "vitest";
import { lerPeriodo, MAX_DIAS } from "./periodo";

const HOJE = "2026-09-15";

describe("recusar ANTES de consultar", () => {
  it("periodo de trinta anos e recusado", () => {
    /**
     * Nao havia teto. `?from=2000-01-01&to=2030-12-31` fazia a rota paginar
     * trinta anos de pedidos no Mercado Livre, pagina apos pagina, ate a funcao
     * morrer. Qualquer pessoa autorizada derrubava a rota digitando na URL.
     *
     * A validacao custa microssegundos e evita dezenas de chamadas pagas.
     */
    const r = lerPeriodo({ from: "2000-01-01", to: "2030-12-31" }, HOJE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("periodo_longo");
  });

  it("o teto e generoso o bastante pro uso real", () => {
    // Um ano inteiro passa: e o maior recorte com uso real.
    expect(lerPeriodo({ from: "2025-10-01", to: "2026-09-15" }, HOJE).ok).toBe(true);
  });

  it("exatamente no teto passa; um dia a mais nao", () => {
    const de = "2025-08-13";
    const noTeto = lerPeriodo({ from: de, to: HOJE }, HOJE);
    if (noTeto.ok) expect(noTeto.dias).toBeLessThanOrEqual(MAX_DIAS);
    expect(lerPeriodo({ from: "2020-01-01", to: HOJE }, HOJE).ok).toBe(false);
  });
});

describe("data que nao existe nao vira consulta", () => {
  it("texto qualquer e recusado", () => {
    /**
     * `${from}T00:00:00.000Z` com from="abc" virava "abcT00:00:00.000Z" — uma
     * data que nao existe, e a consulta saia com lixo dentro.
     */
    const r = lerPeriodo({ from: "abc", to: "2026-09-15" }, HOJE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("data_invalida");
  });

  it("31 de fevereiro nao existe", () => {
    expect(lerPeriodo({ from: "2026-02-31", to: "2026-03-01" }, HOJE).ok).toBe(false);
  });

  it("mes 13 nao existe", () => {
    expect(lerPeriodo({ from: "2026-13-01", to: "2026-13-05" }, HOJE).ok).toBe(false);
  });

  it("29 de fevereiro existe em ano bissexto", () => {
    expect(lerPeriodo({ from: "2028-02-29", to: "2028-03-01" }, "2028-03-01").ok).toBe(true);
  });

  it("29 de fevereiro NAO existe em ano comum", () => {
    expect(lerPeriodo({ from: "2026-02-29", to: "2026-03-01" }, HOJE).ok).toBe(false);
  });
});

describe("periodo invertido e erro, nao resultado vazio", () => {
  it("from depois de to e recusado", () => {
    /**
     * Invertido devolvia consulta vazia, e vazio aqui se le como "nao vendeu
     * nada" — o pior tipo de resposta errada, porque parece uma resposta.
     */
    const r = lerPeriodo({ from: "2026-09-30", to: "2026-09-01" }, HOJE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("periodo_invertido");
  });

  it("mesmo dia nos dois lados e valido — e um dia", () => {
    const r = lerPeriodo({ from: HOJE, to: HOJE }, HOJE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dias).toBe(1);
  });
});

describe("meia dupla e erro, nao adivinhacao", () => {
  it("so from e recusado", () => {
    // Adivinhar o resto produziria um periodo que ninguem pediu.
    const r = lerPeriodo({ from: "2026-09-01" }, HOJE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("periodo_incompleto");
  });

  it("so to e recusado", () => {
    expect(lerPeriodo({ to: "2026-09-30" }, HOJE).ok).toBe(false);
  });
});

describe("month", () => {
  it("mes valido vira o mes inteiro", () => {
    const r = lerPeriodo({ month: "2026-09" }, HOJE);
    expect(r).toMatchObject({ ok: true, de: "2026-09-01", ate: "2026-09-30" });
  });

  it("fevereiro bissexto tem 29", () => {
    const r = lerPeriodo({ month: "2028-02" }, "2028-03-01");
    expect(r).toMatchObject({ ok: true, ate: "2028-02-29" });
  });

  it("month invalido e recusado, nao vira NaN", () => {
    /**
     * `month.split("-").map(Number)` com "abc" dava [NaN, NaN], e dai saia
     * "NaN-NaN-01" como data.
     */
    for (const m of ["abc", "2026", "2026-13", "2026-00", "20-26"]) {
      expect(lerPeriodo({ month: m }, HOJE).ok, m).toBe(false);
    }
  });

  it("from/to tem precedencia sobre month", () => {
    const r = lerPeriodo({ from: "2026-08-01", to: "2026-08-31", month: "2026-09" }, HOJE);
    expect(r).toMatchObject({ ok: true, de: "2026-08-01", ate: "2026-08-31" });
  });
});

describe("padrao e futuro", () => {
  it("sem nada informado, o mes corrente", () => {
    expect(lerPeriodo({}, HOJE)).toMatchObject({ ok: true, de: "2026-09-01", ate: "2026-09-30" });
  });

  it("nulo e vazio contam como nao informado", () => {
    expect(lerPeriodo({ from: null, to: "", month: null }, HOJE).ok).toBe(true);
  });

  it("periodo inteiro no futuro e recusado — nao ha venda pra buscar", () => {
    const r = lerPeriodo({ from: "2027-01-01", to: "2027-01-31" }, HOJE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("periodo_futuro");
  });

  it("o mes corrente, que termina no futuro, e valido", () => {
    // Setembro inteiro pedido no dia 15 tem quinze dias a frente — e normal.
    expect(lerPeriodo({ from: "2026-09-01", to: "2026-09-30" }, HOJE).ok).toBe(true);
  });

  it("uma folga pequena pro relogio do cliente", () => {
    // Fuso e relogio do navegador derrapam; recusar "amanha" seria implicancia.
    expect(lerPeriodo({ from: "2026-09-16", to: "2026-09-16" }, HOJE).ok).toBe(true);
  });
});
