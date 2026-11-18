import { describe, expect, it } from "vitest";
import { classificarVenda, detectarPedidosSubstituidos, ehStatusNaoVenda, temStatusConfiavel } from "./venda-status";

function entrada(over: Partial<Parameters<typeof classificarVenda>[0]> = {}) {
  return { status: "paid", noCacheDeCancelados: false, temDevolucaoConcluida: false, ...over };
}

describe("ehStatusNaoVenda", () => {
  it("cancelled e invalid não são venda", () => {
    expect(ehStatusNaoVenda("cancelled")).toBe(true);
    expect(ehStatusNaoVenda("invalid")).toBe(true);
  });

  it("não depende de caixa nem de espaço em volta", () => {
    expect(ehStatusNaoVenda(" Cancelled ")).toBe(true);
    expect(ehStatusNaoVenda("INVALID")).toBe(true);
  });

  it("paid e delivered são venda", () => {
    expect(ehStatusNaoVenda("paid")).toBe(false);
    expect(ehStatusNaoVenda("delivered")).toBe(false);
  });

  it("vazio/ausente não é 'não venda' — é falta de informação", () => {
    expect(ehStatusNaoVenda("")).toBe(false);
    expect(ehStatusNaoVenda(undefined)).toBe(false);
    expect(temStatusConfiavel("")).toBe(false);
    expect(temStatusConfiavel("paid")).toBe(true);
  });
});

describe("classificarVenda — o status ao vivo manda sobre o cache", () => {
  it("venda normal é válida", () => {
    expect(classificarVenda(entrada())).toEqual({ classe: "valida", resgatadoDoCache: false });
  });

  it("status cancelled é cancelada, sem depender do cache", () => {
    const r = classificarVenda(entrada({ status: "cancelled" }));
    expect(r.classe).toBe("cancelada");
    expect(r.resgatadoDoCache).toBe(false);
  });

  it("O BUG: cache diz cancelada, ML diz paid → vale, e marca o resgate", () => {
    // ml_returns só escreve e nunca remove. Um cancelamento revertido ficava
    // descontado pra sempre — foi o que tirou R$ 360,28 do faturamento.
    const r = classificarVenda(entrada({ status: "paid", noCacheDeCancelados: true }));
    expect(r.classe).toBe("valida");
    expect(r.resgatadoDoCache).toBe(true);
  });

  it("cache e ML concordando no cancelamento não conta como resgate", () => {
    const r = classificarVenda(entrada({ status: "cancelled", noCacheDeCancelados: true }));
    expect(r.classe).toBe("cancelada");
    expect(r.resgatadoDoCache).toBe(false);
  });

  it("sem status confiável, o cache é a única fonte — segue cancelada", () => {
    const r = classificarVenda(entrada({ status: "", noCacheDeCancelados: true }));
    expect(r.classe).toBe("cancelada");
    expect(r.resgatadoDoCache).toBe(false);
  });

  it("devolução concluída reverte a venda mesmo com status paid", () => {
    // Devolução vem de claim pós-venda; o status do pedido não a carrega.
    const r = classificarVenda(entrada({ status: "paid", temDevolucaoConcluida: true }));
    expect(r.classe).toBe("devolvida");
  });

  it("resgatada do cache mas COM devolução concluída continua devolvida", () => {
    // Não pode virar "válida" só porque o cancelamento era falso: a devolução
    // é um sinal independente e continua valendo.
    const r = classificarVenda(entrada({
      status: "paid", noCacheDeCancelados: true, temDevolucaoConcluida: true,
    }));
    expect(r.classe).toBe("devolvida");
    expect(r.resgatadoDoCache).toBe(true);
  });

  it("cancelada no ML tem prioridade sobre devolução — não há o que devolver", () => {
    const r = classificarVenda(entrada({ status: "cancelled", temDevolucaoConcluida: true }));
    expect(r.classe).toBe("cancelada");
  });
});

describe("detectarPedidosSubstituidos — separacao de envio nao e cancelamento", () => {
  /**
   * O caso descrito pelo vendedor: compra de 2 unidades, envio separado na
   * agencia. O ML cancela o pedido original e cria dois unitarios no MESMO
   * pacote. Contar o original inflava bruto e canceladas ao mesmo tempo.
   */
  const pacoteSeparado = [
    { orderId: "orig", packId: "pack1", status: "cancelled" },
    { orderId: "novo1", packId: "pack1", status: "paid" },
    { orderId: "novo2", packId: "pack1", status: "paid" },
  ];

  it("regra 0: cancel_detail pack_splitted basta — pacote todo cancelado, novos em outro pack e em outro dia (caso real de 18/11)", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "a", packId: "p1", status: "cancelled", motivoCancelamento: "pack_splitted", dia: "2026-11-17" },
      { orderId: "b", packId: "p1", status: "cancelled", motivoCancelamento: "pack_splitted", dia: "2026-11-17" },
      { orderId: "real", packId: "p2", status: "cancelled", motivoCancelamento: "buyer_cancel_express", dia: "2026-11-17" },
    ]);
    expect([...s].sort()).toEqual(["a", "b"]);
  });

  it("marca o original como substituido", () => {
    const s = detectarPedidosSubstituidos(pacoteSeparado);
    expect(s.has("orig")).toBe(true);
  });

  it("nao marca os pedidos novos — eles sao a venda", () => {
    const s = detectarPedidosSubstituidos(pacoteSeparado);
    expect(s.has("novo1")).toBe(false);
    expect(s.has("novo2")).toBe(false);
  });

  it("pacote INTEIRO cancelado e cancelamento de verdade, nao substituicao", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "a", packId: "pack2", status: "cancelled" },
      { orderId: "b", packId: "pack2", status: "cancelled" },
    ]);
    expect(s.size).toBe(0);
  });

  it("pedido avulso cancelado (sem pacote) segue cancelamento", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "solo", packId: null, status: "cancelled" },
      { orderId: "outro", packId: "", status: "cancelled" },
    ]);
    expect(s.size).toBe(0);
  });

  it("a ordem dos pedidos na lista nao importa", () => {
    // O valido pode vir depois do cancelado — dois passes garantem isso.
    const s = detectarPedidosSubstituidos([
      { orderId: "orig", packId: "p", status: "cancelled" },
      { orderId: "novo", packId: "p", status: "paid" },
    ]);
    const inverso = detectarPedidosSubstituidos([
      { orderId: "novo", packId: "p", status: "paid" },
      { orderId: "orig", packId: "p", status: "cancelled" },
    ]);
    expect(s).toEqual(inverso);
    expect(s.has("orig")).toBe(true);
  });

  it("pacotes diferentes nao se contaminam", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "a", packId: "p1", status: "cancelled" },
      { orderId: "b", packId: "p2", status: "paid" },
    ]);
    expect(s.size).toBe(0);
  });
});

describe("classificarVenda com substituicao", () => {
  it("substituido NAO conta como cancelado nem como venda", () => {
    const r = classificarVenda(entrada({ status: "cancelled", substituidoNoPacote: true }));
    expect(r.classe).toBe("substituida");
  });

  it("substituicao so vale pra pedido de fato cancelado", () => {
    // Um pedido valido nunca deve ser descartado por causa da flag.
    const r = classificarVenda(entrada({ status: "paid", substituidoNoPacote: true }));
    expect(r.classe).toBe("valida");
  });

  it("cancelamento normal segue cancelamento", () => {
    const r = classificarVenda(entrada({ status: "cancelled", substituidoNoPacote: false }));
    expect(r.classe).toBe("cancelada");
  });
});

describe("2a regra: separacao de envio SEM pack_id reaproveitado", () => {
  /**
   * O ML nem sempre recria os pedidos no mesmo pacote. Medido contra o Seller
   * Center: ~12 pedidos/mes seguiam contados como cancelamento aqui e como
   * venda boa la — R$ 499,59 num unico mes. A ligacao que sobra e comprador +
   * dia + itens.
   */
  const original = {
    orderId: "orig", packId: "packA", status: "cancelled",
    buyerId: "b1", dia: "2026-08-15",
    itens: [{ itemId: "MLB123", qty: 2 }],
  };
  const novos = [
    { orderId: "n1", packId: "packB", status: "paid", buyerId: "b1", dia: "2026-08-15", itens: [{ itemId: "MLB123", qty: 1 }] },
    { orderId: "n2", packId: "packC", status: "paid", buyerId: "b1", dia: "2026-08-15", itens: [{ itemId: "MLB123", qty: 1 }] },
  ];

  it("detecta a substituicao mesmo com pack_id DIFERENTE", () => {
    const s = detectarPedidosSubstituidos([original, ...novos]);
    expect(s.has("orig")).toBe(true);
  });

  it("os pedidos novos continuam sendo venda", () => {
    const s = detectarPedidosSubstituidos([original, ...novos]);
    expect(s.has("n1")).toBe(false);
    expect(s.has("n2")).toBe(false);
  });

  it("comprador DIFERENTE nao liga — cancelamento de verdade", () => {
    const s = detectarPedidosSubstituidos([
      original,
      { ...novos[0], buyerId: "b2" },
      { ...novos[1], buyerId: "b2" },
    ]);
    expect(s.size).toBe(0);
  });

  /**
   * Este teste exigia MESMO DIA e travava o comportamento errado: a separacao
   * do envio acontece na hora de DESPACHAR, quase sempre no dia seguinte, e o
   * ML so cancela e recria naquele momento. Exigir mesmo dia deixava passar o
   * caso comum — que e justamente o que nao batia com o Seller Center.
   */
  it("dia seguinte LIGA — e quando a separacao de fato acontece", () => {
    const s = detectarPedidosSubstituidos([
      original,
      { ...novos[0], dia: "2026-08-16" },
      { ...novos[1], dia: "2026-08-16" },
    ]);
    expect(s.has("orig")).toBe(true);
  });

  it("dentro da janela de 3 dias ainda liga (cancelou sexta, despachou segunda)", () => {
    const s = detectarPedidosSubstituidos([
      original,
      { ...novos[0], dia: "2026-08-18" },
      { ...novos[1], dia: "2026-08-18" },
    ]);
    expect(s.has("orig")).toBe(true);
  });

  it("fora da janela NAO liga — recompra semanas depois nao apaga cancelamento", () => {
    const s = detectarPedidosSubstituidos([
      original,
      { ...novos[0], dia: "2026-08-25" },
      { ...novos[1], dia: "2026-08-25" },
    ]);
    expect(s.size).toBe(0);
  });

  it("pedido valido ANTERIOR nao substitui — o substituto nasce DEPOIS", () => {
    // Sem esta direcao, uma compra antiga do mesmo cliente apagaria um
    // cancelamento posterior legitimo.
    const s = detectarPedidosSubstituidos([
      original,
      { ...novos[0], dia: "2026-08-14" },
      { ...novos[1], dia: "2026-08-14" },
    ]);
    expect(s.size).toBe(0);
  });

  it("cobertura PARCIAL nao basta — 2 un canceladas contra 1 un nova", () => {
    // Exigir cobertura completa e o que impede confundir com cancelamento
    // seguido de uma compra menor.
    const s = detectarPedidosSubstituidos([original, novos[0]]);
    expect(s.size).toBe(0);
  });

  it("item diferente nao liga, mesmo comprador e mesmo dia", () => {
    const s = detectarPedidosSubstituidos([
      original,
      { ...novos[0], itens: [{ itemId: "MLB999", qty: 2 }] },
    ]);
    expect(s.size).toBe(0);
  });

  it("cancelado sem comprador conhecido nao entra na 2a regra", () => {
    const s = detectarPedidosSubstituidos([{ ...original, buyerId: null, packId: null }, ...novos]);
    expect(s.size).toBe(0);
  });

  it("a 1a regra (pacote) continua valendo sozinha", () => {
    const s = detectarPedidosSubstituidos([
      { orderId: "o", packId: "p", status: "cancelled" },
      { orderId: "v", packId: "p", status: "paid" },
    ]);
    expect(s.has("o")).toBe(true);
  });

  it("item_id compara sem depender de caixa", () => {
    const s = detectarPedidosSubstituidos([
      { ...original, itens: [{ itemId: "mlb123", qty: 2 }] },
      ...novos,
    ]);
    expect(s.has("orig")).toBe(true);
  });
});
