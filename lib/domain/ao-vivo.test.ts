import { describe, expect, it } from "vitest";
import { haQuantoTempo, prepararPedidosAoVivo, relogioBR, resumirAoVivo, ritmoVsOntem, type PedidoAoVivo } from "./ao-vivo";

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
