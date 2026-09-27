import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));
const processarEvento = vi.fn();
vi.mock("@/lib/billing/sincronizar", () => ({ processarEvento: (...a: unknown[]) => processarEvento(...a) }));

const { POST } = await import("./route");

const SEGREDO = "whsec_teste_rota";
const corpo = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1, data: { object: { object: "invoice", subscription: "sub_1" } } });
const req = (assinatura: string | null, texto = corpo) =>
  new Request("http://x/api/billing/webhook", { method: "POST", body: texto, headers: assinatura ? { "stripe-signature": assinatura } : {} });
const assinar = (texto: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SEGREDO).update(`${t}.${texto}`).digest("hex")}`;
};

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_rota";
  process.env.STRIPE_WEBHOOK_SECRET = SEGREDO;
  processarEvento.mockReset();
});
afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("S25 — rota do webhook de cobrança", () => {
  it("sem chaves do Stripe: 503 e nada processado", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect((await POST(req(assinar(corpo)))).status).toBe(503);
    expect(processarEvento).not.toHaveBeenCalled();
  });

  it("assinatura inválida ou ausente: 400 (o Stripe não reentrega) e nada processado", async () => {
    expect((await POST(req(null))).status).toBe(400);
    expect((await POST(req(assinar(corpo), corpo.replace("sub_1", "sub_2")))).status).toBe(400);
    expect(processarEvento).not.toHaveBeenCalled();
  });

  it("válida: processa o evento lido do corpo BRUTO e responde 200", async () => {
    processarEvento.mockResolvedValue("processado");
    const r = await POST(req(assinar(corpo)));
    expect(r.status).toBe(200);
    expect(processarEvento.mock.calls[0][2]).toMatchObject({ id: "evt_1", tipo: "invoice.paid", assinaturaId: "sub_1" });
  });

  it("falhou processando: 500 pra o Stripe reentregar", async () => {
    processarEvento.mockRejectedValue(new Error("stripe 503"));
    expect((await POST(req(assinar(corpo)))).status).toBe(500);
  });
});
