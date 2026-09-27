import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AssinaturaInvalida,
  configDeCobranca,
  lerAssinatura,
  lerEvento,
  ProvedorStripe,
  verificarAssinaturaStripe,
  VERSAO_API_STRIPE,
} from "./provedor";

/**
 * Testes de CONTRATO com o formato do Stripe (S25). As fixtures em ./fixtures
 * são sintéticas, no formato documentado da API — nas duas versões que mudam
 * de lugar o período (item) e a assinatura da fatura (parent).
 */
const fixture = (n: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", n), "utf8"));
const SEGREDO = "whsec_segredo_de_teste";
const assinar = (corpo: string, t: number, segredo = SEGREDO) => `t=${t},v1=${createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex")}`;
const AGORA = 1_789_000_000_000;

describe("S25 — assinatura do webhook do Stripe", () => {
  const corpo = JSON.stringify(fixture("evento-checkout.json"));
  const t = AGORA / 1000;

  it("confere com o segredo certo, sobre o corpo bruto", () => {
    expect(() => verificarAssinaturaStripe(corpo, assinar(corpo, t), SEGREDO, AGORA)).not.toThrow();
  });

  it("recusa corpo alterado, segredo errado, cabeçalho ausente ou malformado", () => {
    expect(() => verificarAssinaturaStripe(corpo.replace("emp-a", "emp-x"), assinar(corpo, t), SEGREDO, AGORA)).toThrow(AssinaturaInvalida);
    expect(() => verificarAssinaturaStripe(corpo, assinar(corpo, t, "whsec_outro"), SEGREDO, AGORA)).toThrow(AssinaturaInvalida);
    expect(() => verificarAssinaturaStripe(corpo, null, SEGREDO, AGORA)).toThrow(AssinaturaInvalida);
    expect(() => verificarAssinaturaStripe(corpo, "v1=abc", SEGREDO, AGORA)).toThrow(AssinaturaInvalida);
  });

  it("recusa carimbo fora de 5 minutos (replay)", () => {
    expect(() => verificarAssinaturaStripe(corpo, assinar(corpo, t - 301), SEGREDO, AGORA)).toThrow(/tolerância/);
  });

  it("troca de segredo: vale se QUALQUER v1 conferir", () => {
    const dupla = `${assinar(corpo, t, "whsec_velho")},v1=${assinar(corpo, t).split("v1=")[1]}`;
    expect(() => verificarAssinaturaStripe(corpo, dupla, SEGREDO, AGORA)).not.toThrow();
  });
});

describe("S25 — leitura do formato do Stripe", () => {
  it("evento: acha a assinatura e a empresa no checkout, na fatura antiga e na fatura nova (parent)", () => {
    expect(lerEvento(fixture("evento-checkout.json"))).toEqual({ id: "evt_teste_checkout", tipo: "checkout.session.completed", criadoEm: 1_789_000_000_000, assinaturaId: "sub_teste_1", tenantId: "emp-a" });
    expect(lerEvento(fixture("evento-fatura-antiga.json"))).toMatchObject({ assinaturaId: "sub_teste_1", tenantId: null });
    expect(lerEvento(fixture("evento-fatura-basil.json"))).toMatchObject({ assinaturaId: "sub_teste_2", tenantId: "emp-b" });
    expect(lerEvento(fixture("evento-assinatura-apagada.json"))).toMatchObject({ assinaturaId: "sub_teste_1", tenantId: "emp-a" });
  });

  it("assinatura: período no topo (2024-06-20) e no item (versões novas); cliente como id ou objeto", () => {
    expect(lerAssinatura(fixture("assinatura-2024-06-20.json"))).toEqual({
      id: "sub_teste_1", clienteId: "cus_teste_1", status: "active", precoId: "price_teste_essencial",
      periodoFim: 1_790_000_000_000, cancelaNoFimDoPeriodo: false, canceladaEm: null, trialFim: null, tenantId: "emp-a",
    });
    expect(lerAssinatura(fixture("assinatura-2025-basil.json"))).toMatchObject({
      clienteId: "cus_teste_2", status: "past_due", precoId: "price_teste_profissional", periodoFim: 1_791_000_000_000, cancelaNoFimDoPeriodo: true,
    });
  });
});

describe("S25 — chamadas ao Stripe", () => {
  it("checkout: assinatura mensal, empresa na metadata, URLs vindas do servidor, versão da API fixada", async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_teste" }), { status: 200 }));
    const p = new ProvedorStripe("sk_test_x", SEGREDO, http as unknown as typeof fetch);
    const r = await p.criarCheckout({ tenantId: "emp-a", precoId: "price_ess", clienteId: null, email: "dono@a.com", urlSucesso: "https://app/?tab=acesso&cobranca=voltou", urlCancelar: "https://app/?tab=acesso&cobranca=cancelado" });
    expect(r.url).toContain("checkout.stripe.com");
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init.headers as Record<string, string>)["Stripe-Version"]).toBe(VERSAO_API_STRIPE);
    const f = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(f)).toMatchObject({
      mode: "subscription", "line_items[0][price]": "price_ess", client_reference_id: "emp-a",
      "subscription_data[metadata][tenantId]": "emp-a", customer_email: "dono@a.com", success_url: "https://app/?tab=acesso&cobranca=voltou",
    });
    expect(f.has("customer")).toBe(false);
  });

  it("erro do Stripe vira erro com o código, sem o corpo inteiro", async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ error: { code: "resource_missing", message: "No such price" } }), { status: 400 }));
    const p = new ProvedorStripe("sk_test_x", SEGREDO, http as unknown as typeof fetch);
    await expect(p.buscarAssinatura("sub_x")).rejects.toThrow("stripe 400: resource_missing");
  });

  it("chave de produção só com autorização explícita; sem chave, desligada", () => {
    expect(configDeCobranca({})).toEqual({ ligada: false, motivo: "sem_chave" });
    expect(configDeCobranca({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x" })).toEqual({ ligada: false, motivo: "chave_de_producao_nao_autorizada" });
    expect(configDeCobranca({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x", ZXP_COBRANCA_LIVE: "autorizado" }).ligada).toBe(true);
    expect(configDeCobranca({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }).ligada).toBe(true);
  });
});
