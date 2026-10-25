import { describe, expect, it } from "vitest";
import { placarDe } from "./placar-ao-vivo";

const base = { dia: "2026-10-23", atualizadoEm: 1, ontemAteAgora: { vendas: 0 }, porHora: { hoje: [] as number[] }, ultimaVenda: null };

describe("placarDe — o placar do widget, da resposta da barra ao vivo", () => {
  it("leva o que o widget usa, arredondado a centavos", () => {
    const p = placarDe({
      ...base, hoje: { vendas: 10.005, pedidos: 2, unidades: 3 }, ontemAteAgora: { vendas: 7 },
      porHora: { hoje: [1.239, 2] }, ultimaVenda: { em: 5, valor: 5, titulo: "x".repeat(80) },
      metaDoDia: { alvo: 100.456, pct: 12.345, falta: 90.4, batida: false, mesBatido: false },
    });
    expect(p).toMatchObject({ vendas: 10.01, pedidos: 2, unidades: 3, ontemAteAgora: 7 });
    expect(p.porHora).toHaveLength(24);
    expect(p.porHora.slice(0, 3)).toEqual([1.24, 2, 0]);
    expect(p.ultima!.titulo).toHaveLength(60);
  });

  it("o % da meta vai sem arredondar (a barra arredonda uma vez: 89,46 é 89, não 90)", () => {
    const p = placarDe({ ...base, hoje: { vendas: 1, pedidos: 1, unidades: 1 }, metaDoDia: { alvo: 100, pct: 89.46, falta: 10, batida: false, mesBatido: false } });
    expect(p.meta!.pct).toBe(89.46);
  });

  it("sem meta, sem última venda: null", () => {
    const p = placarDe({ ...base, hoje: { vendas: 0, pedidos: 0, unidades: 0 } });
    expect(p.meta).toBeNull();
    expect(p.ultima).toBeNull();
  });

  it("nada de custo, lucro, visitas nem estoque, mesmo que a resposta tenha", () => {
    const p = placarDe({ ...base, hoje: { vendas: 1, pedidos: 1, unidades: 1 }, visitas: 9, lucro: 3, topProdutos: [{ estoque: 1 }] } as never);
    expect(JSON.stringify(p)).not.toMatch(/visitas|lucro|estoque|custo/);
  });
});
