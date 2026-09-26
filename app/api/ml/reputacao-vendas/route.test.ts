import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { fetchOrdersLive } from "@/lib/ml/orders";
import { getMlAccessToken, getMlTokenData } from "../token";

/**
 * /api/ml/reputacao-vendas depois do S10: várias janelas numa busca, cache que
 * sabe de qual conexão é, e "Atualizar" que atravessa o cache. A busca no ML é
 * simulada — o que se prova aqui é a orquestração da rota.
 */

vi.mock("@/lib/api-auth", () => ({ requireAccess: vi.fn(async () => ({ email: "dono@zxp.com" })) }));
vi.mock("../token", () => ({ getMlAccessToken: vi.fn(async () => "token"), getMlTokenData: vi.fn() }));
vi.mock("@/lib/ml/orders", () => ({ fetchOrdersLive: vi.fn() }));

const pedido = (id: string, dia: string, status = "paid", envio = id) => ({
  order_id: id, status, shipping_id: envio, pack_id: null, total_amount: 100, date_created: `${dia}T12:00:00.000-03:00`,
});

let geracao = 1;
const chamar = (qs: string) => GET(new Request(`https://exemplo.com/api/ml/reputacao-vendas?${qs}`));
const BASE = "from=2026-06-01&to=2026-09-26";

beforeEach(() => {
  vi.clearAllMocks();
  geracao += 10; // cada teste numa geração própria: o cache do módulo não vaza entre testes
  vi.mocked(getMlTokenData).mockResolvedValue({ geracao } as never);
  vi.mocked(fetchOrdersLive).mockResolvedValue([
    pedido("1", "2026-06-10"),
    pedido("2", "2026-08-01"),
    pedido("3", "2026-09-20"),
    pedido("4", "2026-09-21", "cancelled"),
  ] as never);
});

describe("várias janelas numa busca só (S10)", () => {
  it("conta cada janela nomeada a partir da MESMA busca", async () => {
    const r = await chamar(`${BASE}&janela=medalha:2026-06-01:2026-09-26&janela=reputacao:2026-07-29:2026-09-26`);
    const j = await r.json();
    expect(fetchOrdersLive).toHaveBeenCalledTimes(1);
    expect(j.janelas.medalha.bloco).toMatchObject({ vendas: 4, concluidas: 3 });
    expect(j.janelas.reputacao.bloco).toMatchObject({ vendas: 3, concluidas: 2 });
    expect(j.fonte).toMatchObject({ status: "fresh", connectionGeneration: geracao, coverage: { from: "2026-06-01", to: "2026-09-26", complete: true } });
  });

  it("a forma antiga (subFrom/subTo) continua devolvendo `sub` — tela antiga em cache não fica sem o bloco", async () => {
    const j = await (await chamar(`${BASE}&subFrom=2026-07-29&subTo=2026-09-26`)).json();
    expect(j.sub.bloco).toMatchObject({ vendas: 3 });
  });

  it("janela fora do período buscado é recusada com 400 — sem buscar no ML", async () => {
    const r = await chamar(`${BASE}&janela=reputacao:2025-09-27:2026-09-26`);
    expect(r.status).toBe(400);
    expect(fetchOrdersLive).not.toHaveBeenCalled();
  });
});

describe("cache que sabe de qual conta é", () => {
  it("as duas janelas da aba não se expulsam: pedidos diferentes, cada um no seu lugar", async () => {
    await chamar(`${BASE}&janela=medalha:2026-06-01:2026-09-26`);
    await chamar(`from=2026-07-29&to=2026-09-26`);
    await chamar(`${BASE}&janela=medalha:2026-06-01:2026-09-26`);
    await chamar(`from=2026-07-29&to=2026-09-26`);
    expect(fetchOrdersLive).toHaveBeenCalledTimes(2); // o cache de UMA entrada faria 4
  });

  it("reconectar outra conta (geração nova) não serve o que era da anterior", async () => {
    await chamar(BASE);
    vi.mocked(getMlTokenData).mockResolvedValue({ geracao: geracao + 1 } as never);
    const j = await (await chamar(BASE)).json();
    expect(fetchOrdersLive).toHaveBeenCalledTimes(2);
    expect(j.cached).toBeUndefined();
  });

  it("fresh=1 (o 'Atualizar' da aba) busca de novo mesmo com cache válido", async () => {
    await chamar(BASE);
    expect((await (await chamar(BASE)).json()).cached).toBe(true);
    await chamar(`${BASE}&fresh=1`);
    expect(fetchOrdersLive).toHaveBeenCalledTimes(2);
  });
});

describe("erro nunca é zero", () => {
  it("ML não respondeu: bloco null e fonte 'unavailable' com o motivo", async () => {
    vi.mocked(fetchOrdersLive).mockResolvedValue(null);
    const j = await (await chamar(BASE)).json();
    expect(j.bloco).toBeNull();
    expect(j.fonte).toMatchObject({ status: "unavailable", errorCode: "pedidos_indisponiveis", lastSuccessAt: null });
  });

  it("sem token: idem, com o motivo certo", async () => {
    vi.mocked(getMlAccessToken).mockResolvedValueOnce(null);
    const j = await (await chamar(BASE)).json();
    expect(j.fonte).toMatchObject({ status: "unavailable", errorCode: "sem_token" });
  });

  it("vendeu nada é 'empty', diferente de indisponível", async () => {
    vi.mocked(fetchOrdersLive).mockResolvedValue([]);
    const j = await (await chamar(BASE)).json();
    expect(j.bloco).toMatchObject({ vendas: 0 });
    expect(j.fonte.status).toBe("empty");
  });
});

