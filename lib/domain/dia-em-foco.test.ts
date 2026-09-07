import { describe, expect, it } from "vitest";
import { diaAnterior, diaEmFoco, rotuloDoDia } from "./dia-em-foco";

const HOJE = "2026-09-05";

describe("diaAnterior", () => {
  it("volta um dia", () => {
    expect(diaAnterior("2026-09-05")).toBe("2026-09-04");
  });

  it("vira o mês", () => {
    expect(diaAnterior("2026-09-01")).toBe("2026-08-31");
  });

  it("vira o ano", () => {
    expect(diaAnterior("2026-01-01")).toBe("2025-12-31");
  });

  it("aguenta 1º de março em ano bissexto", () => {
    expect(diaAnterior("2028-03-01")).toBe("2028-02-29");
  });

  it("texto fora do formato volta intacto — nunca vira data inventada", () => {
    expect(diaAnterior("")).toBe("");
    expect(diaAnterior("amanha")).toBe("amanha");
  });
});

describe("diaEmFoco — o filtro que motivou isto", () => {
  it('"Ontem" põe o bloco do dia em ONTEM, não em hoje', () => {
    // O bug: os cards de cima mostravam ontem e o bloco do dia mostrava hoje,
    // os dois sem etiqueta de data.
    const r = diaEmFoco("2026-09-04", "2026-09-04", HOJE);
    expect(r.dia).toBe("2026-09-04");
    expect(r.ehHoje).toBe(false);
  });

  it('"Ontem" compara com ANTEONTEM, não com ele mesmo', () => {
    // Fixar a comparação em "ontem do relógio" faria ontem × ontem = 0% em
    // todos os cards — o mesmo bug que a rota ganhou `dia=` pra corrigir.
    expect(diaEmFoco("2026-09-04", "2026-09-04", HOJE).comparacao).toBe("2026-09-03");
  });

  it('"Hoje" continua sendo hoje, comparado com ontem', () => {
    const r = diaEmFoco(HOJE, HOJE, HOJE);
    expect(r).toEqual({ dia: HOJE, comparacao: "2026-09-04", ehHoje: true });
  });
});

describe("diaEmFoco — hoje grudado dentro do período", () => {
  it("mês corrente: hoje está dentro, nada muda", () => {
    const r = diaEmFoco("2026-09-01", "2026-09-30", HOJE);
    expect(r.dia).toBe(HOJE);
    expect(r.ehHoje).toBe(true);
  });

  it("mês já fechado: mostra o ÚLTIMO dia dele", () => {
    const r = diaEmFoco("2026-08-01", "2026-08-31", HOJE);
    expect(r.dia).toBe("2026-08-31");
    expect(r.comparacao).toBe("2026-08-30");
  });

  it("período no futuro: mostra o PRIMEIRO dia dele", () => {
    expect(diaEmFoco("2026-10-01", "2026-10-31", HOJE).dia).toBe("2026-10-01");
  });

  it("últimos 7 dias: termina hoje, então o dia é hoje", () => {
    expect(diaEmFoco("2026-08-30", HOJE, HOJE).dia).toBe(HOJE);
  });
});

describe("diaEmFoco — entrada torta não vira número errado", () => {
  it("intervalo invertido é ordenado em vez de recusado", () => {
    expect(diaEmFoco("2026-08-31", "2026-08-01", HOJE).dia).toBe("2026-08-31");
  });

  it("sem datas (tela montando) cai em hoje", () => {
    expect(diaEmFoco("", "", HOJE).dia).toBe(HOJE);
    expect(diaEmFoco("2026-09-01", "", HOJE).dia).toBe(HOJE);
  });
});

describe("rotuloDoDia", () => {
  it("hoje é Hoje e ontem é Ontem — as palavras que se usa", () => {
    expect(rotuloDoDia(HOJE, HOJE)).toBe("Hoje");
    expect(rotuloDoDia("2026-09-04", HOJE)).toBe("Ontem");
  });

  it("qualquer outro dia vira a data, nunca um rótulo generico", () => {
    // Chamar de "hoje" um dia que não é hoje foi exatamente a origem do
    // problema — o rótulo precisa dizer de qual dia se trata.
    expect(rotuloDoDia("2026-08-31", HOJE)).toBe("31/08");
    expect(rotuloDoDia("2026-01-02", HOJE)).toBe("02/01");
  });
});
