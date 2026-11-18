import { describe, expect, it } from "vitest";
import { fatosPermanentes } from "./gravar-pedido";

describe("fatosPermanentes", () => {
  it("motivo do cancelamento e pedido da separação vão mesmo com retrato velho", () => {
    expect(fatosPermanentes({ status: "cancelled", motivo_cancelamento: "pack_splitted", pedido_da_separacao: false })).toEqual({ motivo_cancelamento: "pack_splitted" });
    expect(fatosPermanentes({ status: "paid", motivo_cancelamento: null, pedido_da_separacao: true })).toEqual({ pedido_da_separacao: true });
  });

  it("sem fato, nada (não apaga o que já está gravado)", () => {
    expect(fatosPermanentes({ status: "paid", motivo_cancelamento: null, pedido_da_separacao: false })).toEqual({});
  });
});
