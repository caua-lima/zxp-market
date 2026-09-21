import { describe, expect, it } from "vitest";
import { calcularConcentracaoVendas, topCelulas } from "./sales-heatmap";

describe("calcularConcentracaoVendas", () => {
  it("sem pedidos, tudo zerado e sem dia/hora mais forte", () => {
    const r = calcularConcentracaoVendas([]);
    expect(r.totalVendas).toBe(0);
    expect(r.diaMaisForte).toBeNull();
    expect(r.horaMaisForte).toBeNull();
    expect(r.grid.flat().every((n) => n === 0)).toBe(true);
  });

  it("agrupa por dia da semana e hora corretamente", () => {
    // 2026-08-11 é uma terça-feira
    const r = calcularConcentracaoVendas([
      { date_created: "2026-08-11T14:32:10.000-03:00" },
      { date_created: "2026-08-11T14:05:00.000-03:00" },
      { date_created: "2026-08-11T09:00:00.000-03:00" },
    ]);
    const terca = new Date(2026, 7, 11).getDay();
    expect(r.totalVendas).toBe(3);
    expect(r.grid[terca][14]).toBe(2);
    expect(r.grid[terca][9]).toBe(1);
    expect(r.diaMaisForte).toBe(terca);
    expect(r.horaMaisForte).toBe(14);
  });

  it("ignora entradas sem date_created ou malformadas", () => {
    const r = calcularConcentracaoVendas([{ date_created: "" }, { date_created: undefined }, { date_created: "abc" }]);
    expect(r.totalVendas).toBe(0);
  });

  it("timestamp em UTC (sufixo Z) e convertido pro horario de Brasilia", () => {
    // 17:32 UTC = 14:32 em Brasilia (-03:00) — nao pode cair na hora 17.
    const r = calcularConcentracaoVendas([{ date_created: "2026-08-11T17:32:10.000Z" }]);
    expect(r.horaMaisForte).toBe(14);
    expect(r.grid[new Date(2026, 7, 11).getDay()][14]).toBe(1);
  });

  it("UTC de madrugada volta pro DIA anterior em Brasilia", () => {
    // 01:30 UTC de 12/ago = 22:30 de 11/ago em Brasilia (terca, nao quarta).
    const r = calcularConcentracaoVendas([{ date_created: "2026-08-12T01:30:00.000Z" }]);
    const terca = new Date(2026, 7, 11).getDay();
    expect(r.diaMaisForte).toBe(terca);
    expect(r.horaMaisForte).toBe(22);
  });

  it("offset -03:00 (ja Brasilia) permanece igual apos a conversao", () => {
    const r = calcularConcentracaoVendas([{ date_created: "2026-08-11T14:32:10.000-03:00" }]);
    expect(r.horaMaisForte).toBe(14);
  });

  it("offset -04:00 do ML cai na faixa certa (era o bug de 1 hora atras)", () => {
    // 12:01 em -04:00 e 13:01 em Brasilia: tem que cair na faixa das 13h.
    const r = calcularConcentracaoVendas([{ date_created: "2026-08-11T12:01:00.000-04:00" }]);
    expect(r.horaMaisForte).toBe(13);
  });
});

describe("topCelulas — o ranking que o mapa de bolinhas não dá a quem não vê cor", () => {
  const vazio = () => Array.from({ length: 7 }, () => Array(24).fill(0));

  it("ordena da maior pra menor e limita a N", () => {
    const g = vazio();
    g[5][15] = 12; g[1][9] = 7; g[0][20] = 7; g[3][3] = 1;
    const r = topCelulas(g, 3);
    expect(r).toEqual([
      { diaDaSemana: 5, hora: 15, vendas: 12 },
      { diaDaSemana: 0, hora: 20, vendas: 7 },   // empate: menor dia da semana primeiro
      { diaDaSemana: 1, hora: 9, vendas: 7 },
    ]);
  });

  it("célula com zero venda nunca entra, mesmo se sobrar espaço", () => {
    const g = vazio(); g[2][10] = 4;
    expect(topCelulas(g, 5)).toEqual([{ diaDaSemana: 2, hora: 10, vendas: 4 }]);
  });

  it("grade vazia devolve lista vazia", () => {
    expect(topCelulas(vazio())).toEqual([]);
  });
});
