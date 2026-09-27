import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { configDeCobranca } from "@/lib/billing/provedor";
import { urlDoApp } from "@/lib/billing/empresa";
import { CATALOGO, type IdDoPlano } from "@/config/planos";
import type { Assinatura } from "@/lib/domain/assinatura";
import { log } from "@/lib/log";

/**
 * Checkout hospedado do Stripe pra assinar um plano (S25). Só o DONO da empresa.
 * A volta do checkout NÃO libera nada: quem muda o plano é o webhook, depois
 * de buscar a assinatura no Stripe (lib/billing/sincronizar.ts).
 */
export async function POST(req: Request) {
  if (lerModoDeDados() !== "tenant") return NextResponse.json({ error: "so_modo_empresa" }, { status: 400 });
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  if (gate.papel !== "owner" || !gate.tenantId) return NextResponse.json({ error: "so_o_dono" }, { status: 403 });

  const cobranca = configDeCobranca();
  if (!cobranca.ligada) return NextResponse.json({ error: "cobranca_desligada", motivo: cobranca.motivo }, { status: 503 });

  const { plano } = (await req.json().catch(() => ({}))) as { plano?: string };
  const def = CATALOGO.planos[plano as IdDoPlano] as { precoEnv?: string } | undefined;
  const precoId = def?.precoEnv ? process.env[def.precoEnv]?.trim() : undefined;
  if (!precoId) return NextResponse.json({ error: "plano_indisponivel" }, { status: 400 });

  const base = urlDoApp(req);
  if (!base) return NextResponse.json({ error: "app_url_ausente" }, { status: 500 });

  const db = getAdminDb();
  const assinatura = (await db.doc(`tenants/${gate.tenantId}`).get()).data()?.assinatura as Assinatura | undefined;
  // Quem já assina troca de plano no portal (upgrade/downgrade com o rateio do Stripe).
  if (assinatura?.assinaturaId && assinatura.estado !== "cancelada") {
    return NextResponse.json({ error: "ja_assinante", details: "Use Gerenciar assinatura pra trocar de plano." }, { status: 409 });
  }

  try {
    const { url } = await cobranca.provedor.criarCheckout({
      tenantId: gate.tenantId,
      precoId,
      clienteId: assinatura?.clienteId ?? null,
      email: gate.email,
      urlSucesso: `${base}/?tab=acesso&cobranca=voltou`,
      urlCancelar: `${base}/?tab=acesso&cobranca=cancelado`,
    });
    return NextResponse.json({ url });
  } catch (err) {
    log.error("cobranca", { mensagem: "checkout falhou", erro: err });
    return NextResponse.json({ error: "checkout_falhou" }, { status: 502 });
  }
}
