import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { formaCanonica, impressaoDigital } from "./migracao-dados";

describe("Etapa 5 — impressão digital do conteúdo (conferência da migração)", () => {
  it("ordem das chaves não importa; qualquer valor diferente importa", () => {
    expect(impressaoDigital({ a: 1, b: { y: 2, x: [1, "2"] } })).toBe(impressaoDigital({ b: { x: [1, "2"], y: 2 }, a: 1 }));
    expect(impressaoDigital({ a: 1 })).not.toBe(impressaoDigital({ a: "1" }));
    expect(impressaoDigital({ a: [1, 2] })).not.toBe(impressaoDigital({ a: [2, 1] }));
  });

  it("Timestamp pelo instante exato, até o nanossegundo", () => {
    const t = new Timestamp(1_790_000_000, 123);
    expect(formaCanonica(t)).toBe('"T:1790000000.123"');
    expect(impressaoDigital({ em: t })).not.toBe(impressaoDigital({ em: new Timestamp(1_790_000_000, 124) }));
  });

  it("campo ausente ≠ campo nulo? não — os dois somem igual no Firestore, e aqui também", () => {
    expect(formaCanonica(undefined)).toBe(formaCanonica(null));
  });
});
