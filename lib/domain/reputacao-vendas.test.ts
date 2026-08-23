import { describe, expect, it } from "vitest";
import { montarBlocoVendas, type PedidoParaReputacao } from "./reputacao-vendas";

const p = (o: Partial<PedidoParaReputacao> & { orderId: string }): PedidoParaReputacao =>
  ({ status: "paid", shippingId: null, packId: null, total: 0, ...o });

describe("montarBlocoVendas — as quatro definicoes do painel do ML", () => {
  it("Vendas conta TUDO, inclusive cancelado", () => {
    const b = montarBlocoVendas([
      p({ orderId: "a" }),
      p({ orderId: "b", status: "cancelled" }),
    ]);
    expect(b.vendas).toBe(2);
  });

  it("Concluidas exclui cancelado e invalido", () => {
    const b = montarBlocoVendas([
      p({ orderId: "a", total: 10 }),
      p({ orderId: "b", status: "cancelled", total: 99 }),
      p({ orderId: "c", status: "invalid", total: 99 }),
    ]);
    expect(b.concluidas).toBe(1);
    expect(b.faturado).toBe(10);
  });

  it("COM ENVIOS conta ENVIOS distintos, nao pedidos", () => {
    // O numero que revelou a regra: 762 pedidos com envio contra 696 no
    // painel. Um pacote tem varios pedidos e UM envio so.
    const b = montarBlocoVendas([
      p({ orderId: "a", shippingId: "S1" }),
      p({ orderId: "b", shippingId: "S1" }),
      p({ orderId: "c", shippingId: "S1" }),
      p({ orderId: "d", shippingId: "S2" }),
    ]);
    expect(b.vendas).toBe(4);
    expect(b.comEnvios).toBe(2);
  });

  it("pedido SEM envio nao entra na contagem de envios", () => {
    const b = montarBlocoVendas([p({ orderId: "a" }), p({ orderId: "b", shippingId: "S1" })]);
    expect(b.comEnvios).toBe(1);
  });

  it("cancelado ainda conta como envio se teve envio", () => {
    // O painel separa as duas coisas: "Com Envios" e sobre logistica,
    // "Concluidas" e sobre a venda.
    const b = montarBlocoVendas([p({ orderId: "a", status: "cancelled", shippingId: "S1" })]);
    expect(b.comEnvios).toBe(1);
    expect(b.concluidas).toBe(0);
  });

  it("cai no packId quando o envio nao veio", () => {
    const b = montarBlocoVendas([
      p({ orderId: "a", shippingId: "S1", packId: "P1" }),
      p({ orderId: "b", shippingId: "S1", packId: "P1" }),
    ]);
    expect(b.comEnvios).toBe(1);
  });

  it("faturamento negativo e tratado como zero", () => {
    expect(montarBlocoVendas([p({ orderId: "a", total: -50 })]).faturado).toBe(0);
  });

  it("lista vazia zera tudo sem quebrar", () => {
    expect(montarBlocoVendas([])).toEqual({ vendas: 0, comEnvios: 0, concluidas: 0, faturado: 0 });
  });

  it("reproduz a ordem de grandeza medida na conta", () => {
    // 4 pedidos num pacote + 1 avulso = 5 vendas, 2 envios, R$ 50.
    const pacote = ["a", "b", "c", "d"].map((id) => p({ orderId: id, shippingId: "S1", total: 10 }));
    const b = montarBlocoVendas([...pacote, p({ orderId: "e", shippingId: "S2", total: 10 })]);
    expect(b).toEqual({ vendas: 5, comEnvios: 2, concluidas: 5, faturado: 50 });
  });
});
