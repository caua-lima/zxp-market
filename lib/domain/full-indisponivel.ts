/**
 * Estoque que está NO Full mas não pode ser vendido.
 *
 * ─── POR QUE ISTO IMPORTA ───────────────────────────────────────────────
 *
 * `available_quantity` — o número que o app sempre mostrou como "Full" — conta
 * só o que está pronto pra vender. Unidade que chegou no centro e ficou retida
 * some do painel inteiro: não aparece como disponível (porque não está) e não
 * aparece como perda (porque ninguém contou). É estoque pago, parado e
 * invisível, e ele só aparece em `/inventories/{id}/stock/fulfillment`.
 *
 * O ML devolve o motivo em códigos crus (`transfer`, `damaged`, ...). Traduzir
 * não é enfeite: cada motivo pede uma AÇÃO diferente — transferência resolve
 * sozinha, avaria vira pedido de reembolso, e "não suportado" significa que
 * aquele item não devia estar no Full.
 */

export type StatusIndisponivel = {
  /** Rótulo em português. */
  label: string;
  /** O que fazer — vazio quando não há ação (o ML resolve sozinho). */
  acao: string;
  /** true quando são unidades provavelmente PERDIDAS (cabe reembolso). */
  perda: boolean;
};

/**
 * Códigos observados na API de Fulfillment do ML. Um código desconhecido NÃO
 * é escondido: cai no fallback e aparece com o nome cru, porque unidade retida
 * por motivo que não sabemos nomear continua sendo unidade retida.
 */
const CATALOGO: Record<string, StatusIndisponivel> = {
  transfer: {
    label: "Em transferência entre centros",
    acao: "Nada a fazer — o ML está movendo e elas voltam a vender no destino.",
    perda: false,
  },
  internal_process: {
    label: "Em processamento interno",
    acao: "Nada a fazer — conferência ou reetiquetagem do próprio centro.",
    perda: false,
  },
  in_review: {
    label: "Em revisão",
    acao: "Acompanhe: o ML está avaliando as unidades e o resultado pode virar avaria.",
    perda: false,
  },
  quality_check: {
    label: "Em controle de qualidade",
    acao: "Acompanhe: pode liberar ou virar avaria.",
    perda: false,
  },
  damaged: {
    label: "Avariado",
    acao: "Peça reembolso ao Mercado Livre — são unidades que você pagou e não vão vender.",
    perda: true,
  },
  lost: {
    label: "Perdido pelo ML",
    acao: "Peça reembolso ao Mercado Livre.",
    perda: true,
  },
  withdrawal: {
    label: "Em retirada",
    acao: "Você pediu de volta — acompanhe a devolução ao seu galpão.",
    perda: false,
  },
  not_supported: {
    label: "Não aceito no Full",
    acao: "Retire do centro: este item não pode ficar no Full e não vai vender parado lá.",
    perda: true,
  },
  expired: {
    label: "Vencido",
    acao: "Retire ou peça descarte — não volta a vender.",
    perda: true,
  },
};

export function traduzirStatusIndisponivel(status: string): StatusIndisponivel {
  const chave = String(status ?? "").trim().toLowerCase();
  return CATALOGO[chave] ?? {
    // Nome cru em vez de "outros": um motivo que não conhecemos ainda precisa
    // ser pesquisável pelo vendedor no Seller Center.
    label: chave ? `Retido (${chave})` : "Retido (motivo não informado)",
    acao: "Motivo não catalogado — confira no Seller Center o detalhe deste item.",
    perda: false,
  };
}

export type LinhaIndisponivel = { status: string; qtd: number };

/**
 * Unidades provavelmente perdidas (avaria, extravio, item não aceito). É o
 * subtotal que vira dinheiro a reclamar — separado do que só está em trânsito,
 * que se resolve sozinho e não deve virar alarme.
 */
export function unidadesComPerda(linhas: LinhaIndisponivel[]): number {
  return linhas.reduce((s, l) => s + (traduzirStatusIndisponivel(l.status).perda ? l.qtd : 0), 0);
}

/** Unidades retidas que voltam a vender sozinhas — trânsito, processo, revisão. */
export function unidadesEmTransito(linhas: LinhaIndisponivel[]): number {
  return linhas.reduce((s, l) => s + (traduzirStatusIndisponivel(l.status).perda ? 0 : l.qtd), 0);
}

/**
 * Valor imobilizado nas unidades retidas, ao custo médio do produto. Sem isso
 * "12 unidades" não diz nada sobre o tamanho do problema — R$ 160 parados diz.
 */
export function valorRetido(qtd: number, custoMedio: number): number {
  return Math.max(qtd, 0) * Math.max(custoMedio, 0);
}

/**
 * A unidade retida volta a vender SOZINHA, sem você fazer nada?
 *
 * ─── POR QUE ESTA PERGUNTA É DIFERENTE DE `perda` ───────────────────────
 *
 * `perda` responde "cabe reembolso?". Esta responde "posso contar com ela no
 * plano de reposição?", e as duas discordam num caso que importa:
 * **retirada**. Unidade em retirada não é perda — ela volta pro seu galpão —
 * mas também não volta a vender no Full. Contá-la como trânsito faria o plano
 * deixar de repor o que vai faltar.
 *
 * O desconhecido responde `false` de propósito: contar com uma unidade cujo
 * motivo não sabemos nomear é apostar que ela volta. Errar pra baixo aqui faz
 * comprar a mais; errar pra cima faz faltar produto — e falta de produto no
 * Full custa posição de anúncio, que não se recupera comprando depois.
 */
export function voltaAVenderSozinha(status: string): boolean {
  const chave = String(status ?? "").trim().toLowerCase();
  if (!(chave in CATALOGO)) return false;
  if (CATALOGO[chave].perda) return false;
  // Retirada não é perda e também não volta a vender: sai do Full pro seu galpão.
  return chave !== "withdrawal";
}

export type ComposicaoDoEstoque = {
  /** Pronto pra vender agora — o `available_quantity` do ML. */
  disponivel: number;
  /** Retido mas volta a vender sozinho: transferência, processo interno, revisão. */
  transito: number;
  /** Retido e NÃO volta a vender: retirada, e todo motivo não catalogado. */
  retidoSemVolta: number;
  /** Provavelmente perdido: avaria, extravio, item não aceito, vencido. */
  perdido: number;
  /**
   * Tudo que está fisicamente no centro, seja qual for o estado. É o número
   * que corresponde ao que você pagou — e o único que NUNCA deve alimentar
   * plano de compra.
   */
  fisico: number;
};

/**
 * Separa o estoque do Full nos estados que pedem decisões diferentes.
 *
 * ─── O NÚMERO QUE O APP MOSTRAVA ────────────────────────────────────────
 *
 * Um só: `available_quantity`, chamado de "Full". Ele é o DISPONÍVEL, e a aba
 * de Estoque o tratava como se fosse o físico — inclusive no plano de
 * reposição, que decide quanto comprar.
 *
 * Os dois erros que isso produz andam em direções opostas, e é por isso que
 * nenhum número único resolve:
 *
 *   · tratar disponível como físico faz COMPRAR A MAIS: as unidades em
 *     transferência entre centros já estão pagas e vão voltar a vender.
 *   · tratar físico como disponível faz FALTAR PRODUTO: o avariado e o
 *     vencido estão lá, contam no que você pagou, e não vão vender nunca.
 */
export function composicaoDoEstoque(disponivel: number, linhas: LinhaIndisponivel[]): ComposicaoDoEstoque {
  let transito = 0, retidoSemVolta = 0, perdido = 0;

  for (const l of linhas) {
    const qtd = Math.max(Number(l.qtd) || 0, 0);
    if (qtd === 0) continue;
    if (traduzirStatusIndisponivel(l.status).perda) perdido += qtd;
    else if (voltaAVenderSozinha(l.status)) transito += qtd;
    else retidoSemVolta += qtd;
  }

  const disp = Math.max(Number(disponivel) || 0, 0);
  return { disponivel: disp, transito, retidoSemVolta, perdido, fisico: disp + transito + retidoSemVolta + perdido };
}

/**
 * O número que o plano de reposição deve usar: o que vai estar vendável.
 *
 * Disponível mais trânsito, e nada além. Não é o físico — avaria e vencido
 * nunca voltam a vender, e contá-los faria o plano deixar de repor o que já
 * está faltando. Não é só o disponível — a unidade que o ML está movendo
 * entre centros já foi paga, e comprá-la de novo é comprar duas vezes o mesmo
 * estoque.
 */
export function baseDaReposicao(c: ComposicaoDoEstoque): number {
  return c.disponivel + c.transito;
}

/**
 * O plano de reposição pode ser calculado com confiança?
 *
 * Só quando o detalhe por status veio. Sem ele, a composição é `disponivel`
 * com o resto zerado — que é indistinguível de "nada retido" e não é a mesma
 * coisa. A tela precisa saber a diferença pra não afirmar um plano que se
 * apoia num detalhe que não chegou.
 */
export function composicaoCompleta(detalheVeio: boolean, c: ComposicaoDoEstoque): boolean {
  return detalheVeio || c.fisico === c.disponivel;
}
