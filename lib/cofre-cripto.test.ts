import { describe, expect, it } from "vitest";
import { cifrar, decifrar, derivarChave } from "./cofre-cripto";

const chave = derivarChave("segredo-de-teste-do-servidor");

describe("cofre de senhas", () => {
  it("cifra e decifra de volta (com acento e símbolo)", () => {
    const g = cifrar("Laís#2026!", chave);
    expect(g).toMatch(/^v1:/);
    expect(g).not.toContain("Laís");
    expect(decifrar(g, chave)).toBe("Laís#2026!");
  });

  it("a mesma senha gravada duas vezes sai diferente (IV aleatório)", () => {
    expect(cifrar("abc123", chave)).not.toBe(cifrar("abc123", chave));
  });

  it("outra chave não abre — o banco sozinho não revela nada", () => {
    const g = cifrar("abc123", chave);
    expect(decifrar(g, derivarChave("outro-segredo"))).toBeNull();
  });

  it("cifra alterada falha em vez de devolver lixo", () => {
    const g = cifrar("abc123", chave);
    const partes = g.split(":");
    const corpo = Buffer.from(partes[3], "base64");
    corpo[0] ^= 1;
    partes[3] = corpo.toString("base64");
    expect(decifrar(partes.join(":"), chave)).toBeNull();
  });

  it("formato desconhecido ou vazio: null", () => {
    expect(decifrar("", chave)).toBeNull();
    expect(decifrar("texto-puro", chave)).toBeNull();
  });

  it("sem segredo no servidor, recusa", () => {
    expect(() => derivarChave("")).toThrow("cofre_sem_segredo");
  });
});
