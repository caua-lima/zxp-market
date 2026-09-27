import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const gravados: Record<string, unknown>[] = [];
let auditoriaFalha = false;
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (c: string) => ({
      add: async (d: Record<string, unknown>) => {
        if (auditoriaFalha) throw new Error("firestore fora");
        gravados.push({ c, ...d });
      },
    }),
  }),
}));
let negar = false;
vi.mock("@/lib/api-auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAccess: async () => (negar ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : { uid: "u1", email: "dono@exemplo.com" }),
  };
});

const { rotaDeDiagnostico } = await import("./diagnostico");

beforeEach(() => { gravados.length = 0; auditoriaFalha = false; negar = false; });

describe("S27 — rota de diagnóstico: escopo, auditoria e sem dado pessoal", () => {
  const resposta = { status: 200, body: { id: 9, receiver_address: { street_name: "Rua X", zip_code: "01000" }, buyer: { first_name: "Ana", phone: "11" }, list_cost: 21.5, tokenPreview: "APP_USR-123" } };

  it("abre só pra quem administra; recusado nem audita nem executa", async () => {
    negar = true;
    const fn = vi.fn();
    const r = await rotaDeDiagnostico("debug-x", fn)(new Request("http://x"));
    expect(r.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
    expect(gravados).toEqual([]);
  });

  it("registra quem abriu ANTES de rodar, e responde sem os campos pessoais", async () => {
    const r = await rotaDeDiagnostico("debug-x", async () => ({ corpo: resposta }))(new Request("http://x"));
    expect(gravados).toEqual([expect.objectContaining({ c: "acessos_diagnostico", rota: "debug-x", uid: "u1", email: "dono@exemplo.com" })]);
    expect(await r.json()).toEqual({ status: 200, body: { id: 9, receiver_address: "[redigido]", buyer: { first_name: "[redigido]", phone: "[redigido]" }, list_cost: 21.5, tokenPreview: "[redigido]" } });
  });

  it("sem trilha, sem diagnóstico: auditoria falhou → 503 e a rota não roda", async () => {
    auditoriaFalha = true;
    const fn = vi.fn();
    const r = await rotaDeDiagnostico("debug-x", fn)(new Request("http://x"));
    expect(r.status).toBe(503);
    expect(fn).not.toHaveBeenCalled();
  });
});
