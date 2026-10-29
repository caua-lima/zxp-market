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
    update: async (v: Record<string, unknown>) => { docs.m.set(path, { ...(docs.m.get(path) ?? {}), ...v }); },
  });
  return {
    getAdminDb: () => ({
      doc: (p: string) => ref(p),
      collection: (c: string) => ({
        doc: (id: string) => ref(`${c}/${id}`),
        where: (campo: string, _op: string, valor: unknown) => ({
          limit: () => ({ get: async () => ({ docs: [...docs.m.entries()].filter(([k, v]) => k.startsWith(`${c}/`) && v[campo] === valor).map(([k, v]) => ({ id: k.split('/')[1], ref: ref(k), get: (f: string) => v[f] })) }) }),
          get: async () => ({ docs: [...docs.m.entries()].filter(([k, v]) => k.startsWith(`${c}/`) && v[campo] === valor).map(([k, v]) => ({ ref: ref(k), get: (f: string) => v[f] })) }),
        }),
      }),
    }),
  };
});
vi.mock("server-only", () => ({}));
const avisosVigia = vi.hoisted(() => ({ lista: [] as string[] }));
vi.mock("@/lib/ml/vigia-agenda-full", () => ({
  vigiarAgendasFull: vi.fn(async () => null),
  COLECAO_VIGIAS: "full_agenda_vigias",
  avisarAgendaLiberada: vi.fn(async (id: string) => { avisosVigia.lista.push(id); return 1; }),
}));
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
const { GET: listar, POST: contar } = await import("./vigias/route");
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

describe("vigia pela extensão do Chrome (/api/widget/vigias)", () => {
  const gerarVigia = async () => (await (await POST(req("https://app.test/api/widget/token?uso=vigia", "POST"))).json()) as { url: string; script?: string };
  const postar = (url: string, corpo: unknown) => contar(new Request(url, { method: "POST", body: JSON.stringify(corpo) }));

  it("código da vigia não revoga o do painel; a extensão só precisa do endereço", async () => {
    const painel = await gerar();
    const vigia = await gerarVigia();
    expect(vigia.url).toContain("/api/widget/vigias?t=zw_");
    expect(vigia.script).toBeUndefined();
    expect((await GET(req(painel.url))).status).toBe(200);
  });

  it("lista só os envios vigiados ativos", async () => {
    docs.m.set("full_agenda_vigias/80517703", { inboundId: "80517703", ativa: true });
    docs.m.set("full_agenda_vigias/90000001", { inboundId: "90000001", ativa: false });
    const { url } = await gerarVigia();
    expect(await (await listar(req(url))).json()).toEqual({ ids: ["80517703"] });
  });

  it("iPhone viu data: avisa UMA vez; fechou e abriu de novo: avisa de novo", async () => {
    avisosVigia.lista.length = 0;
    docs.m.set("full_agenda_vigias/80517703", { inboundId: "80517703", ativa: true });
    const { url } = await gerarVigia();
    expect((await postar(url, { inboundId: "80517703", estado: "datas" })).status).toBe(200);
    await postar(url, { inboundId: "80517703", estado: "datas" });
    expect(avisosVigia.lista).toEqual(["80517703"]);
    expect(docs.m.get("full_agenda_vigias/80517703")).toMatchObject({ estado: "datas_liberadas", avisadoDatas: "iphone" });
    await postar(url, { inboundId: "80517703", estado: "sem_datas" });
    await postar(url, { inboundId: "80517703", estado: "datas" });
    expect(avisosVigia.lista).toHaveLength(2);
  });

  it("recusa código torto, envio não vigiado e estado inventado", async () => {
    expect((await listar(req("https://app.test/api/widget/vigias?t=zw_curto"))).status).toBe(401);
    const { url } = await gerarVigia();
    expect((await postar(url, { inboundId: "123456", estado: "datas" })).status).toBe(404);
    expect((await postar(url, { inboundId: "80517703", estado: "hackeado" })).status).toBe(400);
  });
});
