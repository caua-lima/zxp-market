/**
 * O que o Service Worker faz ao clicar numa notificação — a parte que decide
 * PRA ONDE ir e QUAL janela usar.
 *
 * ─── POR QUE ISTO MORA AQUI, E NÃO NO SERVICE WORKER ────────────────────
 *
 * O Service Worker é um arquivo gerado por template (app/firebase-messaging-
 * sw.js/route.ts) e não dá pra testá-lo. Estas funções são escritas como JS
 * simples, sem depender de nada de fora, e o SW as incorpora pelo texto
 * (`Function.prototype.toString`). Assim o que roda no aparelho é EXATAMENTE o
 * que os testes exercitam — e os testes conferem, inclusive, que a versão
 * convertida em texto continua funcionando sozinha.
 *
 * Por isso cada função é AUTOCONTIDA: constantes, expressões regulares e
 * auxiliares ficam DENTRO dela. Uma referência a algo do módulo funcionaria no
 * teste e quebraria no aparelho, onde esse módulo não existe.
 */

/**
 * Devolve um endereço RELATIVO e seguro, ou "/" se o `deepLink` não presta.
 *
 * Antes o clique navegava direto pro que viesse em `data.deepLink`, sem conferir
 * nada. O payload é montado pelo nosso servidor, mas o Service Worker não tem
 * como saber isso — e um endereço de outra origem, um `javascript:` ou um
 * caminho que o app não conhece não devem ser abertos por um clique.
 *
 * Só passa:
 *  - a MESMA origem do app;
 *  - o caminho raiz "/" (o app é uma tela só; a navegação vai nos parâmetros);
 *  - os parâmetros `tab`, `order`, `task`, `item`, `tipo` e `ev`, cada um com o
 *    formato que espera. Qualquer outro parâmetro, e o fragmento, são descartados.
 */
export function validarDeepLink(link: unknown, origem: string): string {
  const PERMITIDOS: Record<string, RegExp> = {
    tab: /^[a-z0-9_-]{1,40}$/,
    tipo: /^[a-z0-9_-]{1,20}$/,
    order: /^[A-Za-z0-9_-]{1,64}$/,
    task: /^[A-Za-z0-9_-]{1,128}$/,
    item: /^[A-Za-z0-9_-]{1,128}$/,
    ev: /^[A-Za-z0-9:_@.-]{1,220}$/,
  };
  try {
    const url = new URL(String(link == null || link === "" ? "/" : link), origem);
    if (url.origin !== new URL(origem).origin) return "/";
    if (url.pathname !== "/") return "/";
    const partes: string[] = [];
    url.searchParams.forEach((valor, chave) => {
      const regra = PERMITIDOS[chave];
      if (regra && regra.test(valor)) partes.push(encodeURIComponent(chave) + "=" + encodeURIComponent(valor));
    });
    return partes.length > 0 ? "/?" + partes.join("&") : "/";
  } catch {
    return "/";
  }
}

/** Acrescenta `chave=valor` a um endereço relativo já validado, substituindo a chave se existir. */
export function juntarParametro(caminho: string, chave: string, valor: string): string {
  const base = String(caminho || "/");
  const corte = base.indexOf("?");
  const raiz = corte >= 0 ? base.slice(0, corte) : base;
  const resto = corte >= 0 ? base.slice(corte + 1) : "";
  const partes = resto.split("&").filter(function (p) { return p && p.split("=")[0] !== encodeURIComponent(chave); });
  partes.push(encodeURIComponent(chave) + "=" + encodeURIComponent(valor));
  return raiz + "?" + partes.join("&");
}

/**
 * Qual janela do app usar. Devolve o índice, ou -1 se não há nenhuma.
 *
 * Preferência: a que está em FOCO; depois uma VISÍVEL; depois qualquer uma. A
 * versão anterior pegava a primeira da lista, que podia ser uma aba de outro
 * dia esquecida em segundo plano — o clique "abria" o app onde ninguém olhava.
 */
export function escolherJanela(janelas: { focused?: boolean; visibilityState?: string }[]): number {
  for (let i = 0; i < janelas.length; i++) if (janelas[i] && janelas[i].focused) return i;
  for (let i = 0; i < janelas.length; i++) if (janelas[i] && janelas[i].visibilityState === "visible") return i;
  return janelas.length > 0 ? 0 : -1;
}
