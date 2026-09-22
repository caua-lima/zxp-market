import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Achado S08 da auditoria SaaS: dois bugs no cron.
 *
 *  1. Sem token ML, a rota respondia 400 ANTES de rodar lembrete de tarefa,
 *     backup semanal, marcos, alerta de estoque, aviso de devolução e a
 *     varredura do outbox de push — nenhum deles depende do token.
 *  2. `syncIncompletas` indexava `nomes[i]` depois de filtrar `valores`: a
 *     primeira falha desalinhava o índice e a etapa seguinte herdava o nome
 *     errado.
 *
 * Mocka todas as dependências pra isolar só a orquestração da rota.
 */

vi.mock("../token", () => ({ getMlAccessToken: vi.fn() }));
vi.mock("@/lib/ml/sync", () => ({
  currentMonthRangeBR: () => ({ from: "2026-09-01", to: "2026-09-22" }),
  previousMonthRangeBR: () => ({ from: "2026-08-01", to: "2026-08-31" }),
  syncOrdersRange: vi.fn(),
  syncReturnsRange: vi.fn(),
  syncClaimsRange: vi.fn(),
}));
vi.mock("@/lib/task-reminders-run", () => ({ enviarLembretesDeTarefa: vi.fn(async () => ({ enviados: 0 })) }));
vi.mock("@/lib/backup-run", () => ({ ehDomingoBR: vi.fn(() => false), fazerBackupSemanal: vi.fn(async () => ({ feito: true })) }));
vi.mock("@/lib/marcos-gatilho", () => ({ dispararMarcos: vi.fn(async () => ({ faturamento: [], dia: [], recordes: [], reputacao: null })) }));
vi.mock("@/lib/devolucoes-run", () => ({ verificarDevolucoes: vi.fn(async () => ({ avisados: [] })) }));
vi.mock("@/lib/estoque-alerta-run", () => ({ verificarEstoqueBaixo: vi.fn(async () => ({ avisados: [] })) }));
vi.mock("@/lib/webhook-log-prune", () => ({ podarWebhookLog: vi.fn(async () => ({ apagados: 0 })) }));
vi.mock("@/lib/cron-heartbeat", () => ({ registrarExecucaoDoCron: vi.fn(async () => undefined) }));
vi.mock("@/lib/notification-dispatch", () => ({ varrerEntregasPendentes: vi.fn(async () => ({ processadas: 0 })) }));

const requisicao = () => new Request("https://exemplo.com/api/ml/cron", {
  headers: { authorization: "Bearer segredo-de-teste" },
});

describe("GET /api/ml/cron (S08)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "segredo-de-teste";
  });

  it("sem token ML, roda backup/lembrete/marcos/estoque/devolucao/outbox mesmo assim, e NAO responde 400", async () => {
    const { getMlAccessToken } = await import("../token");
    vi.mocked(getMlAccessToken).mockResolvedValue(null);
    const { fazerBackupSemanal, ehDomingoBR } = await import("@/lib/backup-run");
    vi.mocked(ehDomingoBR).mockReturnValue(true);
    const { enviarLembretesDeTarefa } = await import("@/lib/task-reminders-run");
    const { verificarEstoqueBaixo } = await import("@/lib/estoque-alerta-run");
    const { verificarDevolucoes } = await import("@/lib/devolucoes-run");
    const { varrerEntregasPendentes } = await import("@/lib/notification-dispatch");
    const { registrarExecucaoDoCron } = await import("@/lib/cron-heartbeat");

    const { GET } = await import("./route");
    const res = await GET(requisicao());

    expect(res.status).not.toBe(400);
    const body = await res.json();
    expect(body.sincronizacaoCompleta).toBe(false);
    expect(body.syncFalhas).toBeDefined();
    expect(body.syncFalhas.every((s: string) => s.includes("Token ML"))).toBe(true);

    expect(enviarLembretesDeTarefa).toHaveBeenCalled();
    expect(fazerBackupSemanal).toHaveBeenCalled();
    expect(verificarEstoqueBaixo).toHaveBeenCalled();
    expect(verificarDevolucoes).toHaveBeenCalled();
    expect(varrerEntregasPendentes).toHaveBeenCalled();
    expect(registrarExecucaoDoCron).toHaveBeenCalled();
  });

  it("etapasIncompletas nomeia a etapa CERTA quando uma falha ANTES dela na lista (sem desalinhar o indice)", async () => {
    const { getMlAccessToken } = await import("../token");
    vi.mocked(getMlAccessToken).mockResolvedValue("token-valido");
    const { syncOrdersRange, syncReturnsRange, syncClaimsRange } = await import("@/lib/ml/sync");
    const { etapaOk, etapaParcial } = await import("@/lib/domain/sync-resultado");
    const completo = etapaOk("pedidos", 1);
    const incompleto = etapaParcial("devolucoes", 1, null, new Error("truncado"));
    // Ordem: orders/atual (falha), returns/atual (INCOMPLETO), claims/atual, orders/anterior, returns/anterior, claims/anterior.
    vi.mocked(syncOrdersRange)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(completo);
    vi.mocked(syncReturnsRange)
      .mockResolvedValueOnce(incompleto)
      .mockResolvedValueOnce(completo);
    vi.mocked(syncClaimsRange)
      .mockResolvedValueOnce(completo)
      .mockResolvedValueOnce(completo);

    const { GET } = await import("./route");
    const res = await GET(requisicao());
    const body = await res.json();

    // Sem o bug: "returns/atual" é a incompleta. Com o bug (indice desalinhado
    // apos filtrar a falha de orders/atual), viraria "claims/atual".
    expect(body.etapasIncompletas).toEqual(["returns/atual"]);
  });
});
