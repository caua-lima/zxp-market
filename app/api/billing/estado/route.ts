import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { configDeCobranca } from "@/lib/billing/provedor";
import { lerDireitos } from "@/lib/billing/empresa";
import { CATALOGO, type Plano } from "@/config/planos";

/** Plano, estado, limites e uso da empresa de quem chama (S25). Sem preço: o preço aparece no checkout. */
export async function GET(req: Request) {
  if (lerModoDeDados() !== "tenant") return NextResponse.json({ modo: "raiz" });
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  if (!gate.tenantId) return NextResponse.json({ error: "sem_empresa" }, { status: 400 });

  const { direitos, membros, assinatura } = await lerDireitos(getAdminDb(), gate.tenantId);
  const cobranca = configDeCobranca();
  const vendaveis = (Object.entries(CATALOGO.planos) as [string, Plano][])
    .filter(([, p]) => p.precoEnv && process.env[p.precoEnv])
    .map(([id, p]) => ({ id, nome: p.nome, membros: p.membros, conexoes: p.conexoes }));

  return NextResponse.json({
    modo: "tenant",
    direitos,
    uso: { membros },
    trialAte: assinatura?.trialAte ?? null,
    periodoFim: assinatura?.periodoFim ?? null,
    cancelaEm: assinatura?.cancelaEm ?? null,
    temAssinatura: Boolean(assinatura?.clienteId),
    cobrancaLigada: cobranca.ligada,
    planos: gate.papel === "owner" ? vendaveis : [],
  });
}
