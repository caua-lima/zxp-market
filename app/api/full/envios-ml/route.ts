import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLECAO_ENVIOS_ML, DOC_DA_SYNC, mapaDeProdutosDoEstoque } from "@/lib/ml/envios-full-sync";

/**
 * Os envios pro Full que a extensão leu do painel do ML (lib/ml/envios-full-sync.ts),
 * pra tela. Pelo servidor, e não direto do Firestore no cliente: a coleção é
 * só do servidor, e assim a tela funciona sem depender de publicar regra nova.
 *
 * Traz também o mapa MLB → produto (o MESMO que o servidor usou pra reservar),
 * pra tela calcular a baixa pendente com a mesma correspondência.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;
  const db = getAdminDb();
  const [snap, mapa] = await Promise.all([db.collection(COLECAO_ENVIOS_ML).get(), mapaDeProdutosDoEstoque()]);
  const sync = snap.docs.find((d) => d.id === DOC_DA_SYNC)?.data() ?? null;
  const envios = snap.docs.filter((d) => d.id !== DOC_DA_SYNC).map((d) => d.data());
  return NextResponse.json(
    { envios, sync, produtoPorMlb: Object.fromEntries(mapa) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
