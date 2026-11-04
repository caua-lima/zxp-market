import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { caminhoDoTime } from "@/lib/empresas";

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

  const snap = await getAdminDb().collection(caminhoDoTime()).orderBy("email", "asc").get();
  // O papel de cada um só vai pro Master: é o que o "ver como" dele precisa, e não é da conta do resto do time.
  const comPapel = gate.papel === "owner";
  const pessoas = snap.docs.map((d) => {
    const data = d.data() as { email?: string; displayName?: string; role?: string };
    return { email: data.email ?? d.id, displayName: data.displayName ?? null, ...(comPapel && data.role ? { role: data.role } : {}) };
  });
  return NextResponse.json({ pessoas });
}
