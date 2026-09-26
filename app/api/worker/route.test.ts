import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { varrerInbox } from "@/lib/ml/webhook-inbox";
import { varrerEntregasPendentes } from "@/lib/notification-dispatch";
import { registrarExecucaoDoCron } from "@/lib/cron-heartbeat";

/**
 * O worker frequente (S09): varre inbox do webhook e outbox de push, carimba a
 * execução. Dependências mockadas — o que as varreduras fazem tem teste próprio
 * contra o emulador; aqui é a orquestração da rota.
 */

vi.mock("@/lib/ml/webhook-inbox", () => ({ varrerInbox: vi.fn() }));
vi.mock("@/lib/notification-dispatch", () => ({ varrerEntregasPendentes: vi.fn() }));
vi.mock("@/lib/cron-heartbeat", () => ({ registrarExecucaoDoCron: vi.fn(async () => undefined) }));

const chamada = (auth?: string) => new Request("https://exemplo.com/api/worker", {
  headers: auth ? { authorization: auth } : {},
});

describe("/api/worker (S09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "segredo-de-teste";
    vi.mocked(varrerInbox).mockResolvedValue({ elegiveis: 1, feitos: 1, descartados: 0, falhas: 0, parouPorTempo: false });
    vi.mocked(varrerEntregasPendentes).mockResolvedValue({ reivindicadas: 2 } as never);
  });

  it("sem o segredo, 401 e nada é varrido", async () => {
    const r = await GET(chamada());
    expect(r.status).toBe(401);
    expect(await GET(chamada("Bearer errado")).then((x) => x.status)).toBe(401);
    expect(varrerInbox).not.toHaveBeenCalled();
    expect(varrerEntregasPendentes).not.toHaveBeenCalled();
  });

  it("varre o inbox ANTES do outbox — o push que sair do inbox é entregue na mesma chamada", async () => {
    const ordem: string[] = [];
    vi.mocked(varrerInbox).mockImplementation(async () => { ordem.push("inbox"); return { elegiveis: 0, feitos: 0, descartados: 0, falhas: 0, parouPorTempo: false }; });
    vi.mocked(varrerEntregasPendentes).mockImplementation(async () => { ordem.push("outbox"); return {} as never; });
    const r = await POST(chamada("Bearer segredo-de-teste"));
    expect(r.status).toBe(200);
    expect(ordem).toEqual(["inbox", "outbox"]);
  });

  it("carimba a execução no documento PRÓPRIO do worker, separado do cron diário", async () => {
    await GET(chamada("Bearer segredo-de-teste"));
    expect(registrarExecucaoDoCron).toHaveBeenCalledWith(expect.objectContaining({ inbox: expect.any(Object) }), "worker");
  });

  it("uma varredura falhando não impede a outra nem o carimbo; ok=false conta o que houve", async () => {
    vi.mocked(varrerInbox).mockRejectedValue(new Error("firestore fora"));
    const r = await GET(chamada("Bearer segredo-de-teste"));
    expect(r.status).toBe(200);
    expect(varrerEntregasPendentes).toHaveBeenCalled();
    expect(registrarExecucaoDoCron).toHaveBeenCalled();
    expect(await r.json()).toMatchObject({ ok: false, inbox: null });
  });
});
