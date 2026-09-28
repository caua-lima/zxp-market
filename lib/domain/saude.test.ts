import { describe, expect, it } from "vitest";
import { avaliarSaude, diasAte, nivelGeral, type SinaisDeSaude } from "./saude";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 27, 15);
const bom: SinaisDeSaude = { agora: T0, cronEm: T0 - 5 * H, workerEm: T0 - 0.1 * H, mlConectado: true, inboxPendentes: 0, inboxFalhas: 0, entregasPendentes: 0, ml429: 0, ml5xx: 0, mlTimeouts: 0, bloqueada: false };
const nivel = (s: Partial<SinaisDeSaude>, id: string) => avaliarSaude({ ...bom, ...s }).find((i) => i.id === id)?.nivel;

describe("Etapa 4 — saúde por empresa", () => {
  it("tudo em dia: ok geral", () => {
    expect(nivelGeral(avaliarSaude(bom))).toBe("ok");
  });

  it("cron: atraso depois de 26 h, falha depois de 50 h; nunca rodou é atenção", () => {
    expect(nivel({ cronEm: T0 - 27 * H }, "cron")).toBe("atencao");
    expect(nivel({ cronEm: T0 - 51 * H }, "cron")).toBe("falha");
    expect(nivel({ cronEm: null }, "cron")).toBe("atencao");
  });

  it("worker parado 3 h é falha — e o texto aponta o segredo do GitHub quando nunca rodou", () => {
    expect(nivel({ workerEm: T0 - 4 * H }, "worker")).toBe("falha");
    expect(avaliarSaude({ ...bom, workerEm: null }).find((i) => i.id === "worker")?.texto).toContain("CRON_SECRET");
  });

  it("notificação desistida é falha; ML desconectado é falha; limite de uso do ML acumulado vira alerta", () => {
    expect(nivel({ inboxFalhas: 1 }, "inbox")).toBe("falha");
    expect(nivel({ mlConectado: false }, "ml")).toBe("falha");
    expect(nivel({ ml429: 60 }, "ml_api")).toBe("atencao");
    expect(nivel({ ml5xx: 250 }, "ml_api")).toBe("falha");
  });

  it("empresa bloqueada aparece como falha (as rotinas dela estão paradas)", () => {
    expect(nivelGeral(avaliarSaude({ ...bom, bloqueada: true }))).toBe("falha");
  });

  it("dias no fuso de Brasília (meia-noite UTC ainda é o dia anterior aqui)", () => {
    expect(diasAte(Date.UTC(2026, 8, 28, 1), 2)).toEqual(["2026-09-27", "2026-09-26"]);
  });
});
