/**
 * Um link de notificação abre o item UMA vez por navegação.
 *
 * ─── O QUE ACONTECIA ────────────────────────────────────────────────────
 *
 * Pedidos e Tarefas abriam o item num efeito que dependia de `[idDoLink, lista]`:
 * enquanto o id do link continuasse na URL, TODA atualização da lista (um
 * snapshot do Firestore, uma sincronização) achava o item de novo e o abria de
 * novo. A pessoa fechava o modal e, segundos depois, ele voltava sozinho — no
 * meio de outra coisa.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────
 *
 * O link é uma INTENÇÃO, e a intenção é consumida quando abre. Dado novo chegando
 * não é intenção nova. O que é uma intenção nova:
 *
 *   · outro id;
 *   · o mesmo id numa NAVEGAÇÃO nova — clicar de novo na mesma notificação, ou
 *     Voltar/Avançar até a mesma URL. Isso é o `chaveDeNavegacao`, um número que
 *     quem navega incrementa a cada gesto deliberado.
 *
 * Enquanto o item ainda não está na lista (`pronto = false`), a intenção espera:
 * nada é consumido até abrir de verdade.
 */

export type EntradaDoLink = {
  /** A chave da última intenção já consumida, ou null. */
  consumida: string | null;
  /** O id que a URL/estado pede pra abrir, ou undefined quando não há link. */
  id: string | undefined;
  /** Incrementa a cada navegação deliberada (clique, Voltar, Avançar). */
  chaveDeNavegacao: number;
  /** O item já está na lista carregada? */
  pronto: boolean;
};

export type DecisaoDoLink = { abrir: boolean; consumida: string | null };

export function decidirAberturaDoLink(e: EntradaDoLink): DecisaoDoLink {
  // Sem link (a pessoa saiu do item): zera, pra o MESMO id poder abrir de novo depois.
  if (!e.id) return { abrir: false, consumida: null };
  const chave = `${e.id}#${e.chaveDeNavegacao}`;
  if (e.consumida === chave) return { abrir: false, consumida: e.consumida };
  if (!e.pronto) return { abrir: false, consumida: e.consumida };
  return { abrir: true, consumida: chave };
}
