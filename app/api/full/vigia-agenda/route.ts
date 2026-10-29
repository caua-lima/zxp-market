import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { inboundValido } from "@/lib/domain/agenda-full";
import { COLECAO_VIGIAS, testarAvisoDaAgenda, vigiarAgendasFull } from "@/lib/ml/vigia-agenda-full";

export const maxDuration = 30;

/**
 * Liga/desliga a vigia da agenda de um envio pro Full (o número que o ML mostra:
 * #80517703). Ligar já faz a primeira consulta ao ML — a tela mostra na hora o
 * que ele respondeu. Quem edita estoque vigia (é quem agenda a coleta).
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "editar_estoque" });
  if (gate instanceof NextResponse) return gate;
  // ?teste=1: manda o mesmo aviso, marcado como teste, pra conferir que o celular recebe.
  if (new URL(req.url).searchParams.get("teste") === "1") {
    const enviados = await testarAvisoDaAgenda().catch(() => -1);
    return NextResponse.json({ ok: enviados >= 0, enviados: Math.max(0, enviados) }, { status: enviados >= 0 ? 200 : 502 });
  }
  const corpo = (await req.json().catch(() => null)) as { inboundId?: unknown } | null;
  const id = inboundValido(corpo?.inboundId);
  if (!id) return NextResponse.json({ error: "envio_invalido", mensagem: "Use o número do envio como o ML mostra, ex.: 80517703." }, { status: 400 });

  await getAdminDb().collection(COLECAO_VIGIAS).doc(id).set({
    inboundId: id, ativa: true, criadoEm: Date.now(), criadoPor: gate.email.toLowerCase(),
    ultimaConsulta: 0, estado: "aguardando", datas: [], detalhe: "", avisadoDatas: "",
  }, { merge: false });
  const resumo = await vigiarAgendasFull().catch(() => null);
  return NextResponse.json({ ok: true, inboundId: id, resumo });
}

export async function DELETE(req: Request) {
  const gate = await requireAccess(req, { capacidade: "editar_estoque" });
  if (gate instanceof NextResponse) return gate;
  const id = inboundValido(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "envio_invalido" }, { status: 400 });
  await getAdminDb().collection(COLECAO_VIGIAS).doc(id).delete();
  return NextResponse.json({ ok: true });
}
