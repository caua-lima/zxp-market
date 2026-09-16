/**
 * Paginação de lista já carregada.
 *
 * ─── O QUE ISTO É, E O QUE NÃO É ─────────────────────────────────────────
 *
 * É paginação de EXIBIÇÃO: a lista inteira já está na memória, e o que se
 * economiza é o desenho de mil linhas na tela. Não é paginação de busca — não
 * reduz o que vem do Firestore.
 *
 * A distinção importa porque as duas se parecem e resolvem coisas diferentes:
 * esta resolve a tela que trava com quinhentas linhas; a outra resolveria a
 * leitura que custa quota. Chamar esta de "paginação" sem a ressalva faria
 * alguém achar que o problema de quota foi resolvido.
 *
 * ─── POR QUE PÁGINA E NÃO ROLAGEM INFINITA ───────────────────────────────
 *
 * Numa lista de movimentação de estoque, quem procura procura uma entrada
 * específica — "aquela compra de março". Rolagem infinita não tem endereço:
 * não dá pra voltar pro mesmo ponto, nem dizer a alguém onde olhar. Página 4
 * é um lugar; "role até achar" não é.
 */

export type Pagina<T> = {
  /** Os itens desta página. */
  itens: T[];
  /** Página atual, base 1. */
  atual: number;
  /** Total de páginas. Mínimo 1, mesmo com a lista vazia. */
  total: number;
  /** Total de itens, antes de fatiar. */
  itensNoTotal: number;
  /** Índice do primeiro item desta página, base 1. Zero se vazia. */
  primeiro: number;
  /** Índice do último. */
  ultimo: number;
  temAnterior: boolean;
  temProxima: boolean;
};

export const POR_PAGINA_PADRAO = 25;

/**
 * Fatia a lista.
 *
 * A página pedida é GRAMPEADA no intervalo válido em vez de devolver vazio:
 * pedir a página 9 de uma lista que encolheu pra 3 páginas mostra a 3, não uma
 * tela em branco. Uma lista que some depois de um filtro é indistinguível de
 * "não há nada aqui" — e é exatamente o que acontece quando alguém está na
 * página 5 e digita na busca.
 */
export function paginar<T>(itens: readonly T[], pagina: number, porPagina = POR_PAGINA_PADRAO): Pagina<T> {
  const tamanho = Math.max(Math.floor(porPagina) || POR_PAGINA_PADRAO, 1);
  const itensNoTotal = itens.length;
  const total = Math.max(Math.ceil(itensNoTotal / tamanho), 1);
  const atual = Math.min(Math.max(Math.floor(pagina) || 1, 1), total);

  const ini = (atual - 1) * tamanho;
  const fatia = itens.slice(ini, ini + tamanho);

  return {
    itens: fatia,
    atual,
    total,
    itensNoTotal,
    primeiro: fatia.length ? ini + 1 : 0,
    ultimo: ini + fatia.length,
    temAnterior: atual > 1,
    temProxima: atual < total,
  };
}

/**
 * Os números de página a mostrar, com reticências onde há corte.
 *
 * ─── POR QUE NÃO LISTAR TODAS ────────────────────────────────────────────
 *
 * Trinta botões de página ocupam duas linhas e ninguém clica no 17. O que se
 * usa é: a primeira, a última, e a vizinhança de onde se está — porque
 * navegar página a página é o gesto real, e pular pro fim é o segundo.
 *
 * `null` marca o corte; quem desenha põe "…" ali. Devolver a string "…" faria
 * o tipo virar `(number | string)[]`, e aí o componente teria que adivinhar se
 * "…" é um rótulo ou um número mal formatado.
 */
export function janelaDePaginas(atual: number, total: number, vizinhos = 1): (number | null)[] {
  if (total <= 1) return [1];

  const paginas = new Set<number>([1, total]);
  for (let p = atual - vizinhos; p <= atual + vizinhos; p += 1) {
    if (p >= 1 && p <= total) paginas.add(p);
  }

  const ordenadas = [...paginas].sort((a, b) => a - b);
  const saida: (number | null)[] = [];
  let anterior = 0;

  for (const p of ordenadas) {
    // Corte só quando há MAIS de uma página escondida: um "…" que esconde uma
    // página só gasta o mesmo espaço do número que ele substitui.
    if (anterior && p - anterior > 1) saida.push(p - anterior === 2 ? p - 1 : null);
    saida.push(p);
    anterior = p;
  }

  return saida;
}

/**
 * A frase que diz onde se está.
 *
 * "Página 3 de 12" sozinho não responde a pergunta que se faz olhando pra uma
 * lista longa, que é *quanto disso eu já vi*. Com o intervalo de itens, ela
 * responde.
 */
export function rotuloDaPagina<T>(p: Pagina<T>, unidade = "item"): string {
  if (p.itensNoTotal === 0) return `nenhum ${unidade}`;
  if (p.total === 1) return `${p.itensNoTotal} ${unidade}(s)`;
  return `${p.primeiro}–${p.ultimo} de ${p.itensNoTotal} ${unidade}(s) · página ${p.atual} de ${p.total}`;
}
