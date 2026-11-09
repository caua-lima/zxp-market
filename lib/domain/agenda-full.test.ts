import { describe, expect, it } from "vitest";
import { datasPorExtenso, inboundValido } from "./agenda-full";

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
