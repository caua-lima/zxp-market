import { createHmac, timingSafeEqual } from "node:crypto";
import type { AssinaturaDoProvedor } from "@/lib/domain/assinatura";

/**
 * O fornecedor de cobrança por trás de uma interface (S25, ADR 0004).
 *
 * Um provedor só (Stripe), mas o app fala com `ProvedorDeCobranca`: os testes
 * usam um falso, e trocar de fornecedor não espalha mudança pelo app.
 */
export interface ProvedorDeCobranca {
  criarCheckout(p: {
    tenantId: string;
    precoId: string;
    clienteId: string | null;
    email: string;
    urlSucesso: string;
    urlCancelar: string;
  }): Promise<{ url: string }>;
  criarPortal(p: { clienteId: string; urlRetorno: string }): Promise<{ url: string }>;
  buscarAssinatura(id: string): Promise<AssinaturaDoProvedor>;
  /** Confere a assinatura do webhook sobre o corpo BRUTO. Lança se não conferir. */
  verificarEvento(corpoBruto: string, cabecalho: string | null, agora?: number): EventoDoProvedor;
}

export type EventoDoProvedor = {
  id: string;
  tipo: string;
  criadoEm: number;
  /** A assinatura que o evento cita, se citar (direto, via checkout ou via fatura). */
  assinaturaId: string | null;
  /** A empresa, quando o evento carrega (checkout: client_reference_id; assinatura: metadata). */
  tenantId: string | null;
};

export class AssinaturaInvalida extends Error {}

/** Tolerância do carimbo do Stripe (a mesma da biblioteca oficial): 5 minutos. */
const TOLERANCIA_S = 300;

/**
 * `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`. O assinado é `${t}.${corpo}`
 * com HMAC-SHA256 do segredo do endpoint. Mais de um v1 aparece na troca de
 * segredo; vale se qualquer um conferir.
 */
export function verificarAssinaturaStripe(corpoBruto: string, cabecalho: string | null, segredo: string, agoraMs = Date.now()): void {
  if (!cabecalho) throw new AssinaturaInvalida("sem Stripe-Signature");
  const partes = cabecalho.split(",").map((p) => p.trim().split("="));
  const t = partes.find(([k]) => k === "t")?.[1];
  const v1s = partes.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || v1s.length === 0) throw new AssinaturaInvalida("cabeçalho malformado");
  if (Math.abs(agoraMs / 1000 - Number(t)) > TOLERANCIA_S) throw new AssinaturaInvalida("carimbo fora da tolerância");
  const esperado = Buffer.from(createHmac("sha256", segredo).update(`${t}.${corpoBruto}`, "utf8").digest("hex"), "utf8");
  const confere = v1s.some((v) => {
    const b = Buffer.from(v, "utf8");
    return b.length === esperado.length && timingSafeEqual(b, esperado);
  });
  if (!confere) throw new AssinaturaInvalida("assinatura não confere");
}

type Obj = Record<string, unknown>;
const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : v && typeof v === "object" && typeof (v as Obj).id === "string" ? String((v as Obj).id) : null);
const seg = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v * 1000 : null);

/** Lê o evento já verificado, nos dois formatos de versão da API (a assinatura da fatura mudou de lugar). */
export function lerEvento(corpo: Obj): EventoDoProvedor {
  const obj = ((corpo.data as Obj | undefined)?.object ?? {}) as Obj;
  let assinaturaId: string | null = null;
  let tenantId: string | null = null;
  if (obj.object === "subscription") {
    assinaturaId = texto(obj.id);
    tenantId = texto((obj.metadata as Obj | undefined)?.tenantId);
  } else if (obj.object === "checkout.session") {
    assinaturaId = texto(obj.subscription);
    tenantId = texto(obj.client_reference_id) ?? texto((obj.metadata as Obj | undefined)?.tenantId);
  } else if (obj.object === "invoice") {
    const pai = (obj.parent as Obj | undefined)?.subscription_details as Obj | undefined;
    assinaturaId = texto(obj.subscription) ?? texto(pai?.subscription);
    tenantId = texto((pai?.metadata as Obj | undefined)?.tenantId);
  }
  return { id: String(corpo.id ?? ""), tipo: String(corpo.type ?? ""), criadoEm: seg(corpo.created) ?? 0, assinaturaId, tenantId };
}

/** GET /v1/subscriptions/{id} → o nosso formato (período no item nas versões novas da API). */
export function lerAssinatura(s: Obj): AssinaturaDoProvedor {
  const item = (((s.items as Obj | undefined)?.data as Obj[] | undefined) ?? [])[0] ?? {};
  const preco = (item.price as Obj | undefined) ?? (s.plan as Obj | undefined) ?? {};
  return {
    id: String(s.id),
    clienteId: texto(s.customer) ?? "",
    status: String(s.status ?? ""),
    precoId: texto(preco.id) ?? texto(preco),
    periodoFim: seg(s.current_period_end) ?? seg(item.current_period_end),
    cancelaNoFimDoPeriodo: s.cancel_at_period_end === true,
    canceladaEm: seg(s.canceled_at),
    trialFim: seg(s.trial_end),
    tenantId: texto((s.metadata as Obj | undefined)?.tenantId),
  };
}

/** Versão da API fixada nas chamadas: o formato não muda por baixo do app. */
export const VERSAO_API_STRIPE = "2024-06-20";

export class ProvedorStripe implements ProvedorDeCobranca {
  constructor(
    private readonly chave: string,
    private readonly segredoWebhook: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  private async chamar(metodo: "GET" | "POST", caminho: string, campos?: Record<string, string>, idempotencia?: string): Promise<Obj> {
    const res = await this.http(`https://api.stripe.com${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${this.chave}`,
        "Stripe-Version": VERSAO_API_STRIPE,
        ...(campos ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencia ? { "Idempotency-Key": idempotencia } : {}),
      },
      body: campos ? new URLSearchParams(campos).toString() : undefined,
      cache: "no-store",
    });
    const corpo = (await res.json().catch(() => ({}))) as Obj;
    if (!res.ok) {
      const erro = (corpo.error as Obj | undefined) ?? {};
      throw new Error(`stripe ${res.status}: ${String(erro.code ?? erro.type ?? "erro")}`);
    }
    return corpo;
  }

  async criarCheckout(p: Parameters<ProvedorDeCobranca["criarCheckout"]>[0]) {
    const campos: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": p.precoId,
      "line_items[0][quantity]": "1",
      success_url: p.urlSucesso,
      cancel_url: p.urlCancelar,
      client_reference_id: p.tenantId,
      "metadata[tenantId]": p.tenantId,
      "subscription_data[metadata][tenantId]": p.tenantId,
      locale: "pt-BR",
      ...(p.clienteId ? { customer: p.clienteId } : { customer_email: p.email }),
    };
    const s = await this.chamar("POST", "/v1/checkout/sessions", campos);
    return { url: String(s.url) };
  }

  async criarPortal(p: { clienteId: string; urlRetorno: string }) {
    const s = await this.chamar("POST", "/v1/billing_portal/sessions", { customer: p.clienteId, return_url: p.urlRetorno });
    return { url: String(s.url) };
  }

  async buscarAssinatura(id: string) {
    return lerAssinatura(await this.chamar("GET", `/v1/subscriptions/${encodeURIComponent(id)}`));
  }

  verificarEvento(corpoBruto: string, cabecalho: string | null, agora = Date.now()) {
    verificarAssinaturaStripe(corpoBruto, cabecalho, this.segredoWebhook, agora);
    return lerEvento(JSON.parse(corpoBruto) as Obj);
  }
}

export type ConfigDeCobranca =
  | { ligada: true; provedor: ProvedorDeCobranca }
  | { ligada: false; motivo: "sem_chave" | "chave_de_producao_nao_autorizada" };

/**
 * Cobrança ligada só com as duas chaves do Stripe. Chave de PRODUÇÃO
 * (`sk_live_`) só com `ZXP_COBRANCA_LIVE=autorizado` — ninguém cobra cartão de
 * verdade por esquecimento de variável.
 */
export function configDeCobranca(env: Record<string, string | undefined> = process.env): ConfigDeCobranca {
  const chave = env.STRIPE_SECRET_KEY?.trim();
  const segredo = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!chave || !segredo) return { ligada: false, motivo: "sem_chave" };
  if (chave.startsWith("sk_live_") && env.ZXP_COBRANCA_LIVE !== "autorizado") return { ligada: false, motivo: "chave_de_producao_nao_autorizada" };
  return { ligada: true, provedor: new ProvedorStripe(chave, segredo) };
}
