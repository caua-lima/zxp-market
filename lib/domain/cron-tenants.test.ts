import { describe, expect, it } from "vitest";
import { cabeMaisUm, licencaPermiteSync, MARGEM_SEGURANCA_MS, planejarSync } from "./cron-tenants";

const AGORA = Date.parse("2026-08-22T12:00:00.000Z");
const DIA = 86400000;

describe("licencaPermiteSync — não gastar API por quem não consegue entrar", () => {
  it("licença sem prazo roda", () => {
    expect(licencaPermiteSync({ status: "ativo", expiresAt: null }, AGORA)).toEqual({ roda: true });
  });

  it("licença com prazo no futuro roda", () => {
    expect(licencaPermiteSync({ status: "ativo", expiresAt: AGORA + DIA }, AGORA).roda).toBe(true);
  });

  it("licença vencida NÃO roda, e diz desde quando", () => {
    const r = licencaPermiteSync({ status: "ativo", expiresAt: AGORA - DIA }, AGORA);
    expect(r.roda).toBe(false);
    if (!r.roda) expect(r.motivo).toMatch(/vencida/);
  });

  it("vencimento exatamente agora já conta como vencida", () => {
    expect(licencaPermiteSync({ expiresAt: AGORA }, AGORA).roda).toBe(false);
  });

  it("suspensa não roda, mesmo sem prazo", () => {
    const r = licencaPermiteSync({ status: "suspenso", expiresAt: null }, AGORA);
    expect(r.roda).toBe(false);
    if (!r.roda) expect(r.motivo).toMatch(/suspensa/);
  });

  it("status ausente conta como ativo — compatibilidade com doc antigo", () => {
    expect(licencaPermiteSync({ expiresAt: null }, AGORA).roda).toBe(true);
  });

  it("sem licença nenhuma não roda — tenant da migração, não cliente", () => {
    const r = licencaPermiteSync(null, AGORA);
    expect(r.roda).toBe(false);
    if (!r.roda) expect(r.motivo).toMatch(/sem licença/);
  });

  it("status com caixa/espaço diferentes ainda é reconhecido", () => {
    expect(licencaPermiteSync({ status: " SUSPENSO " }, AGORA).roda).toBe(false);
  });
});

describe("cabeMaisUm — parar por orçamento em vez de morrer no meio", () => {
  it("no começo, cabe", () => {
    expect(cabeMaisUm(0, 0, 60_000)).toBe(true);
  });

  it("com menos que a margem sobrando, NÃO cabe", () => {
    // Começar e ser cortado deixa escrita parcial e nenhum registro.
    expect(cabeMaisUm(0, 60_000 - MARGEM_SEGURANCA_MS, 60_000)).toBe(false);
  });

  it("logo antes da margem ainda cabe", () => {
    expect(cabeMaisUm(0, 60_000 - MARGEM_SEGURANCA_MS - 1, 60_000)).toBe(true);
  });

  it("estourado não cabe", () => {
    expect(cabeMaisUm(0, 70_000, 60_000)).toBe(false);
  });
});

describe("planejarSync — quem roda, em que ordem, e quem fica de fora", () => {
  const t = (id: string, lic: { status?: string; expiresAt?: number | null } | null = { status: "ativo", expiresAt: null }) =>
    ({ tenantId: id, email: `${id}@x.com`, licenca: lic });

  it("só os de licença boa entram, e o resto é explicado", () => {
    const p = planejarSync([t("a"), t("b", { status: "suspenso" }), t("c", null)], AGORA);
    expect(p.rodar.map((x) => x.tenantId)).toEqual(["a"]);
    expect(p.pulados).toEqual([
      { tenantId: "b", motivo: "licença suspensa" },
      { tenantId: "c", motivo: "sem licença" },
    ]);
  });

  it("ordem é estável (por id) — o Firestore não garante ordem", () => {
    const p = planejarSync([t("c"), t("a"), t("b")], AGORA);
    expect(p.rodar.map((x) => x.tenantId)).toEqual(["a", "b", "c"]);
  });

  it("RODÍZIO: começa pelo seguinte ao último atendido", () => {
    // Sem isto, quando o tempo acaba são sempre os mesmos do fim que ficam
    // sem sincronizar — pra eles o cron nunca existiu.
    const p = planejarSync([t("a"), t("b"), t("c")], AGORA, "a");
    expect(p.rodar.map((x) => x.tenantId)).toEqual(["b", "c", "a"]);
  });

  it("rodízio a partir do último da lista volta pro começo", () => {
    const p = planejarSync([t("a"), t("b"), t("c")], AGORA, "c");
    expect(p.rodar.map((x) => x.tenantId)).toEqual(["a", "b", "c"]);
  });

  it("último desconhecido (saiu ou venceu) recomeça do topo", () => {
    const p = planejarSync([t("a"), t("b")], AGORA, "sumiu");
    expect(p.rodar.map((x) => x.tenantId)).toEqual(["a", "b"]);
  });

  it("o rodízio não perde nem duplica ninguém", () => {
    const ids = ["a", "b", "c", "d"];
    const p = planejarSync(ids.map((i) => t(i)), AGORA, "b");
    expect([...p.rodar.map((x) => x.tenantId)].sort()).toEqual(ids);
    expect(new Set(p.rodar.map((x) => x.tenantId)).size).toBe(4);
  });

  it("lista vazia não quebra", () => {
    expect(planejarSync([], AGORA)).toEqual({ rodar: [], pulados: [] });
  });

  it("todos inelegíveis: roda vazio, e ninguém some sem motivo", () => {
    const p = planejarSync([t("a", null), t("b", { status: "suspenso" })], AGORA, "a");
    expect(p.rodar).toEqual([]);
    expect(p.pulados).toHaveLength(2);
  });
});
