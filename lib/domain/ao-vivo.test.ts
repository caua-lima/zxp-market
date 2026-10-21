import { describe, expect, it } from "vitest";
import { haQuantoTempo, metaDoDia, prepararPedidosAoVivo, redigirOperacao, relogioBR, resumirAoVivo, ritmoVsOntem, type PedidoAoVivo } from "./ao-vivo";

// 12/10/2026 14:30 em Brasília = 17:30 UTC.
const AGORA = Date.parse("2026-10-12T14:30:00.000-03:00");
const p = (orderId: string, quando: string, totalAmount: number, x: Partial<PedidoAoVivo> = {}): PedidoAoVivo => ({
  orderId, dateCreated: quando, totalAmount, unidades: 1, classe: "valida", ...x,
});

describe("ao vivo — o dia em andamento", () => {
  it("soma só os pedidos VÁLIDOS de hoje; cancelado/devolvido fica à parte (mesma base do Dashboard)", () => {
    const r = resumirAoVivo([
      p("1", "2026-10-12T09:00:00.000-03:00", 100, { unidades: 2 }),
      p("2", "2026-10-12T13:10:00.000-03:00", 50),
      p("3", "2026-10-12T11:00:00.000-03:00", 247.88, { classe: "cancelada" }),
      p("4", "2026-10-12T12:00:00.000-03:00", 30, { classe: "devolvida" }),
    ], AGORA);
    expect(r.hoje).toEqual({ vendas: 150, pedidos: 2, unidades: 3, canceladoValor: 277.88, canceladoPedidos: 2 });
    expect(r.dia).toBe("2026-10-12");
    expect(r.horaAtual).toBe(14);
  });

  it("compara com ontem ATÉ ESTA HORA, não com o dia inteiro de ontem", () => {
    const r = resumirAoVivo([
      p("h", "2026-10-12T10:00:00.000-03:00", 300),
      p("o1", "2026-10-11T09:00:00.000-03:00", 100),  // ontem, antes das 14:30
      p("o2", "2026-10-11T14:30:00.000-03:00", 40),   // ontem, exatamente 14:30 → conta
      p("o3", "2026-10-11T14:30:01.000-03:00", 999),  // ontem, 1 s depois → não conta ainda
      p("o4", "2026-10-11T22:00:00.000-03:00", 500),  // ontem à noite
    ], AGORA);
    expect(r.ontemAteAgora).toEqual({ vendas: 140, pedidos: 2, unidades: 2 });
    expect(r.ontemInteiro).toEqual({ vendas: 1639, pedidos: 4, unidades: 4 });
  });

  it("o dia é o de BRASÍLIA: venda às 23h de ontem (02h UTC de hoje) é de ontem", () => {
    const r = resumirAoVivo([
      p("a", "2026-10-12T02:00:00.000Z", 70),          // 23:00 do dia 11 em Brasília
      p("b", "2026-10-12T03:00:00.000Z", 20),          // 00:00 do dia 12 em Brasília
    ], AGORA);
    expect(r.hoje.vendas).toBe(20);
    expect(r.ontemInteiro.vendas).toBe(70);
    expect(r.porHora.ontem[23]).toBe(70);
    expect(r.porHora.hoje[0]).toBe(20);
  });

  it("o ML manda fuso −04:00 em alguns pedidos: o instante é o que vale, não o texto", () => {
    // 13:30 em −04:00 = 14:30 em Brasília.
    const r = resumirAoVivo([p("x", "2026-10-12T13:30:00.000-04:00", 10)], AGORA);
    expect(r.porHora.hoje[14]).toBe(10);
  });

  it("por hora: cada venda cai na hora dela, 24 posições", () => {
    const r = resumirAoVivo([
      p("1", "2026-10-12T09:05:00.000-03:00", 10),
      p("2", "2026-10-12T09:55:00.000-03:00", 5),
      p("3", "2026-10-12T14:00:00.000-03:00", 7),
    ], AGORA);
    expect(r.porHora.hoje).toHaveLength(24);
    expect(r.porHora.hoje[9]).toBe(15);
    expect(r.porHora.hoje[14]).toBe(7);
    expect(r.porHora.hoje.reduce((s, v) => s + v, 0)).toBe(r.hoje.vendas);
  });

  it("última venda: a mais recente VÁLIDA de hoje", () => {
    const r = resumirAoVivo([
      p("1", "2026-10-12T09:00:00.000-03:00", 10, { titulo: "Cabo" }),
      p("2", "2026-10-12T14:20:00.000-03:00", 31, { titulo: "Erva Tradicional" }),
      p("3", "2026-10-12T14:25:00.000-03:00", 99, { titulo: "Cancelada", classe: "cancelada" }),
    ], AGORA);
    expect(r.ultimaVenda).toMatchObject({ valor: 31, titulo: "Erva Tradicional" });
  });

  it("sem venda hoje: zeros e sem última venda; pedido de anteontem ou com data ilegível é ignorado", () => {
    const r = resumirAoVivo([
      p("a", "2026-10-10T10:00:00.000-03:00", 500),
      p("b", "data-quebrada", 500),
    ], AGORA);
    expect(r.hoje).toEqual({ vendas: 0, pedidos: 0, unidades: 0, canceladoValor: 0, canceladoPedidos: 0 });
    expect(r.ontemInteiro.vendas).toBe(0);
    expect(r.ultimaVenda).toBeNull();
  });

  it("há quanto tempo, em texto curto", () => {
    expect(haQuantoTempo(AGORA - 20_000, AGORA)).toBe("agora");
    expect(haQuantoTempo(AGORA - 4 * 60_000, AGORA)).toBe("há 4 min");
    expect(haQuantoTempo(AGORA - 125 * 60_000, AGORA)).toBe("há 2 h");
    expect(haQuantoTempo(AGORA + 5000, AGORA)).toBe("agora"); // relógio do ML à frente
  });
});

describe("ao vivo — classificação igual à do Dashboard", () => {
  const bruto = (id: string, status: string, total: number, x: Record<string, unknown> = {}) => ({
    order_id: id, status, date_created: "2026-10-12T10:00:00.000-03:00", total_amount: total,
    items: [{ item_id: "MLB1", quantity: 1, title: "Erva" }], ...x,
  });

  it("cancelado pelo status, devolvido pela devolução concluída, o resto vale", () => {
    const r = prepararPedidosAoVivo(
      [bruto("1", "paid", 100), bruto("2", "cancelled", 50), bruto("3", "paid", 30)],
      new Set(), new Set(["3"]),
    );
    expect(r.map((x) => [x.orderId, x.classe])).toEqual([["1", "valida"], ["2", "cancelada"], ["3", "devolvida"]]);
  });

  it("o status ao vivo manda sobre o cache de cancelados", () => {
    const r = prepararPedidosAoVivo([bruto("1", "paid", 100)], new Set(["1"]), new Set());
    expect(r[0].classe).toBe("valida");
  });

  it("pedido cancelado só pra virar outros do mesmo pacote some — não é venda nem cancelamento", () => {
    const r = prepararPedidosAoVivo(
      [bruto("1", "cancelled", 200, { pack_id: "P" }), bruto("2", "paid", 100, { pack_id: "P" }), bruto("3", "paid", 100, { pack_id: "P" })],
      new Set(), new Set(),
    );
    expect(r.map((x) => x.orderId)).toEqual(["2", "3"]);
    const resumo = resumirAoVivo(r, AGORA);
    expect(resumo.hoje).toMatchObject({ vendas: 200, pedidos: 2, canceladoPedidos: 0 });
  });

  it("unidades somam as quantidades; título é o do primeiro item; pedido sem itens não quebra", () => {
    const r = prepararPedidosAoVivo([
      bruto("1", "paid", 90, { items: [{ item_id: "A", quantity: 2, title: "Cuia" }, { item_id: "B", quantity: 3, title: "Bomba" }] }),
      bruto("2", "paid", 10, { items: undefined }),
    ], new Set(), new Set());
    expect(r[0]).toMatchObject({ unidades: 5, titulo: "Cuia" });
    expect(r[1]).toMatchObject({ unidades: 0, titulo: "" });
  });
});

describe("ao vivo — a frase do ritmo", () => {
  it("à frente, atrás, igual, novo e sem base", () => {
    expect(ritmoVsOntem(118, 100, "14:30")).toEqual({ texto: "↑ 18% vs ontem até 14:30", tom: "bom" });
    expect(ritmoVsOntem(60, 100, "14:30")).toEqual({ texto: "↓ 40% vs ontem até 14:30", tom: "ruim" });
    expect(ritmoVsOntem(100.2, 100, "09:05")).toEqual({ texto: "= igual a ontem até 09:05", tom: "neutro" });
    expect(ritmoVsOntem(50, 0, "08:00")).toEqual({ texto: "novo vs ontem até 08:00", tom: "bom" });
    expect(ritmoVsOntem(0, 0, "08:00")).toBeNull();
  });

  it("o relógio é o de Brasília", () => {
    expect(relogioBR(AGORA)).toBe("14:30");
    expect(relogioBR(Date.parse("2026-10-12T02:05:00.000Z"))).toBe("23:05");
  });
});

describe("ao vivo — compradores e produtos do dia", () => {
  const item = (itemId: string, titulo: string, qty: number, valor: number) => ({ itemId, titulo, qty, valor });
  const v = (id: string, quando: string, total: number, comprador: string, itens: ReturnType<typeof item>[], x: Partial<PedidoAoVivo> = {}): PedidoAoVivo =>
    ({ orderId: id, dateCreated: quando, totalAmount: total, unidades: itens.reduce((s, i) => s + i.qty, 0), classe: "valida", compradorId: comprador, itens, ...x });

  it("conta compradores DISTINTOS entre as vendas válidas de hoje", () => {
    const r = resumirAoVivo([
      v("1", "2026-10-12T09:00:00.000-03:00", 10, "A", [item("X", "x", 1, 10)]),
      v("2", "2026-10-12T10:00:00.000-03:00", 10, "A", [item("X", "x", 1, 10)]),
      v("3", "2026-10-12T11:00:00.000-03:00", 10, "B", [item("X", "x", 1, 10)]),
      v("4", "2026-10-12T11:00:00.000-03:00", 10, "C", [item("X", "x", 1, 10)], { classe: "cancelada" }),
      v("5", "2026-10-11T11:00:00.000-03:00", 10, "D", [item("X", "x", 1, 10)]),
    ], AGORA);
    expect(r.compradores).toBe(2);
  });

  it("ranqueia produtos por RECEITA, não por unidades, e soma pedidos e unidades", () => {
    const r = resumirAoVivo([
      v("1", "2026-10-12T09:00:00.000-03:00", 745, "A", [item("CARO", "Açaí", 1, 745)]),
      v("2", "2026-10-12T10:00:00.000-03:00", 60, "B", [item("BARATO", "Erva", 6, 60)]),
      v("3", "2026-10-12T11:00:00.000-03:00", 60, "C", [item("BARATO", "Erva", 6, 60)]),
    ], AGORA);
    expect(r.topProdutos.map((p) => p.itemId)).toEqual(["CARO", "BARATO"]);
    expect(r.topProdutos[1]).toEqual({ itemId: "BARATO", titulo: "Erva", receita: 120, unidades: 12, pedidos: 2 });
  });

  it("cancelado e ontem não entram no ranking; o ranking tem no máximo 5", () => {
    const itens = ["A", "B", "C", "D", "E", "F", "G"].map((id, i) => item(id, id, 1, 100 - i));
    const r = resumirAoVivo([
      ...itens.map((i, n) => v(String(n), "2026-10-12T09:00:00.000-03:00", i.valor, "c" + n, [i])),
      v("c", "2026-10-12T09:00:00.000-03:00", 5000, "z", [item("CANC", "cancelado", 1, 5000)], { classe: "cancelada" }),
      v("o", "2026-10-11T09:00:00.000-03:00", 5000, "z", [item("ONTEM", "ontem", 1, 5000)]),
    ], AGORA);
    expect(r.topProdutos.map((p) => p.itemId)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("empate de receita desempata pelo id (ranking estável)", () => {
    const r = resumirAoVivo([
      v("1", "2026-10-12T09:00:00.000-03:00", 10, "a", [item("B", "b", 1, 10)]),
      v("2", "2026-10-12T09:00:00.000-03:00", 10, "b", [item("A", "a", 1, 10)]),
    ], AGORA);
    expect(r.topProdutos.map((p) => p.itemId)).toEqual(["A", "B"]);
  });

  it("prepararPedidosAoVivo leva comprador e itens (valor = preço × quantidade)", () => {
    const [p] = prepararPedidosAoVivo([{
      order_id: "1", status: "paid", date_created: "2026-10-12T10:00:00.000-03:00", total_amount: 90, buyer_id: 777,
      items: [{ item_id: "MLB1", quantity: 3, title: "Erva", unit_price: 30 }],
    }], new Set(), new Set());
    expect(p.compradorId).toBe("777");
    expect(p.itens).toEqual([{ itemId: "MLB1", titulo: "Erva", qty: 3, valor: 90 }]);
  });
});

describe("ao vivo — o que o member não vê", () => {
  const corpo = { visitas: 167, receita: 1260, topProdutos: [{ itemId: "A", estoque: 47 }, { itemId: "B", estoque: null }] };
  it("quem vê a operação recebe tudo, intacto", () => {
    expect(redigirOperacao(corpo, true)).toBe(corpo);
  });
  it("quem não vê: visitas e estoque viram null (nunca zero) e o resto fica", () => {
    const r = redigirOperacao(corpo, false);
    expect(r.visitas).toBeNull();
    expect(r.topProdutos).toEqual([{ itemId: "A", estoque: null }, { itemId: "B", estoque: null }]);
    expect(r.receita).toBe(1260);
    expect(corpo.visitas).toBe(167); // não mutou o original (o cache guarda a versão completa)
  });
});

describe("ao vivo — meta de hoje (mesmas regras do Dashboard)", () => {
  it("o alvo de hoje é o que falta até ontem dividido pelos dias que restam (hoje incluso)", () => {
    // Meta 300 mil, mês de 30 dias, dia 21: faltam 10 dias. Até ontem vendeu 200 mil → 100 mil / 10 = 10 mil.
    const m = metaDoDia({ metas: { meta1: 300000 }, vendasAteOntem: 200000, vendasHoje: 4000, diaAtual: 21, diasNoMes: 30 })!;
    expect(m.alvo).toBe(10000);
    expect(m.pct).toBe(40);
    expect(m.falta).toBe(6000);
    expect(m.batida).toBe(false);
    expect(m.metaIndex).toBe(1);
  });

  it("o alvo não encolhe a cada venda do dia (sai do acumulado até ONTEM)", () => {
    const base = { metas: { meta1: 300000 }, vendasAteOntem: 200000, diaAtual: 21, diasNoMes: 30 };
    expect(metaDoDia({ ...base, vendasHoje: 0 })!.alvo).toBe(metaDoDia({ ...base, vendasHoje: 9000 })!.alvo);
  });

  it("bater a Meta 1 libera a Meta 2", () => {
    const m = metaDoDia({ metas: { meta1: 100000, meta2: 150000 }, vendasAteOntem: 110000, vendasHoje: 0, diaAtual: 21, diasNoMes: 30 })!;
    expect(m.metaIndex).toBe(2);
    expect(m.alvo).toBe(4000); // (150 − 110) mil / 10 dias
  });

  it("mês já batido: alvo zero, conta como batida", () => {
    const m = metaDoDia({ metas: { meta1: 100000 }, vendasAteOntem: 120000, vendasHoje: 0, diaAtual: 25, diasNoMes: 30 })!;
    expect(m).toMatchObject({ alvo: 0, mesBatido: true, batida: true });
  });

  it("último dia do mês: o alvo é tudo que falta", () => {
    expect(metaDoDia({ metas: { meta1: 100000 }, vendasAteOntem: 95000, vendasHoje: 0, diaAtual: 31, diasNoMes: 31 })!.alvo).toBe(5000);
  });

  it("sem meta: null", () => {
    expect(metaDoDia({ metas: null, vendasAteOntem: 0, vendasHoje: 0, diaAtual: 1, diasNoMes: 30 })).toBeNull();
    expect(metaDoDia({ metas: { meta1: 0 }, vendasAteOntem: 0, vendasHoje: 0, diaAtual: 1, diasNoMes: 30 })).toBeNull();
  });
});
