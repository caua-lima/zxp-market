import { describe, expect, it } from "vitest";
import { blocoPresencial, comPresencial } from "./metricas-com-presencial";
import type { VendaPresencial } from "./venda-presencial";

const venda = (o: Partial<VendaPresencial>): VendaPresencial => ({
  id: "v", data: "2026-10-23", hora: "10:00", itens: [{ productId: "limao", nome: "Limão", quantidade: 2, precoUnit: 50, custoUnit: 20 }],
  bruto: 100, desconto: 0, total: 100, custo: 40, lucro: 60, pagamento: "pix", status: "ativa", criadoEm: 1, criadoPor: "a", ...o,
});

const ml = () => ({
  faturamentoBruto: 1100, faturamentoLiquido: 1000, totalRetorno: 1000, totalCMV: 400,
  lucroSemCustos: 200, lucroComCustos: 150, margemSemCustos: 20, margemComCustos: 15,
  faturamentoHoje: 300, pedidosHoje: 3, ordersCount: 10, custosOperacionais: 50,
  hoje: { faturamentoBruto: 300, faturamentoLiquido: 300, totalRetorno: 300, totalCMV: 120, lucroLiquido: 60, pedidos: 3, unidadesVendidas: 4, totalTaxasML: 30 },
  serieDiaria: [{ data: "2026-10-22", faturamento: 700 }, { data: "2026-10-24", faturamento: 300 }],
  conciliacao: { vendasBrutas: 1000, quantidadeVendas: 10 },
});

describe("blocoPresencial", () => {
  it("período, dia em foco e série — só ativas", () => {
    const b = blocoPresencial([
      venda({ id: "1", data: "2026-10-23" }),
      venda({ id: "2", data: "2026-10-24", total: 30, bruto: 30, custo: 10, lucro: 20, itens: [{ productId: "erva", nome: "Erva", quantidade: 1, precoUnit: 30, custoUnit: 10 }] }),
      venda({ id: "3", data: "2026-10-24", status: "cancelada" }),
    ], "2026-10-01", "2026-10-31", "2026-10-24");
    expect(b).toMatchObject({ faturamento: 130, custo: 50, lucro: 80, vendas: 2, unidades: 3 });
    expect(b.hoje).toEqual({ faturamento: 30, custo: 10, lucro: 20, vendas: 1, unidades: 1 });
    expect(b.serieDiaria).toEqual([{ data: "2026-10-23", faturamento: 100 }, { data: "2026-10-24", faturamento: 30 }]);
  });
});

describe("comPresencial — o balcão dentro dos números do negócio", () => {
  const b = blocoPresencial([venda({ id: "1", data: "2026-10-23" }), venda({ id: "2", data: "2026-10-24", total: 30, bruto: 30, custo: 10, lucro: 20 })], "2026-10-01", "2026-10-31", "2026-10-24");

  it("soma faturamento, CMV, lucro, pedidos e refaz a margem", () => {
    const r = comPresencial(ml(), b);
    expect(r).toMatchObject({
      faturamentoBruto: 1230, faturamentoLiquido: 1130, totalRetorno: 1130, totalCMV: 450,
      lucroSemCustos: 280, lucroComCustos: 230, ordersCount: 12, faturamentoHoje: 330, pedidosHoje: 4,
    });
    expect(r.margemSemCustos).toBeCloseTo((280 / 1130) * 100, 6);
    expect(r.margemComCustos).toBeCloseTo((230 / 1130) * 100, 6);
  });

  it("o dia em foco e a série diária também; conciliação com o Seller Center NÃO", () => {
    const r = comPresencial(ml(), b);
    expect(r.hoje).toMatchObject({ faturamentoLiquido: 330, totalCMV: 130, lucroLiquido: 80, pedidos: 4, unidadesVendidas: 6, totalTaxasML: 30 });
    expect(r.serieDiaria).toEqual([
      { data: "2026-10-22", faturamento: 700 }, { data: "2026-10-23", faturamento: 100 }, { data: "2026-10-24", faturamento: 330 },
    ]);
    expect(r.conciliacao).toEqual({ vendasBrutas: 1000, quantidadeVendas: 10 });
    expect(r.presencial).toBe(b);
  });

  it("sem venda presencial, nada muda (só o bloco vazio vai junto)", () => {
    const vazio = blocoPresencial([], "2026-10-01", "2026-10-31", "2026-10-24");
    const r = comPresencial(ml(), vazio);
    expect({ ...r, presencial: undefined }).toEqual({ ...ml(), presencial: undefined });
  });

  it("resposta redigida (sem lucro) não ganha campo que não tinha", () => {
    const { lucroSemCustos: _a, lucroComCustos: _b, totalCMV: _c, margemSemCustos: _d, margemComCustos: _e, ...semFinanceiro } = ml();
    const r = comPresencial(semFinanceiro, b) as Record<string, unknown>;
    expect("lucroComCustos" in r).toBe(false);
    expect("totalCMV" in r).toBe(false);
    expect(r.faturamentoLiquido).toBe(1130);
  });
});
