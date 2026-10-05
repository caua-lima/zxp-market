import { describe, expect, it } from "vitest";
import { vendasBrutasPorAnuncio, type PedidoParaVendasBrutas } from "./vendas-brutas";

const chaveDe = (it: { item_id?: string; sku?: string }) => String(it.item_id ?? "").trim().toUpperCase().replace(/^MLB/, "") || String(it.sku ?? "").trim().toLowerCase();
const nomes: Record<string, string> = { "111": "Cabo USB (cadastrado)" };
const nomeDe = (it: { item_id?: string }) => nomes[chaveDe(it)];

const ped = (orderId: string, classe: PedidoParaVendasBrutas["classe"], itens: PedidoParaVendasBrutas["itens"]): PedidoParaVendasBrutas => ({ orderId, classe, itens });

describe("vendas brutas por anúncio (a base da curva ABC)", () => {
  it("soma preço × unidades dos pedidos VÁLIDOS; cancelado e devolvido ficam fora do bruto e vão pra 'perdido'", () => {
    const r = vendasBrutasPorAnuncio([
      ped("1", "valida", [{ item_id: "MLB111", quantity: 2, unit_price: 50, title: "Cabo" }]),
      ped("2", "valida", [{ item_id: "MLB111", quantity: 1, unit_price: 50, title: "Cabo" }]),
      ped("3", "cancelada", [{ item_id: "MLB111", quantity: 4, unit_price: 50, title: "Cabo" }]),
      ped("4", "devolvida", [{ item_id: "MLB111", quantity: 1, unit_price: 50, title: "Cabo" }]),
    ], chaveDe, nomeDe);
    expect(r).toEqual([{ item_id: "MLB111", title: "Cabo USB (cadastrado)", bruto: 150, perdido: 250, qty: 3, pedidos: 2 }]);
  });

  it("conta anúncio SEM produto vinculado (a curva de lucro não vê esses; venda não depende de custo)", () => {
    const r = vendasBrutasPorAnuncio([
      ped("1", "valida", [{ item_id: "MLB999", quantity: 1, unit_price: 80, title: "Anúncio sem cadastro" }]),
    ], chaveDe, nomeDe);
    expect(r).toMatchObject([{ title: "Anúncio sem cadastro", bruto: 80 }]);
  });

  it("um pedido com vários itens soma cada um no seu anúncio; 'pedidos' conta o pedido uma vez só", () => {
    const r = vendasBrutasPorAnuncio([
      ped("1", "valida", [
        { item_id: "MLB111", quantity: 1, unit_price: 30 },
        { item_id: "MLB111", quantity: 1, unit_price: 30 }, // mesmo anúncio, duas linhas (variações)
        { item_id: "MLB222", quantity: 3, unit_price: 10, title: "Outro" },
      ]),
    ], chaveDe, nomeDe);
    expect(r.find((x) => x.item_id === "MLB111")).toMatchObject({ bruto: 60, qty: 2, pedidos: 1 });
    expect(r.find((x) => x.item_id === "MLB222")).toMatchObject({ bruto: 30, qty: 3, pedidos: 1 });
  });

  it("anúncio que só teve pedido cancelado não entra na curva", () => {
    const r = vendasBrutasPorAnuncio([
      ped("1", "cancelada", [{ item_id: "MLB555", quantity: 1, unit_price: 99, title: "Só cancelou" }]),
      ped("2", "valida", [{ item_id: "MLB111", quantity: 1, unit_price: 10 }]),
    ], chaveDe, nomeDe);
    expect(r.map((x) => x.item_id)).toEqual(["MLB111"]);
  });

  it("ordena pelo maior bruto; empate pelo nome (estável entre leituras)", () => {
    const r = vendasBrutasPorAnuncio([
      ped("1", "valida", [
        { item_id: "MLB1", quantity: 1, unit_price: 10, title: "Zebra" },
        { item_id: "MLB2", quantity: 1, unit_price: 10, title: "Abelha" },
        { item_id: "MLB3", quantity: 1, unit_price: 99, title: "Campeão" },
      ]),
    ], chaveDe, () => undefined);
    expect(r.map((x) => x.title)).toEqual(["Campeão", "Abelha", "Zebra"]);
  });

  it("item sem id nem SKU não some: vira 'Sem identificação' (a soma continua fechando)", () => {
    const r = vendasBrutasPorAnuncio([ped("1", "valida", [{ quantity: 1, unit_price: 12 }])], chaveDe, () => undefined);
    expect(r).toMatchObject([{ title: "Sem identificação", bruto: 12 }]);
  });

  it("quantidade ausente vale 1; preço ausente vale 0 (não vira NaN)", () => {
    const r = vendasBrutasPorAnuncio([
      ped("1", "valida", [{ item_id: "MLB1", unit_price: 7 }, { item_id: "MLB2" }]),
    ], chaveDe, () => undefined);
    expect(r.map((x) => [x.item_id, x.bruto, x.qty])).toEqual([["MLB1", 7, 1]]);
  });
});
