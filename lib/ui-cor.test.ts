import { describe, it, expect } from "vitest";
import { tom } from "./ui-cor";

describe("tom — transparência sobre qualquer cor", () => {
  it("funciona com var(), que era o caso que quebrava com sufixo hexadecimal", () => {
    expect(tom("var(--green)", 27)).toBe("color-mix(in srgb, var(--green) 27%, transparent)");
  });
  it("funciona com hexadecimal", () => {
    expect(tom("#E9A92D", 12)).toBe("color-mix(in srgb, #E9A92D 12%, transparent)");
  });
  it("nunca devolve um sufixo colado à cor (o formato inválido)", () => {
    expect(tom("var(--red)", 30)).not.toMatch(/\)\d{2}$/);
  });
  it("limita o percentual a 0–100 e arredonda", () => {
    expect(tom("red", 250)).toContain(" 100%");
    expect(tom("red", -5)).toContain(" 0%");
    expect(tom("red", 26.6)).toContain(" 27%");
  });
});
