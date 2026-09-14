import { describe, expect, it } from "vitest";
import { montarBlocoVendas, type PedidoParaReputacao , serieDiariaDeVendas } from "./reputacao-vendas";

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

describe("serieDiariaDeVendas — o que cada dia produziu", () => {
  /**
   * A serie existe pra a projecao da medalha poder simular a JANELA MOVEL:
   * quando o mes vira, o mes mais antigo sai dela inteiro. Com so o total nao
   * da pra saber quanto vai sair.
   */
  const pedidos = [
    { orderId: "1", status: "paid", total: 100, dia: "2026-09-01" },
    { orderId: "2", status: "paid", total: 50, dia: "2026-09-01" },
    { orderId: "3", status: "paid", total: 200, dia: "2026-09-03" },
    { orderId: "4", status: "cancelled", total: 999, dia: "2026-09-03" },
  ];

  it("agrupa por dia e soma", () => {
    const s = serieDiariaDeVendas(pedidos);
    expect(s).toEqual([
      { dia: "2026-09-01", concluidas: 2, faturado: 150 },
      { dia: "2026-09-03", concluidas: 1, faturado: 200 },
    ]);
  });

  it("cancelado nao entra — igual ao bloco agregado", () => {
    const s = serieDiariaDeVendas(pedidos);
    const dia3 = s.find((d) => d.dia === "2026-09-03")!;
    expect(dia3.concluidas).toBe(1);
    expect(dia3.faturado).toBe(200);
  });

  it("dia sem venda simplesmente nao aparece", () => {
    // Quem simula trata ausente como zero; inventar linha vazia so incha.
    expect(serieDiariaDeVendas(pedidos).map((d) => d.dia)).not.toContain("2026-09-02");
  });

  it("sai ordenado por dia, mesmo com entrada baguncada", () => {
    const s = serieDiariaDeVendas([
      { orderId: "a", status: "paid", total: 10, dia: "2026-09-10" },
      { orderId: "b", status: "paid", total: 10, dia: "2026-08-01" },
      { orderId: "c", status: "paid", total: 10, dia: "2026-09-02" },
    ]);
    expect(s.map((d) => d.dia)).toEqual(["2026-08-01", "2026-09-02", "2026-09-10"]);
  });

  it("pedido sem dia legivel e ignorado, nao vira um dia invalido", () => {
    const s = serieDiariaDeVendas([
      { orderId: "a", status: "paid", total: 10, dia: "" },
      { orderId: "b", status: "paid", total: 10, dia: null },
      { orderId: "c", status: "paid", total: 10, dia: "ontem" },
      { orderId: "d", status: "paid", total: 10, dia: "2026-09-01" },
    ]);
    expect(s).toEqual([{ dia: "2026-09-01", concluidas: 1, faturado: 10 }]);
  });

  it("total negativo nao subtrai do faturamento do dia", () => {
    const s = serieDiariaDeVendas([
      { orderId: "a", status: "paid", total: -50, dia: "2026-09-01" },
    ]);
    expect(s[0].faturado).toBe(0);
  });

  it("a soma da serie bate com o bloco agregado", () => {
    // As duas contas saem dos mesmos pedidos; divergir seria o bug classico
    // desta base — duas definicoes da mesma coisa.
    const bloco = montarBlocoVendas(pedidos);
    const s = serieDiariaDeVendas(pedidos);
    expect(s.reduce((t, d) => t + d.concluidas, 0)).toBe(bloco.concluidas);
    expect(s.reduce((t, d) => t + d.faturado, 0)).toBe(bloco.faturado);
  });

  it("lista vazia devolve serie vazia", () => {
    expect(serieDiariaDeVendas([])).toEqual([]);
  });
});
