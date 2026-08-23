import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { ehMaster } from "@/lib/tenant";

export const maxDuration = 30;

/**
 * Ajuste de licença — o botão que decide se o cliente entra ou não.
 *
 * As regras do Firestore têm `allow write: if false` em `licencas`: nem o
 * master escreve direto do navegador. É de propósito — a licença controla a
 * cobrança, e uma tela comprometida não pode liberar acesso. Toda alteração
 * passa por aqui, no servidor, com o Admin SDK.
 *
 * Ações possíveis, e por que só estas três:
 *   renovar   → empurra o vencimento pra frente (o caso do dia a dia)
 *   suspender → corta o acesso sem apagar nada (inadimplência)
 *   reativar  → desfaz a suspensão
 *
 * Não há "excluir": apagar a licença apagaria o histórico de quem já foi
 * cliente, e suspender resolve o mesmo problema sem perder informação.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  if (!(await ehMaster(gate.email))) {
    return NextResponse.json({ error: "nao_e_master" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string; acao?: string; dias?: number;
    };
    const email = String(body.email ?? "").trim().toLowerCase();
    const acao = String(body.acao ?? "").trim();
    const dias = Math.max(0, Number(body.dias ?? 0) || 0);

    if (!email) return NextResponse.json({ error: "email_obrigatorio" }, { status: 400 });

    const ref = getAdminDb().collection("licencas").doc(email);
    const atual = await ref.get();
    if (!atual.exists) return NextResponse.json({ error: "licenca_nao_encontrada" }, { status: 404 });

    const agora = Date.now();
    const patch: Record<string, unknown> = { alteradaEm: agora, alteradaPor: gate.email };

    if (acao === "suspender") {
      patch.status = "suspenso";
    } else if (acao === "reativar") {
      patch.status = "ativo";
    } else if (acao === "renovar") {
      if (dias <= 0) return NextResponse.json({ error: "dias_obrigatorio" }, { status: 400 });
      /**
       * Renova a partir do vencimento atual quando ele ainda está no futuro,
       * e a partir de HOJE quando já venceu. Somar sempre sobre a data antiga
       * daria menos dias do que o combinado a quem renovou atrasado; somar
       * sempre sobre hoje presentearia dias a quem renovou adiantado.
       */
      const venceEm = Number(atual.data()?.expiresAt ?? 0);
      const base = venceEm > agora ? venceEm : agora;
      patch.expiresAt = base + dias * 86400000;
      patch.status = "ativo"; // renovar reativa: pagar é o que desfaz a suspensão
    } else {
      return NextResponse.json({ error: "acao_invalida", acoes: ["renovar", "suspender", "reativar"] }, { status: 400 });
    }

    await ref.set(patch, { merge: true });
    const novo = await ref.get();
    return NextResponse.json({
      ok: true,
      email,
      status: novo.data()?.status ?? null,
      expiresAt: novo.data()?.expiresAt ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "licenca_falhou", details: msg }, { status: 500 });
  }
}
