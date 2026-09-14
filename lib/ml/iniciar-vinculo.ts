import { authedFetch } from "@/lib/api/authed-fetch";
import { explicarRecusa } from "@/lib/domain/oauth-estado";

/**
 * Começa o vínculo com o Mercado Livre, do lado do navegador.
 *
 * Antes cada tela fazia `window.location.href = '/api/ml/auth?login=true'` —
 * uma navegação simples, que não leva o token do Firebase e por isso obrigava
 * a rota a ser pública. Agora o pedido é um POST autenticado: o servidor
 * confere que quem pede administra o app, cria a transação OAuth e devolve a
 * URL. Só então o navegador sai daqui.
 *
 * As telas também desconectavam ANTES de redirecionar. Isso apagava uma
 * conexão boa quando o fluxo era cancelado no meio. O callback agora troca a
 * conexão só depois de validar o vendedor, então não há mais o que limpar.
 *
 * @returns a mensagem de erro, ou `null` quando o redirecionamento começou.
 */
export async function iniciarVinculoML(): Promise<string | null> {
  try {
    const res = await authedFetch("/api/ml/auth", { method: "POST" });
    if (!res.ok) {
      if (res.status === 401) return "Entre na sua conta para conectar o Mercado Livre.";
      if (res.status === 403) return "Só o administrador pode conectar o Mercado Livre.";
      return "Não foi possível iniciar a conexão com o Mercado Livre.";
    }
    const { url } = await res.json();
    if (!url) return "O servidor não devolveu o endereço de autorização.";
    window.location.href = url;
    return null;
  } catch {
    return "Falha de rede ao iniciar a conexão com o Mercado Livre.";
  }
}

/**
 * Le o motivo que o callback devolveu em `?ml_erro=` e limpa a URL.
 *
 * Sem isto, uma volta recusada simplesmente cairia na home em silencio, e o
 * dono ficaria olhando pra uma conexao que nao aconteceu sem saber por que.
 * A limpeza evita que a mensagem reapareca a cada recarga.
 */
export function motivoDaVolta(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const motivo = url.searchParams.get("ml_erro");
  if (!motivo) return null;
  url.searchParams.delete("ml_erro");
  window.history.replaceState(null, "", url.toString());
  return explicarRecusa(motivo);
}
