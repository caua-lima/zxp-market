/** Sai do app pra uma página externa confiável (checkout/portal do Stripe devolvidos pelo servidor). */
export function irPara(url: string): void {
  window.location.assign(url);
}

/** Recarrega a página (depois de criar a empresa, o acesso é conferido do zero). */
export function recarregarPagina(): void {
  window.location.reload();
}
