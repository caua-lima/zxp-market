import { NextResponse } from "next/server";
import { getMlTokenStatus } from "../token";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerPrimeiraSincronizacao } from "@/lib/ml/primeira-sincronizacao";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  const status = await getMlTokenStatus();
  // S24: o checklist de ativação pergunta se as vendas já foram importadas.
  const [pedidos, primeira] = await Promise.all([
    getAdminDb().collection("ml_orders").count().get().then((s) => s.data().count).catch(() => null),
    lerPrimeiraSincronizacao().catch(() => null),
  ]);
  return NextResponse.json({ ...status, pedidosImportados: pedidos, primeiraSincronizacaoEm: primeira });
}
