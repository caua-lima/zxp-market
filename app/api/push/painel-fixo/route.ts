import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { deviceIdValido, idDoRegistro } from "@/lib/domain/push-registro";

/**
 * Liga/desliga o mini painel FIXO das vendas ao vivo neste aparelho (a
 * notificação que fica na barra do celular e se reescreve a cada venda).
 *
 * Marca o registro de push da instalação (pessoa, aparelho) — é por ele que o
 * webhook acha pra quem mandar o placar (lib/ml/ao-vivo-tempo-real.ts). Sem
 * registro, o aparelho não tem como receber: o app ativa as notificações antes.
 *
 * O placar é faturamento e contagem do dia, o mesmo que a barra mostra a
 * qualquer acesso (`ver_resumo`). A empresa vai junto: o registro de push é da
 * pessoa, e quem participa de duas empresas fixa o painel de uma.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  const corpo = (await req.json().catch(() => null)) as { deviceId?: unknown; ligado?: unknown } | null;
  if (!deviceIdValido(corpo?.deviceId)) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const ligado = corpo?.ligado === true;

  const email = gate.email.toLowerCase();
  const ref = getAdminDb().collection("pushTokens").doc(idDoRegistro(email, corpo.deviceId));
  const snap = await ref.get();
  if (!snap.exists || String(snap.get("email") ?? "").toLowerCase() !== email) {
    // Desligar o que não existe já é o estado pedido; ligar precisa do push ativo.
    return ligado
      ? NextResponse.json({ error: "sem_push", mensagem: "Ative as notificações neste aparelho primeiro." }, { status: 409 })
      : NextResponse.json({ ok: true, ligado: false });
  }

  await ref.update(ligado
    ? { painelFixoEmpresa: gate.tenantId ?? "raiz", painelFixoEm: Date.now() }
    : { painelFixoEmpresa: FieldValue.delete(), painelFixoEm: FieldValue.delete() });
  return NextResponse.json({ ok: true, ligado });
}
