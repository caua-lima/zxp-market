import { describe, expect, it } from "vitest";
import {
  ehVendaValida, margemPonderada, naFaixaDeMargem, resumoDeMargem, temMargemConhecida,
  type PedidoParaMargem,
} from "./pedidos-margem";

const ped = (bruto: number, lucro: number, over: Partial<PedidoParaMargem> = {}): PedidoParaMargem => ({
  bruto, lucro, margem: bruto > 0 ? (lucro / bruto) * 100 : 0, vinculado: true, ...over,
});

describe("quem entra na conta", () => {
  it("cancelado e devolvido não são venda", () => {
    expect(ehVendaValida(ped(100, 10))).toBe(true);
    expect(ehVendaValida(ped(100, 10, { cancelado: true }))).toBe(false);
    expect(ehVendaValida(ped(100, 10, { devolvido: true }))).toBe(false);
  });

  it("sem cadastro tem margem desconhecida — custo zero não é custo", () => {
    expect(temMargemConhecida(ped(100, 70, { vinculado: false }))).toBe(false);
    expect(temMargemConhecida(ped(100, 10))).toBe(true);
  });
});

describe("naFaixaDeMargem", () => {
  it("acima = margem >= limiar (mesma regra de 'saudável'), abaixo = menor", () => {
    expect(naFaixaDeMargem(ped(100, 10), "acima", 10)).toBe(true); // exatamente 10% conta como acima
    expect(naFaixaDeMargem(ped(100, 9.99), "acima", 10)).toBe(false);
    expect(naFaixaDeMargem(ped(100, 9.99), "abaixo", 10)).toBe(true);
    expect(naFaixaDeMargem(ped(100, -5), "abaixo", 10)).toBe(true);
  });

  it("sem faixa, todo pedido passa", () => {
    expect(naFaixaDeMargem(ped(100, 70, { vinculado: false }), "", 10)).toBe(true);
  });

  it("pedido sem cadastro NUNCA aparece no filtro '≥ 10%' — era ele que inflava a contagem", () => {
    expect(naFaixaDeMargem(ped(100, 70, { vinculado: false }), "acima", 10)).toBe(false);
    expect(naFaixaDeMargem(ped(100, 70, { vinculado: false }), "abaixo", 10)).toBe(false);
  });

  it("cancelado não entra em faixa nenhuma", () => {
    expect(naFaixaDeMargem(ped(100, 30, { cancelado: true }), "acima", 10)).toBe(false);
  });
});

describe("margemPonderada", () => {
  it("pondera por VALOR: um pedido grande de margem baixa pesa mais que vários pequenos de margem alta", () => {
    // Nove pedidos de R$ 20 a 20% e um de R$ 500 a 5%: média simples ~18,5%,
    // ponderada ~8% — é a diferença entre "quase todos acima de 10%" e o dia.
    const pedidos = [...Array.from({ length: 9 }, () => ped(20, 4)), ped(500, 25)];
    const simples = pedidos.reduce((s, p) => s + p.margem, 0) / pedidos.length;
    const { margem } = margemPonderada(pedidos);
    expect(simples).toBeCloseTo(18.5, 1);
    expect(margem).toBeCloseTo(((9 * 4 + 25) / (9 * 20 + 500)) * 100, 6);
    expect(margem!).toBeLessThan(10);
  });

  it("deixa de fora cancelado e sem cadastro", () => {
    const r = margemPonderada([ped(100, 10), ped(100, 90, { vinculado: false }), ped(100, 50, { cancelado: true })]);
    expect(r).toEqual({ receita: 100, lucro: 10, margem: 10 });
  });

  it("sem receita, margem null — não 0", () => {
    expect(margemPonderada([]).margem).toBeNull();
    expect(margemPonderada([ped(100, 10, { cancelado: true })]).margem).toBeNull();
  });
});

describe("resumoDeMargem — a ponte até a margem do Dashboard", () => {
  it("reprodução de 23/09/2026: 9,5% antes do Ads, 3,8% depois", () => {
    // Totais medidos na produção: receita R$ 1.437,22, lucro antes do Ads
    // R$ 136,60, Ads R$ 81,81 → margem do dia R$ 54,79 / R$ 1.437,22.
    const r = resumoDeMargem([ped(1437.22, 136.60)], { limiar: 10, ads: 81.81 });
    expect(r.margemSemAds).toBeCloseTo(9.5, 1);
    expect(r.margemComAds).toBeCloseTo(3.8, 1);
    expect(r.lucroComAds).toBeCloseTo(54.79, 2);
  });

  it("conta acima/abaixo só entre vendas com custo conhecido, e separa o resto", () => {
    const r = resumoDeMargem(
      [
        ped(100, 15), ped(100, 12), ped(100, 10), // 3 acima (10% conta)
        ped(100, 5),                                // 1 abaixo
        ped(100, 80, { vinculado: false }),         // sem cadastro
        ped(100, 20, { cancelado: true }),          // não é venda
      ],
      { limiar: 10, ads: 0 },
    );
    expect(r).toMatchObject({ acima: 3, abaixo: 1, comCusto: 4, semCadastro: 1, naoVendas: 1 });
  });

  it("Ads negativo ou inválido vira zero — nunca soma lucro", () => {
    expect(resumoDeMargem([ped(100, 10)], { limiar: 10, ads: -50 }).ads).toBe(0);
    expect(resumoDeMargem([ped(100, 10)], { limiar: 10, ads: Number.NaN }).margemComAds).toBe(10);
  });

  it("sem receita, as duas margens são null", () => {
    const r = resumoDeMargem([], { limiar: 10, ads: 20 });
    expect(r.margemSemAds).toBeNull();
    expect(r.margemComAds).toBeNull();
  });
});
