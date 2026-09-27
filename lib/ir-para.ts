/** Sai do app pra uma página externa confiável (checkout/portal do Stripe devolvidos pelo servidor). */
export function irPara(url: string): void {
  window.location.assign(url);
}
