import { describe, expect, it } from "vitest";
import {
  JANELA_MS,
  LIMIAR_AGRUPAMENTO,
  idsDoResumo,
  minutosDaJanela,
  registrarNaJanela,
  type JanelaDeVendas,
} from "./janela-de-vendas";

const T0 = 1_800_000_000_000;

/** Registra uma sequência de vendas e devolve as decisões, encadeando o estado como a transação faz. */
function rajada(vendas: { id: string; gross: number; em: number }[], inicial: JanelaDeVendas | null = null) {
  let janela = inicial;
  const decisoes = [];
  for (const v of vendas) {
    const r = registrarNaJanela(janela, { eventId: v.id, gross: v.gross }, v.em);
    janela = r.janela;
    decisoes.push(r.decisao);
  }
  return { janela: janela!, decisoes };
}

describe("registrarNaJanela — a política de rajada", () => {
  it("as três primeiras são individuais; a partir da quarta, agrupadas", () => {
    const { decisoes } = rajada(Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, gross: 100, em: T0 + i * 1000 })));
    expect(decisoes.map((d) => d.modo)).toEqual(["individual", "individual", "individual", "agrupada", "agrupada", "agrupada"]);
    expect(decisoes.map((d) => d.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("só a quarta ABRE a rajada; só a partir da quinta existe fechamento a atualizar", () => {
    const { decisoes } = rajada(Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, gross: 10, em: T0 + i * 1000 })));
    expect(decisoes.map((d) => d.abre)).toEqual([false, false, false, true, false, false]);
    expect(decisoes.map((d) => d.precisaDeFechamento)).toEqual([false, false, false, false, true, true]);
  });

  it("o total e o faturamento da janela acompanham as vendas", () => {
    const { decisoes } = rajada([
      { id: "a", gross: 100, em: T0 }, { id: "b", gross: 50.5, em: T0 + 1 }, { id: "c", gross: 25, em: T0 + 2 },
    ]);
    expect(decisoes[2]).toMatchObject({ totalNaJanela: 3, grossNaJanela: 175.5 });
  });

  it("a janela é FIXA: dura JANELA_MS desde a primeira venda, não desliza", () => {
    const { janela } = rajada([{ id: "a", gross: 1, em: T0 }, { id: "b", gross: 1, em: T0 + JANELA_MS - 1 }]);
    expect(janela.fim).toBe(T0 + JANELA_MS);
    expect(Object.keys(janela.membros)).toHaveLength(2);
  });

  it("a venda no instante do fim já abre OUTRA janela", () => {
    const { decisoes } = rajada([{ id: "a", gross: 1, em: T0 }, { id: "b", gross: 1, em: T0 + JANELA_MS }]);
    expect(decisoes[1].n).toBe(1);
    expect(decisoes[1].janelaId).not.toBe(decisoes[0].janelaId);
  });

  it("uma janela nova recomeça a contagem — a rajada anterior não contamina", () => {
    const { decisoes } = rajada([
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, gross: 1, em: T0 + i })),
      { id: "b0", gross: 1, em: T0 + 5 * JANELA_MS },
    ]);
    expect(decisoes[5]).toMatchObject({ n: 1, modo: "individual", totalNaJanela: 1 });
  });
});

describe("registrarNaJanela — IDEMPOTÊNCIA (o retry não infla a rajada)", () => {
  it("dez vendas e o RETRY das dez: continuam sendo dez", () => {
    const dez = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, gross: 10, em: T0 + i * 1000 }));
    const primeira = rajada(dez);
    const retry = rajada(dez.map((v) => ({ ...v, em: v.em + 30_000 })), primeira.janela);
    expect(retry.decisoes.map((d) => d.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(retry.janela.membros).toEqual(primeira.janela.membros);
    expect(retry.decisoes[9].totalNaJanela).toBe(10);
  });

  it("uma venda SUPRIMIDA por agrupamento, reprocessada, continua agrupada — não ressuscita como avulsa", () => {
    const { janela, decisoes } = rajada(Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, gross: 1, em: T0 + i })));
    expect(decisoes[4].modo).toBe("agrupada");
    const de_novo = registrarNaJanela(janela, { eventId: "e4", gross: 1 }, T0 + 60_000);
    expect(de_novo.decisao.modo).toBe("agrupada");
    expect(de_novo.jaEstava).toBe(true);
  });

  it("a mesma venda com faturamento diferente não muda o total (a primeira contagem vale)", () => {
    const a = registrarNaJanela(null, { eventId: "x", gross: 100 }, T0);
    const b = registrarNaJanela(a.janela, { eventId: "x", gross: 999 }, T0 + 1);
    expect(b.decisao.grossNaJanela).toBe(100);
  });

  it("faturamento inválido conta como zero, sem contaminar o total", () => {
    const r = registrarNaJanela(null, { eventId: "x", gross: Number.NaN }, T0);
    expect(r.decisao.grossNaJanela).toBe(0);
  });
});

describe("os dois resumos de uma janela", () => {
  it("ids determinísticos: publicar de novo é idempotente", () => {
    expect(idsDoResumo("123")).toEqual(idsDoResumo("123"));
    expect(idsDoResumo("123").abertura).not.toBe(idsDoResumo("123").fechamento);
  });

  it("a tag é da JANELA, não do relógio — as duas metades da rajada substituem a mesma notificação", () => {
    const { janela } = rajada([{ id: "a", gross: 1, em: T0 }, { id: "b", gross: 1, em: T0 + JANELA_MS - 1 }]);
    expect(idsDoResumo(janela.id).tag).toBe(`sales-summary-${T0}`);
  });

  it("minutos da janela: nunca menos de 1", () => {
    expect(minutosDaJanela({ inicio: 0, fim: JANELA_MS })).toBe(2);
    expect(minutosDaJanela({ inicio: 0, fim: 1000 })).toBe(1);
  });

  it("o limiar continua sendo 4", () => {
    expect(LIMIAR_AGRUPAMENTO).toBe(4);
  });
});
