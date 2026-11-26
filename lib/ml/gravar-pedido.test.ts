import { describe, expect, it } from "vitest";
import { fatosPermanentes, manterDataHerdada } from "./gravar-pedido";

describe("fatosPermanentes", () => {
  it("motivo do cancelamento e pedido da separação vão mesmo com retrato velho", () => {
    expect(fatosPermanentes({ status: "cancelled", motivo_cancelamento: "pack_splitted", pedido_da_separacao: false })).toEqual({ motivo_cancelamento: "pack_splitted" });
    expect(fatosPermanentes({ status: "paid", motivo_cancelamento: null, pedido_da_separacao: true })).toEqual({ pedido_da_separacao: true });
  });

  it("sem fato, nada (não apaga o que já está gravado)", () => {
    expect(fatosPermanentes({ status: "paid", motivo_cancelamento: null, pedido_da_separacao: false })).toEqual({});
  });
});

describe("manterDataHerdada (separação de pacote)", () => {
  it("regravação do ML não devolve a venda pro dia da separação", () => {
    const antes = { date_created: "2026-11-17T22:10:25.000-04:00", date_created_ml: "2026-11-18T05:05:20.000-04:00" };
    const r = manterDataHerdada({ date_created: "2026-11-18T05:05:20.000-04:00", status: "paid" }, antes);
    expect(r.date_created).toBe("2026-11-17T22:10:25.000-04:00");
    expect(r.date_created_ml).toBe("2026-11-18T05:05:20.000-04:00");
    expect(r.status).toBe("paid");
  });
  it("pedido comum: não mexe", () => {
    expect(manterDataHerdada({ date_created: "X" }, { date_created: "Y" })).toEqual({ date_created: "X" });
    expect(manterDataHerdada({ status: "paid" }, { date_created: "Y", date_created_ml: "Z" })).toEqual({ status: "paid" });
  });
});
