import { describe, expect, it } from "vitest";
import { aoVivoComPresencial } from "./ao-vivo-presencial";
import { metaDoDia } from "./ao-vivo";
import type { VendaPresencial } from "./venda-presencial";

// 24/10/2026 15:00 em Brasília
const AGORA = Date.parse("2026-10-24T15:00:00.000-03:00");

const venda = (o: Partial<VendaPresencial>): VendaPresencial => ({
  id: "v", data: "2026-10-24", hora: "10:30", itens: [{ productId: "limao", nome: "Limão", quantidade: 2, precoUnit: 50, custoUnit: 20 }],
  bruto: 100, desconto: 0, total: 100, custo: 40, lucro: 60, pagamento: "pix", status: "ativa", criadoEm: 1, criadoPor: "a", ...o,
});

const base = () => ({
  dia: "2026-10-24",
  hoje: { vendas: 1000, pedidos: 5, unidades: 8, canceladoValor: 0, canceladoPedidos: 0 },
  ontemAteAgora: { vendas: 900, pedidos: 4, unidades: 6 },
  ontemInteiro: { vendas: 1500, pedidos: 7, unidades: 10 },
  porHora: { hoje: Array(24).fill(0), ontem: Array(24).fill(0) },
  ultimaVenda: { em: Date.parse("2026-10-24T09:00:00.000-03:00"), valor: 80, titulo: "Erva" },
  metaDoDia: null,
  visitas: 40,
});
const ctx = { ateOntemML: 20000, metas: { meta1: 60000 }, diaAtual: 24, diasNoMes: 31 };

describe("aoVivoComPresencial — o balcão na barra ao vivo", () => {
  it("soma no dia, na hora, na última venda e diz quanto foi do balcão", () => {
    const r = aoVivoComPresencial(base(), [venda({ id: "1", hora: "10:30" }), venda({ id: "2", hora: "14:10", total: 30, itens: [{ productId: "erva", nome: "Erva", quantidade: 1, precoUnit: 30, custoUnit: 10 }] })], AGORA, ctx);
    expect(r.hoje).toMatchObject({ vendas: 1130, pedidos: 7, unidades: 11, canceladoValor: 0 });
    expect(r.porHora.hoje[10]).toBe(100);
    expect(r.porHora.hoje[14]).toBe(30);
    expect(r.ultimaVenda).toEqual({ em: Date.parse("2026-10-24T14:10:00.000-03:00"), valor: 30, titulo: "Presencial · Erva" });
    expect(r.presencial).toEqual({ faturamento: 130, vendas: 2 });
    expect(r.visitas).toBe(40);
  });

  it("ontem até o mesmo relógio (ritmo) e ontem inteiro", () => {
    const r = aoVivoComPresencial(base(), [venda({ id: "1", data: "2026-10-23", hora: "11:00" }), venda({ id: "2", data: "2026-10-23", hora: "18:00", total: 50 })], AGORA, ctx);
    expect(r.ontemAteAgora).toEqual({ vendas: 1000, pedidos: 5, unidades: 8 });
    expect(r.ontemInteiro).toEqual({ vendas: 1650, pedidos: 9, unidades: 14 });
    expect(r.porHora.ontem[18]).toBe(50);
    expect(r.presencial).toBeNull();
  });

  it("a meta de hoje conta o balcão no mês até ontem e no dia — igual ao Dashboard", () => {
    const vendas = [venda({ id: "1", data: "2026-10-10", total: 500 }), venda({ id: "2", data: "2026-10-24", total: 200 }), venda({ id: "3", data: "2026-09-30", total: 999 })];
    const r = aoVivoComPresencial(base(), vendas, AGORA, ctx);
    expect(r.metaDoDia).toEqual(metaDoDia({ metas: ctx.metas, vendasAteOntem: 20500, vendasHoje: 1200, diaAtual: 24, diasNoMes: 31 }));
  });

  it("cancelada não entra; sem contexto da meta, a meta fica a que veio", () => {
    const r = aoVivoComPresencial(base(), [venda({ status: "cancelada" })], AGORA, null);
    expect(r.hoje.vendas).toBe(1000);
    expect(r.metaDoDia).toBeNull();
  });
});
