import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { validarTokenSolto } from "@/lib/domain/push-registro";
import { desvincular } from "@/lib/push-registro-store";

/**
 * Desfaz o registro de push deste aparelho.
 *
 * Aceita SEM sessão de propósito, e a razão é o próprio caso de uso: sair da
 * conta. Se a saída acontece sem rede — ou o token de acesso já expirou —, o
 * desvínculo fica pendente no aparelho e só pode ser refeito depois, quando
 * não existe mais ninguém autenticado. Exigir sessão aqui deixaria o push da
 * conta anterior vivo justamente no caso que o desvínculo existe pra cobrir.
 *
 * O que autoriza é a POSSE do token: ele é gerado pelo navegador, só o
 * servidor e este aparelho o conhecem, e tem entropia de sobra pra não ser
 * adivinhado. Só apaga registros cujo `token` seja exatamente o informado, e
 * a resposta é a mesma quer tenha apagado ou não — a rota não serve pra
 * descobrir se um token existe.
 *
 * Com sessão, aceita também `deviceId`, que apaga o registro (pessoa,
 * instalação): é o botão "desativar", que não depende de conseguir gerar o
 * token de novo (a permissão pode ter sido revogada).
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const token = validarTokenSolto(corpo) ?? undefined;
  const bruto = (corpo as { deviceId?: unknown } | null)?.deviceId;
  const deviceId = typeof bruto === "string" ? bruto.slice(0, 64) : undefined;

  // Identidade, se houver: só vale pro critério por instalação.
  let email: string | undefined;
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (m) {
    try {
      email = ((await getAdminAuth().verifyIdToken(m[1].trim())).email ?? "").toLowerCase() || undefined;
    } catch { /* sessão expirada: cai no critério por posse do token */ }
  }

  if (!token && !(email && deviceId)) {
    return NextResponse.json({ error: "invalid_body", details: "informe o token, ou o deviceId com sessão" }, { status: 400 });
  }

  await desvincular(getAdminDb(), { email, deviceId, token });
  return NextResponse.json({ ok: true });
}
