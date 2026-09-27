import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { configDeCobranca } from "@/lib/billing/provedor";
import { urlDoApp } from "@/lib/billing/empresa";
import type { Assinatura } from "@/lib/domain/assinatura";
import { log } from "@/lib/log";

/**
 * Portal do cliente no Stripe (S25): cartão, faturas, troca de plano e
 * cancelamento no fim do período. Só o dono. O que mudar lá chega pelo webhook.
 */
export async function POST(req: Request) {
  if (lerModoDeDados() !== "tenant") return NextResponse.json({ error: "so_modo_empresa" }, { status: 400 });
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  if (gate.papel !== "owner" || !gate.tenantId) return NextResponse.json({ error: "so_o_dono" }, { status: 403 });

  const cobranca = configDeCobranca();
  if (!cobranca.ligada) return NextResponse.json({ error: "cobranca_desligada", motivo: cobranca.motivo }, { status: 503 });
  const base = urlDoApp(req);
  if (!base) return NextResponse.json({ error: "app_url_ausente" }, { status: 500 });

  const assinatura = (await getAdminDb().doc(`tenants/${gate.tenantId}`).get()).data()?.assinatura as Assinatura | undefined;
  if (!assinatura?.clienteId) return NextResponse.json({ error: "sem_assinatura" }, { status: 404 });

  try {
    const { url } = await cobranca.provedor.criarPortal({ clienteId: assinatura.clienteId, urlRetorno: `${base}/?tab=acesso` });
    return NextResponse.json({ url });
  } catch (err) {
    log.error("cobranca", { mensagem: "portal falhou", erro: err });
    return NextResponse.json({ error: "portal_falhou" }, { status: 502 });
  }
}
