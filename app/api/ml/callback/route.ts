import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { exchangeCodeForToken } from "@/lib/ml/client";
import { consumirTransacao } from "@/lib/ml/oauth-transacao";
import { relogioDoToken } from "@/lib/domain/token-ml";
import { SELLER_ID } from "@/lib/ml/orders";

/**
 * A volta do Mercado Livre — onde a conexão é de fato substituída.
 *
 * ─── O QUE ESTE HANDLER NÃO VALIDAVA ────────────────────────────────────
 *
 * Nada. Recebia `code`, trocava por token e gravava em `ml_tokens/main`, o
 * documento único que todo o app usa. Sem `state`, sem saber quem tinha
 * pedido, sem conferir QUAL conta autorizou.
 *
 * O resultado: bastava alguém completar o fluxo com a própria conta do ML
 * pra o painel da VAZXPRESS passar a sincronizar a loja dessa pessoa — e a
 * conexão real era sobrescrita no caminho.
 *
 * ─── A ORDEM IMPORTA ────────────────────────────────────────────────────
 *
 * state → troca → perfil → vendedor → só então gravar. Qualquer validação
 * depois da gravação seria tarde: a conexão boa já teria sido destruída.
 */

/** Volta pra home com o motivo na URL, pra a tela poder explicar. */
function recusar(req: Request, motivo: string) {
  const destino = new URL("/", req.url);
  destino.searchParams.set("ml_erro", motivo);
  return NextResponse.redirect(destino);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) return recusar(req, "code_ausente");

    /**
     * Consome o `state` ANTES de qualquer outra coisa. É uma transação do
     * Firestore, então uma volta repetida (retry do navegador, clique duplo)
     * não passa duas vezes — e o `verifier` do PKCE vem de lá, não de cookie.
     */
    let transacao;
    try {
      transacao = await consumirTransacao(state);
    } catch (err) {
      return recusar(req, err instanceof Error ? err.message : "state_invalido");
    }

    const token = await exchangeCodeForToken(code, transacao.verifier);

    // O perfil é OBRIGATÓRIO aqui: é ele que diz qual vendedor autorizou.
    // Sem ele não dá pra validar, e gravar sem validar é o bug original.
    let perfil: { id?: number | string; nickname?: string } | null = null;
    try {
      const res = await fetch("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
      });
      if (res.ok) perfil = await res.json();
    } catch { /* tratado abaixo */ }

    if (!perfil?.id) return recusar(req, "perfil_indisponivel");

    /**
     * O vendedor esperado: o que já está conectado, ou — na primeira conexão
     * — o da configuração. Conta diferente NÃO substitui a conexão.
     */
    const db = getAdminDb();
    const atual = await db.collection("ml_tokens").doc("main").get();
    const jaConectado = atual.exists ? atual.data()?.user_id : null;
    const esperado = String(jaConectado ?? SELLER_ID); // SELLER_ID ja le ML_SELLER_ID
    const autorizou = String(perfil.id);

    if (esperado && autorizou !== esperado) {
      /**
       * Recusa sem tocar em `ml_tokens/main`. Cancelar ou errar de conta não
       * pode destruir uma conexão válida — era exatamente o que acontecia.
       */
      return recusar(req, "vendedor_inesperado");
    }

    const geracaoAnterior = Number(atual.data()?.geracao ?? 0);

    await db.collection("ml_tokens").doc("main").set(
      {
        access_token: token.access_token || null,
        refresh_token: token.refresh_token || null,
        expires_in: token.expires_in || null,
        /**
         * O relogio PROPRIO do token.
         *
         * A expiracao era calculada a partir de `updated_at`, que e "quando o
         * documento foi tocado" — e este handler grava `updated_at` junto com
         * o perfil. Atualizar o perfil empurrava a validade do token pra
         * frente, e o app seguia usando um access token morto ate tomar 401.
         */
        ...relogioDoToken(token.expires_in, Date.now()),
        // Renovacao anterior, se houver, perde a vez: esta e outra conexao.
        refreshLeaseAte: null,
        user_id: token.user_id || perfil.id || null,
        user_profile: perfil,
        updated_at: new Date().toISOString(),
        /**
         * Sobe a cada vínculo concluído. Serve pra invalidar cache e descartar
         * operação da conexão anterior: quem guardou algo na geração 3 sabe
         * que a geração 4 é outra conexão.
         */
        geracao: geracaoAnterior + 1,
        vinculadoPor: transacao.solicitante,
      },
      { merge: true },
    );

    const resposta = NextResponse.redirect(new URL("/", req.url));
    resposta.cookies.set("ml_disconnected", "false", { maxAge: 0 });
    // Cookie do PKCE antigo: limpa o que tiver sobrado de versões anteriores.
    resposta.cookies.set("ml_pkce_verifier", "", { maxAge: 0, path: "/" });
    return resposta;
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Unexpected error in callback",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
