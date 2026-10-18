import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rota que leva a troca de SKU pro anúncio no ML, com o Mercado Livre
 * simulado por um `fetch` falso (nenhuma chamada real). O que se prova:
 * simular não escreve; aplicar manda o corpo certo (todas as variações),
 * relê e confere; só o dono aplica; erro do ML vira mensagem.
 */

vi.mock("@/lib/api-auth", () => ({ requireAccess: vi.fn() }));
vi.mock("../token", () => ({ getMlAccessToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/ml/vendedor", () => ({ sellerIdAtual: vi.fn(async () => "123") }));

const auditSet = vi.fn(async () => {});
const produtos: Record<string, Record<string, unknown>> = {
  limao: { name: "Limão Caipira", sku: "LimaoCaipira", mlbs: ["MLB111"] },
};
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (nome: string) => ({
      doc: (id: string) => nome === "estoque"
        ? { get: async () => ({ exists: id in produtos, data: () => produtos[id] }) }
        : { set: auditSet },
    }),
  }),
}));

const dono = { email: "dono@x.com", uid: "u", role: "owner", papel: "owner", permissoesEdicao: [], pode: () => true };
const parceiro = { ...dono, email: "p@x.com", role: "user", papel: "partner" };

type Item = { id: string; title: string; attributes?: { id: string; value_name: string }[]; variations?: { id: number; attributes: { id: string; value_name: string }[] }[] };
let anuncios: Record<string, Item>;
let busca: Record<string, string[]>;
let putStatus: number;
const chamadas: { metodo: string; url: string; corpo?: unknown }[] = [];
const sku = (v: string) => [{ id: "SELLER_SKU", value_name: v }];

beforeEach(async () => {
  vi.clearAllMocks();
  chamadas.length = 0;
  putStatus = 200;
  anuncios = {
    MLB111: { id: "MLB111", title: "Limão Full", attributes: sku("LimaoCaipira") },
    MLB222: { id: "MLB222", title: "Erva sabores", variations: [{ id: 1, attributes: sku("LimaoCaipira") }, { id: 2, attributes: sku("Menta") }] },
    MLB333: { id: "MLB333", title: "Outro produto", attributes: sku("Menta") },
  };
  busca = { "seller_sku=LimaoCaipira": ["MLB222"], "sku=LimaoCaipira": [] };

  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    chamadas.push({ metodo, url, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const busq = url.match(/items\/search\?(\w+=[^&]+)/);
    if (busq) return new Response(JSON.stringify({ results: busca[decodeURIComponent(busq[1])] ?? [] }), { status: 200 });
    const m = url.match(/items\/(MLB\d+)/);
    if (m && metodo === "GET") return anuncios[m[1]] ? new Response(JSON.stringify(anuncios[m[1]]), { status: 200 }) : new Response("{}", { status: 404 });
    if (m && metodo === "PUT") {
      if (putStatus !== 200) return new Response(JSON.stringify({ message: "forbidden" }), { status: putStatus });
      // O "ML" aplica: atributo do anúncio e das variações enviadas.
      const c = JSON.parse(String(init!.body)) as { attributes?: { id: string; value_name: string }[]; variations?: { id: number; attributes?: { id: string; value_name: string }[] }[] };
      const it = anuncios[m[1]];
      if (c.attributes) it.attributes = c.attributes;
      if (c.variations) it.variations = c.variations.map((v) => ({ id: v.id, attributes: v.attributes ?? it.variations!.find((x) => x.id === v.id)!.attributes }));
      return new Response(JSON.stringify(it), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

async function chamar(corpo: unknown, quem: unknown = dono) {
  const { requireAccess } = await import("@/lib/api-auth");
  vi.mocked(requireAccess).mockResolvedValue(quem as never);
  const { POST } = await import("./route");
  return POST(new Request("https://x/api/ml/sku", { method: "POST", body: JSON.stringify(corpo) }));
}
const pedido = { productId: "limao", skuAntigo: "LimaoCaipira", skuNovo: "LimaoCaipiraFull" };

describe("POST /api/ml/sku", () => {
  it("simular: acha os anúncios ligados e os do SKU antigo, e NÃO escreve nada", async () => {
    const res = await chamar({ modo: "simular", itens: [pedido] });
    expect(res.status).toBe(200);
    const j = await res.json();
    const acoes = Object.fromEntries(j.produtos[0].anuncios.map((a: { mlb: string; acao: string }) => [a.mlb, a.acao]));
    expect(acoes).toEqual({ MLB111: "alterar", MLB222: "alterar" });
    expect(chamadas.some((c) => c.metodo === "PUT")).toBe(false);
  });

  it("aplicar (dono): PUT com todas as variações, relê, confere e registra na auditoria", async () => {
    const res = await chamar({ modo: "aplicar", itens: [pedido] });
    const j = await res.json();
    expect(j.produtos[0].anuncios.map((a: { resultado: string }) => a.resultado)).toEqual(["ok", "ok"]);
    const putVar = chamadas.find((c) => c.metodo === "PUT" && c.url.endsWith("MLB222"));
    expect(putVar?.corpo).toEqual({ variations: [{ id: 1, attributes: sku("LimaoCaipiraFull") }, { id: 2 }] });
    expect(anuncios.MLB222.variations?.map((v) => v.attributes[0].value_name)).toEqual(["LimaoCaipiraFull", "Menta"]);
    expect(anuncios.MLB111.attributes?.[0].value_name).toBe("LimaoCaipiraFull");
    expect(anuncios.MLB333.attributes?.[0].value_name).toBe("Menta"); // o de outro produto nem é tocado
    expect(auditSet).toHaveBeenCalledTimes(2);
  });

  it("aplicar: só o dono", async () => {
    const res = await chamar({ modo: "aplicar", itens: [pedido] }, parceiro);
    expect(res.status).toBe(403);
    expect(chamadas.some((c) => c.metodo === "PUT")).toBe(false);
  });

  it("parceiro pode simular", async () => {
    expect((await chamar({ modo: "simular", itens: [pedido] }, parceiro)).status).toBe(200);
  });

  it("anúncio ligado com SKU de OUTRO produto fica de fora", async () => {
    produtos.limao.mlbs = ["MLB111", "MLB333"];
    const j = await (await chamar({ modo: "aplicar", itens: [pedido] })).json();
    const m333 = j.produtos[0].anuncios.find((a: { mlb: string }) => a.mlb === "MLB333");
    expect(m333.acao).toBe("nao-mexer");
    expect(chamadas.some((c) => c.metodo === "PUT" && c.url.endsWith("MLB333"))).toBe(false);
    produtos.limao.mlbs = ["MLB111"];
  });

  it("ML recusa (403): a linha diz por quê, sem fingir que deu certo", async () => {
    putStatus = 403;
    const j = await (await chamar({ modo: "aplicar", itens: [pedido] })).json();
    const a = j.produtos[0].anuncios[0];
    expect(a.resultado).toBe("erro");
    expect(a.erro).toMatch(/permissão de escrita/);
    expect(auditSet).not.toHaveBeenCalled();
  });

  it("pedido vazio ou sem corpo: 400", async () => {
    expect((await chamar({ modo: "simular", itens: [] })).status).toBe(400);
  });
});
