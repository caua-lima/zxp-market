import { describe, expect, it } from "vitest";
import { datasPorExtenso, inboundValido, lerAgenda } from "./agenda-full";

const ok = (corpo: unknown, caminho = "/inbounds/80517703") => ({ caminho, status: 200, corpo });

describe("lerAgenda", () => {
  it("acha datas livres numa lista de agenda (vários formatos)", () => {
    expect(lerAgenda([ok({ id: 80517703, available_slots: [{ date: "2026-10-30", from: "08:00" }, { date: "2026-10-31T10:00:00Z" }] })]))
      .toMatchObject({ estado: "datas_liberadas", datas: ["2026-10-30", "2026-10-31"] });
    expect(lerAgenda([ok({ schedule: { availability: ["2026-11-03", "2026-11-03", "2026-11-01"] } })]).datas).toEqual(["2026-11-01", "2026-11-03"]);
    expect(lerAgenda([ok([{ dates: [{ day: "2026-11-05" }] }])]).estado).toBe("datas_liberadas");
  });

  it("lista de agenda vazia é 'sem datas'", () => {
    expect(lerAgenda([ok({ status: "working", available_dates: [] })])).toMatchObject({ estado: "sem_datas", datas: [] });
  });

  it("data solta (criação, prazo) NÃO é vaga", () => {
    expect(lerAgenda([ok({ date_created: "2026-10-20T10:00:00Z", expiration_date: "2026-11-20", items: [{ id: "MLB1" }] })]).estado).toBe("indefinido");
  });

  it("ML recusou tudo: sem acesso; 404 sozinho não é recusa", () => {
    expect(lerAgenda([{ caminho: "/inbounds/1/appointments", status: 403, corpo: null }, { caminho: "/inbounds/1/slots", status: 404, corpo: null }]).estado).toBe("sem_acesso");
    expect(lerAgenda([{ caminho: "/inbounds/1", status: 404, corpo: null }]).estado).toBe("indefinido");
    expect(lerAgenda([{ caminho: "/inbounds/1", status: 500, corpo: null }]).estado).toBe("indefinido");
  });

  it("o detalhe diz o que cada endereço respondeu", () => {
    const r = lerAgenda([{ caminho: "/inbounds/80517703", status: 200, corpo: {} }, { caminho: "/inbounds/80517703/appointments", status: 403, corpo: null }]);
    expect(r.detalhe).toBe("/ 200 · /appointments 403");
  });
});

describe("inboundValido e datasPorExtenso", () => {
  it("aceita '#80517703' e recusa lixo", () => {
    expect(inboundValido("#80517703")).toBe("80517703");
    expect(inboundValido(" 80517703 ")).toBe("80517703");
    for (const ruim of ["", "abc", "123", "1/2", "8051770312345678"]) expect(inboundValido(ruim)).toBeNull();
  });
  it("texto curto das datas", () => {
    expect(datasPorExtenso(["2026-10-30"])).toBe("30/10");
    expect(datasPorExtenso(["2026-10-30", "2026-10-31", "2026-11-03"])).toBe("30/10, 31/10 e 03/11");
    expect(datasPorExtenso(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"])).toBe("01/11, 02/11, 03/11 e 04/11 (+1)");
  });
});
