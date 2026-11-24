import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { caminhoDoTime } from "@/lib/empresas";
import { guardarSenha } from "@/lib/senhas-cofre";

/**
 * A pessoa troca a PRÓPRIA senha ("Alterar senha" no menu, e a tela "Crie
 * sua senha" do primeiro login).
 *
 * Pelo servidor, e não com `updatePassword` no navegador: assim a senha nova
 * também vai pro cofre (o "Ver senha" continua valendo depois da troca), e não
 * esbarra no "faça login de novo" que o Firebase exige pra trocar senha de uma
 * sessão antiga. Tira a marca `trocarSenha` do registro de acesso.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  const corpo = (await req.json().catch(() => null)) as { senha?: unknown } | null;
  const senha = String(corpo?.senha ?? "");
  if (senha.length < 6) return NextResponse.json({ error: "senha_curta", details: "A senha precisa ter pelo menos 6 caracteres." }, { status: 400 });

  try {
    await getAdminAuth().updateUser(gate.uid, { password: senha });
  } catch (err) {
    return NextResponse.json({ error: "falhou", details: String(err).slice(0, 200) }, { status: 500 });
  }
  await guardarSenha(gate.email, senha, gate.email).catch(() => {});
  await getAdminDb().collection(caminhoDoTime()).doc(gate.email.toLowerCase())
    .update({ trocarSenha: false, senhaDefinidaEm: Date.now() }).catch(() => {});
  return NextResponse.json({ ok: true });
}
