import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { validarEntradaDeVinculo } from "@/lib/domain/push-registro";
import { vincularToken } from "@/lib/push-registro-store";

/**
 * Vincula o token FCM deste aparelho à pessoa autenticada.
 *
 * O registro era gravado direto do navegador. Aqui ele passa pelo servidor
 * porque as invariantes (ver lib/domain/push-registro.ts) precisam apagar
 * documentos que o cliente não alcança: se este mesmo token estava vinculado
 * a OUTRA conta, o aparelho trocou de dono e o registro antigo tem que sair —
 * senão o push da conta anterior segue chegando na tela de quem entrou agora.
 *
 * Qualquer pessoa com acesso pode vincular o próprio aparelho, inclusive o
 * `member` (é o papel que só acompanha resultado, e recebe push).
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const corpo = await req.json().catch(() => null);
  const entrada = validarEntradaDeVinculo(corpo);
  if (!entrada.ok) return NextResponse.json({ error: "invalid_body", details: entrada.motivo }, { status: 400 });

  const ua = (corpo as { userAgent?: unknown }).userAgent;
  const userAgent = typeof ua === "string" ? ua.slice(0, 300) : "";

  const { removidos } = await vincularToken(getAdminDb(), gate.email, entrada, userAgent);
  return NextResponse.json({ ok: true, removidos });
}
