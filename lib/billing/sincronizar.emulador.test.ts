import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

vi.mock("server-only", () => ({}));
const { aplicarAssinatura, processarEvento, reconciliarEmpresa } = await import("./sincronizar");
const { trialNovo } = await import("@/lib/domain/assinatura");
import type { AssinaturaDoProvedor } from "@/lib/domain/assinatura";
import type { EventoDoProvedor, ProvedorDeCobranca } from "./provedor";

/** S25 — do Stripe pra empresa, no emulador com dado sintético e um provedor falso. */

let db: Firestore;
const DIA = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
const env = { STRIPE_PRICE_ESSENCIAL: "price_ess", STRIPE_PRICE_PROFISSIONAL: "price_pro" };

/** O "Stripe": a assinatura como está AGORA. Cada busca devolve o estado atual. */
const noStripe = new Map<string, AssinaturaDoProvedor>();
const buscas: string[] = [];
const provedor: ProvedorDeCobranca = {
  criarCheckout: async () => ({ url: "" }),
  criarPortal: async () => ({ url: "" }),
  verificarEvento: () => { throw new Error("não usado"); },
  buscarAssinatura: async (id) => { buscas.push(id); const s = noStripe.get(id); if (!s) throw new Error("stripe 404"); return s; },
};
const sub = (p: Partial<AssinaturaDoProvedor>): AssinaturaDoProvedor => ({
  id: "sub_1", clienteId: "cus_1", status: "active", precoId: "price_ess", periodoFim: T0 + 30 * DIA,
  cancelaNoFimDoPeriodo: false, canceladaEm: null, trialFim: null, tenantId: "emp-a", ...p,
});
const evento = (id: string, tipo: string, p: Partial<EventoDoProvedor> = {}): EventoDoProvedor => ({ id, tipo, criadoEm: T0, assinaturaId: "sub_1", tenantId: "emp-a", ...p });

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "cobranca") ?? initializeApp({ projectId: "zxp-teste-cobranca" }, "cobranca");
  db = getFirestore(app);
});
afterAll(async () => { await db?.terminate(); });
beforeEach(async () => {
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
  noStripe.clear();
  buscas.length = 0;
  await db.doc("tenants/emp-a").set({ nome: "A", assinatura: trialNovo(T0) });
});

const empresa = async () => (await db.doc("tenants/emp-a").get()).data()!;

describe("S25 — webhook durável e idempotente", () => {
  it("checkout concluído: busca a assinatura e libera o plano; o mesmo evento de novo não reprocessa", async () => {
    noStripe.set("sub_1", sub({}));
    expect(await processarEvento(db, provedor, evento("evt_1", "checkout.session.completed"), { agora: T0 + DIA, env })).toBe("processado");
    expect((await empresa()).assinatura).toMatchObject({ plano: "essencial", estado: "ativa", clienteId: "cus_1", assinaturaId: "sub_1" });
    expect(await processarEvento(db, provedor, evento("evt_1", "checkout.session.completed"), { agora: T0 + DIA, env })).toBe("duplicado");
    expect(buscas).toEqual(["sub_1"]);
  });

  it("fora de ordem: o evento velho chega depois, mas o estado vem da busca — continua o atual", async () => {
    // No Stripe a assinatura já foi cancelada; o "updated" antigo (quando ainda estava ativa) chega por último.
    noStripe.set("sub_1", sub({ status: "canceled" }));
    await processarEvento(db, provedor, evento("evt_novo", "customer.subscription.deleted"), { agora: T0 + 2 * DIA, env });
    await processarEvento(db, provedor, evento("evt_velho", "customer.subscription.updated"), { agora: T0 + 3 * DIA, env });
    const e = await empresa();
    expect(e.assinatura.estado).toBe("cancelada");
    expect(e.bloqueio).toMatchObject({ motivo: "cancelada" });
  });

  it("leitura mais velha que a gravada não sobrescreve (duas entregas em paralelo)", async () => {
    await aplicarAssinatura(db, "emp-a", { plano: "essencial", estado: "ativa", sincronizadoEm: T0 + 10 }, T0);
    expect(await aplicarAssinatura(db, "emp-a", { plano: "essencial", estado: "cancelada", sincronizadoEm: T0 + 5 }, T0)).toBe("mais_velha");
    expect((await empresa()).assinatura.estado).toBe("ativa");
  });

  it("falha de cobrança bloqueia só depois da carência; pagar desbloqueia com tudo no lugar", async () => {
    await db.doc("tenants/emp-a/estoque/p1").set({ name: "Produto sintético" });
    noStripe.set("sub_1", sub({ status: "past_due" }));
    await processarEvento(db, provedor, evento("evt_f", "invoice.payment_failed"), { agora: T0, env });
    expect((await empresa()).bloqueio).toBeUndefined();
    await reconciliarEmpresa(db, provedor, "emp-a", { agora: T0 + 8 * DIA, env });
    expect((await empresa()).bloqueio).toMatchObject({ motivo: "inadimplente" });

    noStripe.set("sub_1", sub({ status: "active" }));
    await processarEvento(db, provedor, evento("evt_p", "invoice.paid"), { agora: T0 + 9 * DIA, env });
    expect((await empresa()).bloqueio).toBeUndefined();
    expect((await db.doc("tenants/emp-a/estoque/p1").get()).exists).toBe(true);
  });

  it("evento sem empresa (assinatura criada fora do app) e tipo irrelevante: 200 e nada muda", async () => {
    noStripe.set("sub_x", sub({ id: "sub_x", tenantId: null }));
    expect(await processarEvento(db, provedor, evento("evt_x", "customer.subscription.updated", { assinaturaId: "sub_x", tenantId: null }), { agora: T0, env })).toBe("ignorado");
    expect(await processarEvento(db, provedor, evento("evt_y", "charge.succeeded"), { agora: T0, env })).toBe("ignorado");
    expect((await empresa()).assinatura.estado).toBe("trial");
  });

  it("falha na busca: lança (a rota responde 500 e o Stripe reentrega) e a reentrega processa", async () => {
    await expect(processarEvento(db, provedor, evento("evt_z", "invoice.paid"), { agora: T0, env })).rejects.toThrow("stripe 404");
    noStripe.set("sub_1", sub({}));
    expect(await processarEvento(db, provedor, evento("evt_z", "invoice.paid"), { agora: T0, env })).toBe("processado");
  });
});

describe("S25 — reconciliação pelo relógio (sem Stripe)", () => {
  it("trial que venceu vira bloqueio; rodar de novo não muda nada", async () => {
    expect(await reconciliarEmpresa(db, null, "emp-a", { agora: T0 + 5 * DIA, env })).toBe("sem_mudanca");
    expect(await reconciliarEmpresa(db, null, "emp-a", { agora: T0 + 15 * DIA, env })).toBe("relogio");
    expect((await empresa()).bloqueio).toMatchObject({ motivo: "trial_encerrado" });
    expect(await reconciliarEmpresa(db, null, "emp-a", { agora: T0 + 16 * DIA, env })).toBe("sem_mudanca");
  });
});
