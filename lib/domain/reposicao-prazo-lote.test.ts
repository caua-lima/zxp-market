import { describe, expect, it } from "vitest";
import { montarPlanoReposicao, type ProdutoReposicao } from "./reposicao";

const p = (x: Partial<ProdutoReposicao>): ProdutoReposicao => ({ id: "a", nome: "A", estoqueTotal: 20, emCasa: 0, mediaDiaria: 2, custoUnitario: 10, ativo: true, ...x });

describe("Etapa 6 — prazo do fornecedor e lote mínimo", () => {
  it("sem as opções, o plano é o de sempre (compatível)", () => {
    const antes = montarPlanoReposicao([p({})], 30, 7);
    expect(antes.diasACobrir).toBe(37);
    expect(antes.itens[0].comprar).toBe(2 * 37 - 20);
    expect(antes).toMatchObject({ prazoFornecedorDias: 0, loteMinimo: 1, zeramAntesDeChegar: [] });
  });

  it("o prazo entra na janela: o estoque de hoje vende até a compra chegar", () => {
    const plano = montarPlanoReposicao([p({})], 30, 7, { prazoFornecedorDias: 15 });
    expect(plano.diasACobrir).toBe(52);
    expect(plano.itens[0].comprar).toBe(2 * 52 - 20);
  });

  it("dura menos que o prazo: acaba antes de chegar — sinalizado à parte", () => {
    const plano = montarPlanoReposicao([p({ estoqueTotal: 10 })], 30, 7, { prazoFornecedorDias: 15 });
    expect(plano.itens[0]).toMatchObject({ duraDias: 5, zeraAntesDeChegar: true });
    expect(plano.zeramAntesDeChegar).toHaveLength(1);
  });

  it("lote: arredonda a compra PRA CIMA pro múltiplo; nada a comprar continua zero", () => {
    const plano = montarPlanoReposicao([p({})], 30, 7, { loteMinimo: 12 });
    expect(plano.itens[0].comprar).toBe(60); // precisaria 54 → 5 lotes de 12
    expect(plano.totalInvestimento).toBe(600);
    expect(montarPlanoReposicao([p({ estoqueTotal: 500 })], 30, 7, { loteMinimo: 12 }).itens).toEqual([]);
  });

  it("valores inválidos caem no padrão seguro", () => {
    expect(montarPlanoReposicao([p({})], 30, 7, { prazoFornecedorDias: -3, loteMinimo: 0 })).toMatchObject({ prazoFornecedorDias: 0, loteMinimo: 1 });
  });
});
