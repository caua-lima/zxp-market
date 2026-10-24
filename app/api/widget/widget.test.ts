import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/** As rotas do widget do iPhone com banco e cálculo simulados. */

const sessao = vi.hoisted(() => ({ atual: null as null | { email: string; tenantId: string | null } }));
vi.mock("@/lib/api-auth", () => ({
  requireAccess: vi.fn(async () => (sessao.atual ? { ...sessao.atual } : NextResponse.json({ error: "unauthorized" }, { status: 401 }))),
}));

const docs = vi.hoisted(() => ({ m: new Map<string, Record<string, unknown>>() }));
vi.mock("@/lib/firebase/admin", () => {
  const ref = (path: string) => ({
    path,
    get: async () => ({ exists: docs.m.has(path), data: () => docs.m.get(path), get: (k: string) => docs.m.get(path)?.[k] }),
    set: async (v: Record<string, unknown>) => { docs.m.set(path, v); },
    delete: async () => { docs.m.delete(path); },
  });
  return {
    getAdminDb: () => ({
      doc: (p: string) => ref(p),
      collection: (c: string) => ({
        doc: (id: string) => ref(`${c}/${id}`),
        where: (campo: string, _op: string, valor: unknown) => ({
          get: async () => ({ docs: [...docs.m.entries()].filter(([k, v]) => k.startsWith(`${c}/`) && v[campo] === valor).map(([k, v]) => ({ ref: ref(k), get: (f: string) => v[f] })) }),
        }),
      }),
    }),
  };
});
vi.mock("@/lib/firebase/contexto-tenant", () => ({ comTenant: (_t: string, fn: () => unknown) => fn() }));
const calc = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
vi.mock("@/lib/ml/ao-vivo-calculo", () => ({
  calcularAoVivo: vi.fn(async (o: unknown) => {
    calc.chamadas.push(o);
    return { doCache: false, body: {
      dia: "2026-10-24", atualizadoEm: 5, hoje: { vendas: 100, pedidos: 2, unidades: 3 }, ontemAteAgora: { vendas: 50 }, porHora: { hoje: Array(24).fill(0) },
      ultimaVenda: null, metaDoDia: null, visitas: 99, topProdutos: [{ estoque: 7 }], compradores: 2,
    } };
  }),
}));

const { POST, DELETE } = await import("./token/route");
const { GET } = await import("./ao-vivo/route");
const { hashDoToken } = await import("@/lib/domain/widget-token");

const req = (url: string, metodo = "GET") => new Request(url, { method: metodo });
const gerar = async () => (await (await POST(req("https://app.test/api/widget/token", "POST"))).json()) as { url: string; script: string };

beforeEach(() => { docs.m.clear(); calc.chamadas.length = 0; sessao.atual = { email: "Dono@A.com", tenantId: null }; docs.m.set("controleAcesso/dono@a.com", { email: "dono@a.com" }); });

describe("widget", () => {
  it("gera o código (só o hash fica), devolve a URL e o script prontos", async () => {
    const r = await gerar();
    expect(r.url).toMatch(/^https:\/\/app\.test\/api\/widget\/ao-vivo\?t=zw_[A-Za-z0-9_-]{43}$/);
    expect(r.script).toContain(JSON.stringify(r.url));
    const token = new URL(r.url).searchParams.get("t")!;
    expect([...docs.m.keys()].some((k) => k.includes(token))).toBe(false);
    expect(docs.m.get(`widget_tokens/${hashDoToken(token)}`)).toMatchObject({ email: "dono@a.com", tenantId: null });
  });

  it("o código devolve só o placar (sem visitas, estoque nem lucro)", async () => {
    const { url } = await gerar();
    const r = await GET(req(url));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ dia: "2026-10-24", vendas: 100, pedidos: 2 });
    expect(JSON.stringify(j)).not.toMatch(/visitas|estoque|lucro|custo/);
    expect(calc.chamadas[0]).toEqual({ empresa: "raiz" });
  });

  it("gerar de novo revoga o anterior; revogar apaga", async () => {
    const a = await gerar(), b = await gerar();
    expect((await GET(req(a.url))).status).toBe(401);
    expect((await GET(req(b.url))).status).toBe(200);
    expect((await DELETE(req("https://app.test/api/widget/token", "DELETE"))).status).toBe(200);
    expect((await GET(req(b.url))).status).toBe(401);
  });

  it("recusa código torto, desconhecido e de quem saiu da equipe ou venceu", async () => {
    expect((await GET(req("https://app.test/api/widget/ao-vivo"))).status).toBe(401);
    expect((await GET(req("https://app.test/api/widget/ao-vivo?t=zw_curto"))).status).toBe(401);
    expect((await GET(req(`https://app.test/api/widget/ao-vivo?t=zw_${"a".repeat(43)}`))).status).toBe(401);
    const { url } = await gerar();
    docs.m.set("controleAcesso/dono@a.com", { email: "dono@a.com", expiraEm: 1 });
    expect((await GET(req(url))).status).toBe(401);
    docs.m.delete("controleAcesso/dono@a.com");
    expect((await GET(req(url))).status).toBe(401);
  });

  it("na empresa, confere o membro da empresa e calcula a empresa certa", async () => {
    sessao.atual = { email: "dono@a.com", tenantId: "t-a" };
    docs.m.set("tenants/t-a/members/dono@a.com", { email: "dono@a.com" });
    const { url } = await gerar();
    expect((await GET(req(url))).status).toBe(200);
    expect(calc.chamadas[0]).toEqual({ empresa: "t-a" });
    docs.m.delete("tenants/t-a/members/dono@a.com");
    expect((await GET(req(url))).status).toBe(401);
  });

  it("sem sessão não gera código", async () => {
    sessao.atual = null;
    expect((await POST(req("https://app.test/api/widget/token", "POST"))).status).toBe(401);
  });
});
