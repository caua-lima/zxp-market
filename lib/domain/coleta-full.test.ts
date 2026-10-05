import { describe, expect, it } from "vitest";
import { descreverColeta, montarColetaFull, remessasParaDatar, type EntradaDaColeta } from "./coleta-full";

const SET = { from: "2026-09-01", to: "2026-09-30" };
const base = (p: Partial<EntradaDaColeta> = {}): EntradaDaColeta => ({
  periodo: SET, api: [], guardados: [], baixas: [], ...p,
});

describe("coleta pro Full — o que a DRE soma", () => {
  it("o caso de sempre: remessa do ML dentro do período, com o custo digitado por cima", () => {
    const r = montarColetaFull(base({
      api: [{ remessa: "100", data: "2026-09-10", recebido: 50, custo: null }],
      guardados: [{ remessa: "100", custoManual: 97.38, data: "2026-09-10" }],
    }));
    expect(r.todas).toEqual([{ remessa: "100", data: "2026-09-10", recebido: 50, custo: 97.38, custoEstimado: true }]);
    expect(r).toMatchObject({ total: 97.38, parcial: false, pendentes: 0, remessas: 1 });
  });

  it("período ANTIGO (o ML não é consultado): o custo salvo e a baixa continuam entrando", () => {
    const r = montarColetaFull(base({
      periodo: { from: "2026-08-01", to: "2026-08-31" },
      api: null, motivoSemApi: "fora_da_janela",
      guardados: [{ remessa: "73306199", custoManual: 97.38, data: "2026-08-06", recebido: 120 }],
      baixas: [{ remessa: "74000000", data: "2026-08-20", unidades: 80 }],
    }));
    expect(r.foraDaJanela).toBe(true);
    expect(r.mlFalhou).toBe(false);
    expect(r.total).toBe(97.38);
    // A remessa com baixa e sem custo aparece como pendência, não some.
    expect(r.todas.map((x) => [x.remessa, x.custo])).toEqual([["74000000", null], ["73306199", 97.38]]);
    expect(r).toMatchObject({ remessas: 2, pendentes: 1, parcial: true });
  });

  it("ML fora do ar: a DRE mostra o que está salvo em vez de perder a linha", () => {
    const r = montarColetaFull(base({
      api: null, motivoSemApi: "falhou",
      guardados: [{ remessa: "100", custoManual: 40, data: "2026-09-05" }],
    }));
    expect(r.mlFalhou).toBe(true);
    expect(r.foraDaJanela).toBe(false);
    expect(r.total).toBe(40);
  });

  it("custo digitado ANTES de a data ser gravada ganha data pela baixa de estoque", () => {
    const r = montarColetaFull(base({
      periodo: { from: "2026-08-01", to: "2026-08-31" },
      api: null, motivoSemApi: "fora_da_janela",
      guardados: [{ remessa: "73306199", custoManual: 97.38 }], // sem data (legado)
      baixas: [
        { remessa: "73306199", data: "2026-08-06", unidades: 60 },
        { remessa: "73306199", data: "2026-08-07", unidades: 60 }, // outro produto, outro dia de lançamento
      ],
    }));
    expect(r.todas).toEqual([{ remessa: "73306199", data: "2026-08-06", recebido: 120, custo: 97.38, custoEstimado: true }]);
    expect(r.semData).toEqual([]);
  });

  it("custo sem NENHUMA data conhecida não cai em período nenhum — e é denunciado, não escondido", () => {
    const r = montarColetaFull(base({
      api: null, motivoSemApi: "fora_da_janela",
      guardados: [{ remessa: "999", custoManual: 55 }],
    }));
    expect(r.todas).toEqual([]);
    expect(r.semData).toEqual([{ remessa: "999", custo: 55 }]);
    expect(r.total).toBe(0);
  });

  it("a data do ML manda sobre a guardada e a da baixa", () => {
    const r = montarColetaFull(base({
      api: [{ remessa: "1", data: "2026-09-12", recebido: 10, custo: 20 }],
      guardados: [{ remessa: "1", custoManual: 5, data: "2026-08-01" }],
      baixas: [{ remessa: "1", data: "2026-08-02", unidades: 99 }],
    }));
    expect(r.todas).toEqual([{ remessa: "1", data: "2026-09-12", recebido: 10, custo: 20, custoEstimado: false }]);
  });

  it("transferência entre centros do ML não é coleta sua, mesmo com custo salvo por engano", () => {
    const r = montarColetaFull(base({
      api: [{ remessa: "7", data: "2026-09-02", recebido: 5, ehTransferencia: true }],
      guardados: [{ remessa: "7", custoManual: 30, data: "2026-09-02" }],
    }));
    expect(r.todas).toEqual([]);
    expect(r.semData).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("zero é coleta grátis (conta como informado); null é pendência — nunca confundir", () => {
    const r = montarColetaFull(base({
      api: [
        { remessa: "1", data: "2026-09-01", recebido: 1, custo: null },
        { remessa: "2", data: "2026-09-02", recebido: 1, custo: null },
      ],
      guardados: [{ remessa: "1", custoManual: 0, data: "2026-09-01" }],
    }));
    expect(r.todas.find((x) => x.remessa === "1")?.custo).toBe(0);
    expect(r.todas.find((x) => x.remessa === "2")?.custo).toBeNull();
    expect(r).toMatchObject({ pendentes: 1, parcial: true, total: 0 });
  });

  it("limpar o custo (null) devolve a remessa pra pendente; custo negativo ou texto é ignorado", () => {
    const r = montarColetaFull(base({
      api: [{ remessa: "1", data: "2026-09-01", recebido: 1, custo: null }],
      guardados: [{ remessa: "1", custoManual: -5, data: "2026-09-01" }],
    }));
    expect(r.todas[0].custo).toBeNull();
  });

  it("limites do período: os dois extremos entram, o dia de fora não", () => {
    const r = montarColetaFull(base({
      api: [
        { remessa: "a", data: "2026-08-31", recebido: 1, custo: 1 },
        { remessa: "b", data: "2026-09-01", recebido: 1, custo: 2 },
        { remessa: "c", data: "2026-09-30", recebido: 1, custo: 4 },
        { remessa: "d", data: "2026-10-01", recebido: 1, custo: 8 },
      ],
    }));
    expect(r.todas.map((x) => x.remessa)).toEqual(["c", "b"]);
    expect(r.total).toBe(6);
  });

  it("documento só com 'ignorada' (sem custo, sem baixa, sem ML) não é coleta", () => {
    const r = montarColetaFull(base({ guardados: [{ remessa: "5", custoManual: null, data: "2026-09-03" }] }));
    expect(r.todas).toEqual([]);
    expect(r.semData).toEqual([]);
  });

  it("período sem nada, com o ML respondendo vazio: zero remessas, sem pendência", () => {
    expect(montarColetaFull(base())).toMatchObject({ remessas: 0, total: 0, parcial: false, foraDaJanela: false, mlFalhou: false });
  });

  it("data em formato estranho não é aceita como data (cai pra próxima fonte)", () => {
    const r = montarColetaFull(base({
      api: [{ remessa: "1", data: "10/09/2026", recebido: 1, custo: 3 }],
      baixas: [{ remessa: "1", data: "2026-09-10", unidades: 4 }],
    }));
    expect(r.todas[0]).toMatchObject({ data: "2026-09-10", recebido: 1, custo: 3 });
  });
});


describe("o que a linha da DRE diz", () => {
  const vazia = { total: 0, parcial: false, foraDaJanela: false, mlFalhou: false, remessas: 0, todas: [], pendentes: 0, semData: [] };

  it("sem remessa nenhuma: diz isso, em valor 0 (não é indisponível)", () => {
    expect(descreverColeta(vazia, 55)).toEqual({ nota: "nenhuma remessa pro Full neste período", indisponivel: false });
  });

  it("período antigo SEM base nenhuma: indisponível, com o motivo", () => {
    const d = descreverColeta({ ...vazia, foraDaJanela: true }, 55);
    expect(d.indisponivel).toBe(true);
    expect(d.nota).toContain("55 dias");
  });

  it("período antigo COM remessas salvas: mostra o valor e diz de onde veio — não vira '—'", () => {
    const d = descreverColeta({ ...vazia, foraDaJanela: true, total: 97.38, remessas: 1, todas: [{ remessa: "1", data: "2026-08-06", recebido: 1, custo: 97.38, custoEstimado: true }] }, 55);
    expect(d.indisponivel).toBe(false);
    expect(d.nota).toContain("1 remessa(s) enviada(s)");
    expect(d.nota).toContain("do que está salvo");
  });

  it("remessas todas sem custo: '—' em vez de R$ 0,00", () => {
    const d = descreverColeta({ ...vazia, remessas: 2, pendentes: 2, parcial: true }, 55);
    expect(d.indisponivel).toBe(true);
    expect(d.nota).toContain("2 remessa(s) sem custo informado");
  });

  it("parcial: o valor é o mínimo; ML falhou: avisa", () => {
    const d = descreverColeta({ ...vazia, remessas: 3, pendentes: 1, parcial: true, total: 50, mlFalhou: true }, 55);
    expect(d.indisponivel).toBe(false);
    expect(d.nota).toContain("é o mínimo");
    expect(d.nota).toContain("o ML não respondeu agora");
  });
});

describe("custos antigos que ganham a data enquanto o ML ainda devolve a remessa", () => {
  const sem = new Set(["1", "2", "3", "4"]);

  it("só os digitados sem data, que o ML devolve com um dia válido", () => {
    const r = remessasParaDatar(
      [
        { remessa: "1", data: "2026-09-10", recebido: 50 },
        { remessa: "9", data: "2026-09-11", recebido: 5 },            // já tem data gravada (fora do conjunto)
        { remessa: "2", data: "2026-09-12", ehTransferencia: true },  // não é coleta sua
        { remessa: "3", data: "10/09/2026" },                         // dia inválido
        { remessa: "4", data: "2026-09-13", recebido: "abc" },        // unidades ilegíveis → 0
      ],
      sem,
    );
    expect(r).toEqual([
      { remessa: "1", data: "2026-09-10", recebido: 50 },
      { remessa: "4", data: "2026-09-13", recebido: 0 },
    ]);
  });

  it("nada a datar: lista vazia", () => {
    expect(remessasParaDatar([], sem)).toEqual([]);
    expect(remessasParaDatar([{ remessa: "1", data: "2026-09-10" }], new Set())).toEqual([]);
  });
});
