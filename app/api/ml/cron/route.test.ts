import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { getMlAccessToken } from "../token";
import { syncClaimsRange, syncOrdersRange, syncReturnsRange } from "@/lib/ml/sync";
import { ehDomingoBR, fazerBackupSemanal } from "@/lib/backup-run";
import { enviarLembretesDeTarefa } from "@/lib/task-reminders-run";
import { verificarEstoqueBaixo } from "@/lib/estoque-alerta-run";
import { verificarDevolucoes } from "@/lib/devolucoes-run";
import { varrerEntregasPendentes } from "@/lib/notification-dispatch";
import { varrerInbox } from "@/lib/ml/webhook-inbox";
import { registrarExecucaoDoCron } from "@/lib/cron-heartbeat";
import { etapaOk, etapaParcial } from "@/lib/domain/sync-resultado";

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
 *
 * ─── IMPORT ESTÁTICO, SEM resetModules ───────────────────────────────────
 *
 * A primeira versão fazia `vi.resetModules()` e `await import("./route")`
 * DENTRO de cada teste. A rota puxa `lib/api-auth` → `firebase-admin` de
 * verdade, e reavaliar isso a cada teste custava segundos — sob a carga da
 * suíte inteira, estourava os 5 s de timeout (5 vezes seguidas, sempre na
 * suíte e nunca isolado). Importado uma vez no topo, o custo vai pra coleta
 * do arquivo, fora do relógio de cada teste; os `vi.mock` abaixo são içados
 * pelo vitest pra antes desses imports.
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
vi.mock("@/lib/ml/webhook-inbox", () => ({
  varrerInbox: vi.fn(async () => ({ elegiveis: 0 })),
  podarInbox: vi.fn(async () => ({ apagados: 0 })),
}));

const requisicao = () => new Request("https://exemplo.com/api/ml/cron", {
  headers: { authorization: "Bearer segredo-de-teste" },
});

describe("GET /api/ml/cron (S08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sem resetModules, o que um teste configura sobrevive pro seguinte: cada
    // um parte do mesmo ponto conhecido.
    vi.mocked(ehDomingoBR).mockReturnValue(false);
    vi.mocked(syncOrdersRange).mockReset();
    vi.mocked(syncReturnsRange).mockReset();
    vi.mocked(syncClaimsRange).mockReset();
    process.env.CRON_SECRET = "segredo-de-teste";
  });

  it("sem token ML, roda backup/lembrete/marcos/estoque/devolucao/outbox mesmo assim, e NAO responde 400", async () => {
    vi.mocked(getMlAccessToken).mockResolvedValue(null);
    vi.mocked(ehDomingoBR).mockReturnValue(true);

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
    // S07: o inbox do webhook também é varrido sem token — cada item pede o
    // seu ao processar, e o que falhar fica agendado pra nova tentativa.
    expect(varrerInbox).toHaveBeenCalled();
    expect(registrarExecucaoDoCron).toHaveBeenCalled();
  });

  it("etapasIncompletas nomeia a etapa CERTA quando uma falha ANTES dela na lista (sem desalinhar o indice)", async () => {
    vi.mocked(getMlAccessToken).mockResolvedValue("token-valido");
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

    const res = await GET(requisicao());
    const body = await res.json();

    // Sem o bug: "returns/atual" é a incompleta. Com o bug (indice desalinhado
    // apos filtrar a falha de orders/atual), viraria "claims/atual".
    expect(body.etapasIncompletas).toEqual(["returns/atual"]);
  });
});
