import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * O diretório de quem tem acesso — só e-mail e nome, pra popular o seletor
 * de responsável em Tarefas.
 *
 * `controleAcesso` (a lista COMPLETA, com papel e permissão granular) só é
 * listável pelo owner nas regras do Firestore (`allow list: if isOwner()`) —
 * de propósito, é o controle de acesso em si. Isso deixava TarefasTab
 * (`watchAccessList`) sem dado nenhum pra um colaborador: a tela precisa de
 * "quem existe", não de "quem pode o quê". Em vez de afrouxar o `list` da
 * coleção sensível pra qualquer autorizado, esta rota usa o Admin SDK (que já
 * ignora as regras do cliente) e devolve só os dois campos que a tela usa.
 *
 * Achado S19 da auditoria SaaS.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const snap = await getAdminDb().collection("controleAcesso").orderBy("email", "asc").get();
  const pessoas = snap.docs.map((d) => {
    const data = d.data() as { email?: string; displayName?: string };
    return { email: data.email ?? d.id, displayName: data.displayName ?? null };
  });
  return NextResponse.json({ pessoas });
}
