import { describe, expect, it } from "vitest";
import { acessoExpirado, expiraEmDe } from "./acesso-temporario";

const T0 = Date.UTC(2026, 8, 27);
describe("Etapa 6 — acesso com prazo", () => {
  it("prazo em dias vira instante; vazio é permanente; fora de 1..30 é recusado", () => {
    expect(expiraEmDe(7, T0)).toBe(T0 + 7 * 86_400_000);
    expect(expiraEmDe("", T0)).toBeNull();
    expect(expiraEmDe(undefined, T0)).toBeNull();
    expect(expiraEmDe(31, T0)).toBe("invalido");
    expect(expiraEmDe(1.5, T0)).toBe("invalido");
    expect(expiraEmDe("abc", T0)).toBe("invalido");
  });
  it("vence no instante exato; sem prazo nunca vence", () => {
    expect(acessoExpirado({ expiraEm: T0 }, T0 - 1)).toBe(false);
    expect(acessoExpirado({ expiraEm: T0 }, T0)).toBe(true);
    expect(acessoExpirado({}, T0)).toBe(false);
    expect(acessoExpirado(null, T0)).toBe(false);
  });
});
