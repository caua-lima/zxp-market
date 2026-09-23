import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Achado S15 da auditoria SaaS: o backup semanal tinha uma lista de
 * coleções mantida À MÃO (7, hardcoded) que ficou pra trás do inventário
 * (lib/domain/backup-inventario.ts) sem ninguém notar — metas,
 * controleAcessoMeta, ads_alteracoes, auditLog, dias, rascunho,
 * alertasDispensados e usuarios estavam classificadas como irrecuperáveis
 * mas sem cópia semanal nenhuma. Agora `fazerBackupSemanal` deriva a lista
 * do MESMO inventário que `scripts/backup-firestore.mjs` já usa — este
 * teste prova que a derivação cobre tudo, não só os 7 de antes.
 */

const getMock = vi.fn(async () => ({ docs: [], size: 0 }));
const collectionCalls: string[] = [];
function fakeCollection(nome: string) {
  collectionCalls.push(nome);
  return {
    get: getMock,
    doc: (id: string) => ({
      collection: (sub: string) => fakeCollection(`${nome}/${id}/${sub}`),
    }),
  };
}
const marcadorGetMock = vi.fn(async () => ({ exists: false }));
const marcadorSetMock = vi.fn(async () => undefined);
const batchCommitMock = vi.fn(async () => undefined);
const batchSetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (nome: string) => {
      if (nome === "backups_semanais") {
        return {
          doc: () => ({
            get: marcadorGetMock,
            set: marcadorSetMock,
            collection: (sub: string) => fakeCollection(sub),
          }),
        };
      }
      return fakeCollection(nome);
    },
    batch: () => ({ set: batchSetMock, commit: batchCommitMock }),
  }),
}));

describe("fazerBackupSemanal — S15", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectionCalls.length = 0;
  });

  it("cobre TODAS as coleções que colecoesParaBackup() lista, nao so as 7 antigas", async () => {
    const { colecoesParaBackup } = await import("@/lib/domain/backup-inventario");
    const esperadas = colecoesParaBackup();
    // O achado original: essas 8 estavam classificadas como irrecuperaveis
    // mas fora da lista hardcoded de 7.
    for (const c of ["metas", "controleAcessoMeta", "ads_alteracoes", "auditLog", "dias", "rascunho", "alertasDispensados", "usuarios"]) {
      expect(esperadas, `${c} deveria estar em colecoesParaBackup()`).toContain(c);
    }

    const { fazerBackupSemanal } = await import("./backup-run");
    await fazerBackupSemanal();

    for (const c of esperadas) {
      expect(collectionCalls, `backup nao tocou em ${c}`).toContain(c);
    }
  });

  it("nunca inclui coleção efêmera nem ml_orders/ml_returns (resincronizáveis do ML)", async () => {
    const { fazerBackupSemanal } = await import("./backup-run");
    await fazerBackupSemanal();

    for (const c of ["notification_events", "notification_outbox", "pushTokens", "ml_oauth_transacoes", "ml_orders", "ml_returns"]) {
      expect(collectionCalls).not.toContain(c);
    }
  });

  it("marcador ja existe hoje: nao refaz o trabalho (idempotência preservada)", async () => {
    marcadorGetMock.mockResolvedValueOnce({ exists: true });
    const { fazerBackupSemanal } = await import("./backup-run");
    const r = await fazerBackupSemanal();
    expect(r.feito).toBe(false);
    expect(collectionCalls).toEqual([]);
  });
});
