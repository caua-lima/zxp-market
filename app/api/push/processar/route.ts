import { NextResponse } from "next/server";
import { motivoRecusaDoCron, requireAccess } from "@/lib/api-auth";
import { varrerEntregasPendentes } from "@/lib/notification-dispatch";

export const maxDuration = 60;

/**
 * O consumidor independente do outbox de push.
 *
 * Envia o que ficou pendente — retries vencidos, concessões expiradas, fan-outs
 * incompletos — sem depender de quem publicou o aviso. Aceita o segredo do cron
 * e o dono da conta; qualquer outro é recusado.
 *
 * Chamar quantas vezes quiser é seguro: cada destino só é enviado por um worker
 * (concessão em transação). Um agendador externo chamando isto a cada minuto dá
 * retry rápido mesmo no plano gratuito da Vercel, que só permite cron diário.
 */
async function tratar(req: Request) {
  const recusa = motivoRecusaDoCron(req);
  if (recusa !== null) {
    const gate = await requireAccess(req, { capacidade: "administrar" });
    if (gate instanceof NextResponse) return gate;
  }
  const limpar = new URL(req.url).searchParams.get("limpar") === "1";
  const resultado = await varrerEntregasPendentes({ limpar });
  return NextResponse.json({ ok: true, ...resultado });
}

export const GET = tratar;
export const POST = tratar;
