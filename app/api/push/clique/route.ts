import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { idDoRegistro } from "@/lib/domain/push-registro";
import { registrarClique } from "@/lib/notification-outbox";

const EVENT_ID = /^[A-Za-z0-9:_@.-]{1,220}$/;
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Recibo de clique: a pessoa tocou na notificação DESTE aparelho.
 *
 * O app (com a sessão) reporta; o servidor só aceita pro par (pessoa da sessão,
 * aparelho informado) — o id do destino é montado com o e-mail do TOKEN, nunca com
 * um e-mail do corpo, então ninguém registra clique em nome de outra pessoa.
 * Idempotente. Ver registrarClique.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const corpo = await req.json().catch(() => null) as { eventId?: unknown; deviceId?: unknown } | null;
  const eventId = typeof corpo?.eventId === "string" ? corpo.eventId : "";
  const deviceId = typeof corpo?.deviceId === "string" ? corpo.deviceId : "";
  if (!EVENT_ID.test(eventId) || !DEVICE_ID.test(deviceId)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const resultado = await registrarClique(getAdminDb(), { pushId: eventId, registroDocId: idDoRegistro(gate.email, deviceId) });
  return NextResponse.json({ ok: true, resultado });
}
