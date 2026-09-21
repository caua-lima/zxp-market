/**
 * Por que a lista de estoque está vazia — porque "vazia" tem cinco significados.
 *
 * ─── O QUE ACONTECIA ────────────────────────────────────────────────────
 *
 * A aba abre na vista "Precisa de ação". Com todos os produtos saudáveis, essa
 * vista é vazia — e a tela dizia "Nenhum produto cadastrado. Clique em ＋ Novo
 * Produto", como se o estoque não existisse. O melhor cenário possível (nada
 * precisa de ação) era descrito como o pior (não há produto nenhum).
 *
 * Cada causa pede uma saída diferente, e por isso a mensagem tem que ser
 * diferente:
 *
 *   fonte-indisponivel — a lista de produtos não CHEGOU (permissão negada, cota).
 *                        Não dá pra afirmar que não há produto.
 *   sem-cadastro       — a fonte respondeu e não há produto. Saída: cadastrar.
 *   sem-pendencia      — há produtos e nenhum precisa de ação AGORA. É boa notícia;
 *                        a saída é ver todos, não cadastrar.
 *   sem-resultado      — busca ou filtro esconderam tudo. Saída: limpar.
 *   so-inativos        — só existem produtos inativos e eles estão escondidos.
 *                        Saída: mostrá-los.
 */

export type MotivoDaListaVazia =
  | "fonte-indisponivel" | "sem-cadastro" | "sem-pendencia" | "sem-resultado" | "so-inativos";

export function motivoDaListaVazia(a: {
  totalProdutos: number;
  vista: "acao" | "todos" | "movimentos";
  busca: string;
  /** Sinais de estoque ou logística escolhidos (não conta "incluir inativos", que só ADICIONA). */
  filtrosRestritivos: number;
  incluirInativos: boolean;
  totalInativos: number;
  /** A fonte de produtos falhou ou ainda não respondeu? */
  fonteIndisponivel: boolean;
}): MotivoDaListaVazia {
  if (a.totalProdutos === 0) return a.fonteIndisponivel ? "fonte-indisponivel" : "sem-cadastro";
  if (a.busca.trim() !== "" || a.filtrosRestritivos > 0) return "sem-resultado";
  if (!a.incluirInativos && a.totalInativos === a.totalProdutos) return "so-inativos";
  if (a.vista === "acao") return "sem-pendencia";
  return "sem-resultado";
}
