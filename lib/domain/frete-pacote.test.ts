import { describe, expect, it } from "vitest";
import { chaveDoEnvio, ratearFretePorPedido, type PedidoComFrete } from "./frete-pacote";

const p = (o: Partial<PedidoComFrete> & { orderId: string }): PedidoComFrete => ({
  packId: null, shippingId: null, shippingCost: 0, unidades: 1, ...o,
});

describe("chaveDoEnvio — o que agrupa pedidos do mesmo envio", () => {
  it("shippingId manda quando existe — é literalmente o envio", () => {
    expect(chaveDoEnvio(p({ orderId: "1", shippingId: "S9", packId: "P1" }))).toBe("s:S9");
  });

  it("cai no packId quando o envio não foi persistido", () => {
    // O sync grava pack_id mas NÃO grava shipping_id — esse é o caso real.
    expect(chaveDoEnvio(p({ orderId: "1", packId: "P1" }))).toBe("p:P1");
  });

  it("sem os dois, o pedido é o próprio grupo", () => {
    expect(chaveDoEnvio(p({ orderId: "1" }))).toBe("o:1");
  });
});

describe("ratearFretePorPedido — o caso medido na conta", () => {
  /**
   * Pacote real de 22/08/2026: 5 pedidos, envio de R$ 7,75. O app somava
   * R$ 38,75 — cinco vezes o frete que existiu uma vez só.
   */
  const pacoteDe5 = Array.from({ length: 5 }, (_, i) =>
    p({ orderId: `o${i}`, packId: "2000014657552263", shippingCost: 7.75, unidades: 1 }));

  it("conta o envio UMA vez, não cinco", () => {
    const r = ratearFretePorPedido(pacoteDe5);
    expect(r.total).toBeCloseTo(7.75, 2);
    expect(r.totalSemRateio).toBeCloseTo(38.75, 2);
  });

  it("cada pedido leva a fatia dele, e as fatias fecham o total", () => {
    const r = ratearFretePorPedido(pacoteDe5);
    for (const o of pacoteDe5) expect(r.porPedido.get(o.orderId)).toBeCloseTo(7.75 / 5, 4);
    const soma = [...r.porPedido.values()].reduce((a, b) => a + b, 0);
    expect(soma).toBeCloseTo(r.total, 6);
  });

  it("reproduz o dia inteiro: R$ 99,30 somados viram R$ 45,80", () => {
    const dia = [
      ...Array.from({ length: 2 }, (_, i) => p({ orderId: `a${i}`, packId: "P-A", shippingCost: 3 })),
      ...Array.from({ length: 5 }, (_, i) => p({ orderId: `b${i}`, packId: "P-B", shippingCost: 7.75 })),
      ...Array.from({ length: 4 }, (_, i) => p({ orderId: `c${i}`, packId: "P-C", shippingCost: 6.5 })),
      // avulsos que somam o resto até 99,30 no jeito antigo
      p({ orderId: "d1", shippingCost: 28.55 }),
    ];
    const r = ratearFretePorPedido(dia);
    expect(r.totalSemRateio).toBeCloseTo(99.30, 2);
    // 3 + 7,75 + 6,50 + 28,55 — o mesmo R$ 45,80 medido no banco.
    expect(r.total).toBeCloseTo(45.80, 2);
    expect(r.enviosCompartilhados).toBe(3);
  });
});

describe("rateio proporcional às unidades", () => {
  it("pedido com mais unidades leva fatia maior", () => {
    const r = ratearFretePorPedido([
      p({ orderId: "a", packId: "P", shippingCost: 12, unidades: 3 }),
      p({ orderId: "b", packId: "P", shippingCost: 12, unidades: 1 }),
    ]);
    expect(r.total).toBeCloseTo(12, 2);
    expect(r.porPedido.get("a")).toBeCloseTo(9, 4);
    expect(r.porPedido.get("b")).toBeCloseTo(3, 4);
  });

  it("sem unidades conhecidas, divide igual — não perde nem concentra", () => {
    const r = ratearFretePorPedido([
      p({ orderId: "a", packId: "P", shippingCost: 10, unidades: 0 }),
      p({ orderId: "b", packId: "P", shippingCost: 10, unidades: 0 }),
    ]);
    expect(r.porPedido.get("a")).toBeCloseTo(5, 4);
    expect(r.porPedido.get("b")).toBeCloseTo(5, 4);
  });
});

describe("bordas", () => {
  it("pedido avulso continua com o frete inteiro", () => {
    const r = ratearFretePorPedido([p({ orderId: "solo", shippingCost: 18.9 })]);
    expect(r.total).toBeCloseTo(18.9, 2);
    expect(r.porPedido.get("solo")).toBeCloseTo(18.9, 2);
    expect(r.enviosCompartilhados).toBe(0);
  });

  it("um pedido do pacote ainda sem custo buscado NÃO zera o frete do grupo", () => {
    // Por isso o custo do grupo é o MAIOR, e não o primeiro: pegar o primeiro
    // poderia pegar justamente o zero e perder o frete inteiro.
    const r = ratearFretePorPedido([
      p({ orderId: "a", packId: "P", shippingCost: 0 }),
      p({ orderId: "b", packId: "P", shippingCost: 8.4 }),
    ]);
    expect(r.total).toBeCloseTo(8.4, 2);
  });

  it("frete negativo é tratado como zero, nunca como crédito", () => {
    const r = ratearFretePorPedido([p({ orderId: "a", shippingCost: -5 })]);
    expect(r.total).toBe(0);
  });

  it("pacotes diferentes não se misturam", () => {
    const r = ratearFretePorPedido([
      p({ orderId: "a", packId: "P1", shippingCost: 5 }),
      p({ orderId: "b", packId: "P2", shippingCost: 7 }),
    ]);
    expect(r.total).toBeCloseTo(12, 2);
    expect(r.enviosCompartilhados).toBe(0);
  });

  it("lista vazia não quebra", () => {
    const r = ratearFretePorPedido([]);
    expect(r.total).toBe(0);
    expect(r.porPedido.size).toBe(0);
  });

  it("frete zero em tudo continua zero — não inventa custo", () => {
    const r = ratearFretePorPedido([p({ orderId: "a", packId: "P" }), p({ orderId: "b", packId: "P" })]);
    expect(r.total).toBe(0);
  });
});
