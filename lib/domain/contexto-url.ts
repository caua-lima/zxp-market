/**
 * O que a URL precisa carregar pra que voltar, avançar e recarregar funcionem.
 *
 * ─── O QUE HAVIA ─────────────────────────────────────────────────────────
 *
 * A URL era lida UMA vez, na primeira montagem, e nunca escrita de volta. O
 * comentário no código dizia isso com todas as letras — "depois disso a
 * navegação é sempre por estado local" — e as consequências eram três, todas
 * visíveis no uso diário:
 *
 *   · recarregar a página jogava a pessoa de volta no Dashboard, de qualquer
 *     aba em que estivesse;
 *   · o botão Voltar do navegador SAÍA DO APP, porque nenhuma navegação
 *     interna tinha criado entrada no histórico;
 *   · não dava pra mandar "olha a DRE de agosto" pra alguém. Todo link
 *     apontava pro mesmo lugar.
 *
 * ─── O QUE ENTRA NA URL, E O QUE NÃO ─────────────────────────────────────
 *
 * Só o que alguém quereria reencontrar ou mandar pra outra pessoa: a aba, o
 * período, os filtros e o item aberto. Estado de rolagem, painel expandido e
 * ordenação de tabela ficam de fora — enchem a barra de endereço e ninguém
 * manda um link pra mostrar por qual coluna a tabela estava ordenada.
 *
 * Valor igual ao padrão é OMITIDO. Uma URL cheia de `?tab=dashboard&dias=30`
 * quando é tudo padrão vira ruído, e ruído faz a parte que importa passar
 * despercebida.
 */

export type ContextoUrl = {
  /** A aba ativa. `null` = a padrão. */
  aba: string | null;
  /** Início do período, ISO. */
  de: string | null;
  /** Fim do período, ISO. */
  ate: string | null;
  /**
   * Filtros da tela, já como texto curto. Cada tela decide o vocabulário; o
   * que esta função garante é que eles sobrevivem ao recarregar.
   */
  filtros: string[];
  /**
   * Item aberto — pedido, tarefa, produto. Sobrevive ao recarregar de
   * propósito: quem manda o link quer que o outro caia no MESMO item.
   */
  item: string | null;
  /** Que tipo de item é o de cima, pra tela saber qual painel abrir. */
  tipoDoItem: string | null;
};

export const CONTEXTO_VAZIO: ContextoUrl = {
  aba: null, de: null, ate: null, filtros: [], item: null, tipoDoItem: null,
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lê o contexto de uma query string.
 *
 * Tolerante de propósito: uma URL editada à mão, truncada por um aplicativo
 * de mensagem ou vinda de uma versão antiga do app tem que abrir o app, não
 * quebrá-lo. Valor que não dá pra entender é ignorado — nunca lançado.
 */
export function lerContexto(query: string | URLSearchParams, abasValidas: readonly string[]): ContextoUrl {
  const p = typeof query === "string" ? new URLSearchParams(query.startsWith("?") ? query.slice(1) : query) : query;

  const aba = p.get("tab");
  const de = p.get("de");
  const ate = p.get("ate");

  /**
   * Os nomes antigos continuam sendo lidos. Um link de notificação já enviado
   * — `?tab=pedidos&order=123` — está no celular de alguém e tem que abrir.
   * Escrever, a partir daqui, é só no formato novo.
   */
  const pedido = p.get("order");
  const tarefa = p.get("task");

  let item: string | null = null;
  let tipoDoItem: string | null = null;
  if (p.get("item")) { item = p.get("item"); tipoDoItem = p.get("tipo"); }
  else if (pedido) { item = pedido; tipoDoItem = "pedido"; }
  else if (tarefa) { item = tarefa; tipoDoItem = "tarefa"; }

  return {
    aba: aba && abasValidas.includes(aba) ? aba : null,
    // Data que não é ISO é descartada em silêncio: melhor abrir no período
    // padrão do que numa janela inventada a partir de lixo.
    de: de && ISO.test(de) ? de : null,
    ate: ate && ISO.test(ate) ? ate : null,
    filtros: (p.get("f") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    item,
    tipoDoItem,
  };
}

/**
 * Monta a query string do contexto, omitindo tudo que é padrão.
 *
 * Devolve string vazia quando não há nada a dizer — e quem chama usa isso pra
 * escrever "/" em vez de "/?", que fica feio na barra e duplica no histórico.
 */
export function escreverContexto(ctx: ContextoUrl, abaPadrao: string): string {
  const p = new URLSearchParams();

  if (ctx.aba && ctx.aba !== abaPadrao) p.set("tab", ctx.aba);
  // As duas datas andam juntas: só metade do período não reconstrói nada.
  if (ctx.de && ctx.ate) { p.set("de", ctx.de); p.set("ate", ctx.ate); }
  if (ctx.filtros.length) p.set("f", ctx.filtros.join(","));
  if (ctx.item) {
    p.set("item", ctx.item);
    if (ctx.tipoDoItem) p.set("tipo", ctx.tipoDoItem);
  }

  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Esta mudança merece uma entrada nova no histórico, ou substitui a atual?
 *
 * ─── A REGRA, E POR QUE ELA IMPORTA ──────────────────────────────────────
 *
 * Trocar de aba é navegar: quem for pra DRE e apertar Voltar espera voltar
 * pro Dashboard, não sair do app.
 *
 * Mexer num filtro, não. Quem ajusta seis filtros e aperta Voltar espera
 * voltar pra tela anterior — e não desfazer os filtros um por um, seis vezes.
 * Empilhar cada ajuste transformaria o botão Voltar num Desfazer, que é outra
 * coisa e ninguém pediu.
 *
 * Abrir um item empilha: fechar com Voltar é o gesto natural, principalmente
 * no celular, onde é o gesto de deslizar da borda.
 */
export function ehNavegacao(anterior: ContextoUrl, novo: ContextoUrl): boolean {
  if (anterior.aba !== novo.aba) return true;
  if ((anterior.item ?? null) !== (novo.item ?? null)) return true;
  return false;
}

/** Dois contextos apontam pro mesmo lugar? Evita entrada duplicada no histórico. */
export function mesmoContexto(a: ContextoUrl, b: ContextoUrl): boolean {
  return a.aba === b.aba
    && a.de === b.de
    && a.ate === b.ate
    && a.item === b.item
    && a.tipoDoItem === b.tipoDoItem
    && a.filtros.length === b.filtros.length
    && a.filtros.every((f, i) => f === b.filtros[i]);
}

/** O mínimo do `window.history` que a sincronização usa. */
export type HistoricoMinimo = {
  pushState: (estado: unknown, titulo: string, url: string) => void;
  replaceState: (estado: unknown, titulo: string, url: string) => void;
};

/**
 * Escreve o contexto na barra de endereços.
 *
 * ─── POR QUE ISTO É UMA FUNÇÃO E NÃO CÓDIGO SOLTO NO EFEITO ──────────────
 *
 * A escolha entre empilhar e substituir é a parte que pode estar errada, e
 * dentro de um `useEffect` de um componente que só monta depois do login ela
 * seria impossível de testar — foi por não dar pra testar que a URL ficou
 * anos sem ser escrita de volta.
 *
 * Aqui `historico` é um parâmetro, então o teste passa um objeto que anota o
 * que foi chamado. O efeito do React fica com uma linha: chamar isto.
 *
 * Devolve o que fez, pra quem chama poder atualizar a referência do último
 * contexto só quando algo de fato mudou.
 */
export function sincronizarUrl(args: {
  historico: HistoricoMinimo;
  caminho: string;
  anterior: ContextoUrl;
  atual: ContextoUrl;
  abaPadrao: string;
}): { acao: "empilhou" | "substituiu" | "nada"; url: string } {
  const { historico, caminho, anterior, atual, abaPadrao } = args;

  // Nada mudou: escrever geraria entrada duplicada e, com pushState, faria o
  // botão Voltar precisar de dois toques pra sair do mesmo lugar.
  if (mesmoContexto(anterior, atual)) return { acao: "nada", url: caminho };

  const url = `${caminho}${escreverContexto(atual, abaPadrao)}`;
  if (ehNavegacao(anterior, atual)) {
    historico.pushState(null, "", url);
    return { acao: "empilhou", url };
  }
  historico.replaceState(null, "", url);
  return { acao: "substituiu", url };
}
