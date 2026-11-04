import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { caminhoDoTime } from "@/lib/empresas";

/**
 * A pessoa acabou de criar a PRÓPRIA senha (tela "Crie sua senha" do
 * AccessGuard): tira a marca `trocarSenha` do registro de acesso dela.
 *
 * O Sócio nasce com uma senha aleatória que o Master passa pra ele, e o
 * primeiro login obriga a trocar (pedido do dono, 03/11/2026). Só o próprio
 * registro, e só esse campo — pelo servidor, porque as regras do Firestore não
 * deixam ninguém além do dono mexer no registro de acesso.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  const ref = getAdminDb().collection(caminhoDoTime()).doc(gate.email.toLowerCase());
  const ok = await ref.update({ trocarSenha: false, senhaDefinidaEm: Date.now() }).then(() => true, () => false);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
