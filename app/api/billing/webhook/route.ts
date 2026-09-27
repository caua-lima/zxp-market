import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { AssinaturaInvalida, configDeCobranca, type EventoDoProvedor } from "@/lib/billing/provedor";
import { processarEvento } from "@/lib/billing/sincronizar";
import { log } from "@/lib/log";

export const maxDuration = 30;

/**
 * Webhook do Stripe (S25). Público por natureza — a autenticação é a
 * assinatura HMAC sobre o corpo BRUTO (`req.text()`, nunca `req.json()`:
 * reserializar muda os bytes e a assinatura deixa de conferir).
 *
 * 400 = assinatura inválida (o Stripe não reentrega, e não deve).
 * 500 = falhou processando (o Stripe reentrega; o processamento é idempotente).
 */
export async function POST(req: Request) {
  const cobranca = configDeCobranca();
  if (!cobranca.ligada) return NextResponse.json({ error: "cobranca_desligada" }, { status: 503 });

  const corpo = await req.text();
  let evento: EventoDoProvedor;
  try {
    evento = cobranca.provedor.verificarEvento(corpo, req.headers.get("stripe-signature"));
  } catch (err) {
    if (err instanceof AssinaturaInvalida) {
      log.warn("cobranca.webhook", { mensagem: "assinatura recusada", motivo: err.message });
      return NextResponse.json({ error: "assinatura_invalida" }, { status: 400 });
    }
    return NextResponse.json({ error: "corpo_invalido" }, { status: 400 });
  }

  try {
    const r = await processarEvento(getAdminDb(), cobranca.provedor, evento, { agora: Date.now(), env: process.env });
    log.info("cobranca.webhook", { evento: evento.tipo, resultado: r });
    return NextResponse.json({ ok: true, resultado: r });
  } catch (err) {
    log.error("cobranca.webhook", { mensagem: "processamento falhou; o Stripe vai reentregar", evento: evento.tipo, erro: err });
    return NextResponse.json({ error: "falhou" }, { status: 500 });
  }
}
