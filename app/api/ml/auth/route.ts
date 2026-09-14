import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { criarTransacao, limparVencidas } from "@/lib/ml/oauth-transacao";

/**
 * Início do vínculo com o Mercado Livre — agora autorizado pelo servidor.
 *
 * ─── POR QUE VIROU POST ─────────────────────────────────────────────────
 *
 * Era `GET`, e um GET de navegação não carrega o token do Firebase: o
 * navegador só manda cookies. Por isso a rota era PÚBLICA — qualquer pessoa
 * abria a URL e entrava no fluxo que termina gravando em `ml_tokens/main`, o
 * documento único que o app inteiro usa.
 *
 * Com POST, a tela chama a rota com o ID token no header, o servidor confere
 * que quem pede administra o app, cria a transação OAuth (state + PKCE +
 * prazo + dono) e devolve a URL. A tela só então redireciona.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  try {
    // Manutenção barata, no único momento em que a coleção cresce.
    await limparVencidas();
    const { url } = await criarTransacao(gate.email);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: "falha_ao_iniciar", details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * O GET público deixou de existir.
 *
 * Mantido com resposta explícita (em vez de 404) porque links antigos e
 * favoritos ainda apontam pra cá — um 404 pareceria app quebrado, e a causa
 * real é que o início agora exige autorização.
 */
export function GET() {
  return NextResponse.json(
    {
      error: "metodo_nao_suportado",
      details: "O vínculo com o Mercado Livre agora começa por POST autenticado, pelo botão Conectar dentro do app.",
    },
    { status: 405 },
  );
}
