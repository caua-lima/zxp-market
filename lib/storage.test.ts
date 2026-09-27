import { afterEach, beforeEach, describe, expect, it } from "vitest";
// localStorage em memória: o ambiente de teste é node (sem jsdom).
const guardado = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => (guardado.has(k) ? guardado.get(k)! : null),
    setItem: (k: string, v: string) => void guardado.set(k, String(v)),
    removeItem: (k: string) => void guardado.delete(k),
    clear: () => guardado.clear(),
  },
});

import { definirEscopoDoCache } from "./firebase/cache";
import { chaveComEscopo, gravarChaveApp, lerChaveApp } from "./storage";

beforeEach(() => { localStorage.clear(); definirEscopoDoCache(""); });
afterEach(() => { delete process.env.NEXT_PUBLIC_ZXP_MODO_DADOS; });

describe("S23 — preferências locais por pessoa+empresa", () => {
  it("chave com escopo; sem escopo cai na global", () => {
    expect(chaveComEscopo("u1|emp", "estoque:planejados")).toBe("zxpmarket:u1|emp:estoque:planejados");
    expect(chaveComEscopo("", "estoque:planejados")).toBe("zxpmarket:estoque:planejados");
  });

  it("a preferência de uma pessoa não aparece pra próxima no mesmo navegador", () => {
    definirEscopoDoCache("u1|emp-a");
    gravarChaveApp("pedidos:filtros-salvos", "[\"filtro-da-u1\"]");
    definirEscopoDoCache("u2|emp-b");
    expect(lerChaveApp("pedidos:filtros-salvos")).toBeNull();
    definirEscopoDoCache("u1|emp-a");
    expect(lerChaveApp("pedidos:filtros-salvos")).toBe("[\"filtro-da-u1\"]");
  });

  it("modo raiz herda a chave global antiga uma vez; modo empresa nunca herda", () => {
    localStorage.setItem("zxpmarket:estoque:planejados", "[1]");
    process.env.NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant";
    definirEscopoDoCache("u1|emp-a");
    expect(lerChaveApp("estoque:planejados")).toBeNull();
    delete process.env.NEXT_PUBLIC_ZXP_MODO_DADOS;
    expect(lerChaveApp("estoque:planejados")).toBe("[1]");
    expect(localStorage.getItem("zxpmarket:estoque:planejados")).toBeNull();
    definirEscopoDoCache("u2|emp-a");
    expect(lerChaveApp("estoque:planejados")).toBeNull();
  });
});
