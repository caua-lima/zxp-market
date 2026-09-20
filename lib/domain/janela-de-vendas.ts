/**
 * A janela de vendas rápidas — o que decide quando 4+ vendas viram um resumo.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * O contador vivia num documento único que só somava. Três problemas:
 *
 *  1. A 4ª venda disparava o resumo ("4 vendas") e as seguintes só
 *     incrementavam — o resumo ficava estacionado em quatro enquanto a rajada
 *     continuava, e nada dizia o número final.
 *  2. Não era idempotente. Um retry da MESMA venda (o ML reenvia, o sync
 *     reencontra o pedido) contava como uma venda nova: dez vendas com retry
 *     viravam vinte, e o resumo mentia.
 *  3. A decisão não era guardada. Uma venda suprimida por agrupamento, ao
 *     ser reprocessada, voltava pelo ramo "individual" e reaparecia como push
 *     avulso; um resumo que falhou era reenviado como individual. E a `tag` do
 *     resumo vinha de `Date.now()/90000` — um relógio que nada tem a ver com a
 *     janela: duas metades da mesma rajada podiam ganhar tags diferentes e
 *     empilhar duas notificações.
 *
 * ─── A POLÍTICA (explícita, como pede a auditoria) ──────────────────────
 *
 *  - As 3 primeiras vendas da janela saem uma a uma, pra quem não agrupa e
 *    pra quem agrupa: a rajada só existe a partir da 4ª.
 *  - A partir da 4ª, QUEM AGRUPA recebe o resumo em vez do aviso individual;
 *    quem não agrupa segue recebendo cada venda.
 *  - O resumo sai na 4ª venda ("abertura") e, se a rajada continuou, é
 *    ATUALIZADO no fim da janela com o número final ("fechamento") — mesma
 *    `tag`, então o aparelho substitui em vez de empilhar.
 *  - O resumo é um RELATO da rajada ("4 vendas em 2 min"), não anuncia "novas
 *    vendas": as três primeiras já foram avisadas uma a uma e contá-las como
 *    novas seria contar duas vezes.
 *  - A janela é FIXA: começa na 1ª venda e dura JANELA_MS. Não desliza — uma
 *    janela que estica a cada venda nunca fecha numa loja movimentada.
 *
 * Tudo aqui é puro: o estado entra e sai como argumento, e a transação que o
 * persiste fica em lib/notification-janelas.ts.
 */

export const JANELA_MS = 90_000;
/** A partir da N-ésima venda da janela, vira rajada. */
export const LIMIAR_AGRUPAMENTO = 4;

export type MembroDaJanela = { n: number; gross: number };

export type JanelaDeVendas = {
  id: string;
  inicio: number;
  fim: number;
  /** eventId → posição na janela. É o que torna o registro idempotente. */
  membros: Record<string, MembroDaJanela>;
};

export type DecisaoNaJanela = {
  janelaId: string;
  /** Posição desta venda na janela (1 = a primeira). */
  n: number;
  /** "agrupada" = a partir da 4ª: quem agrupa recebe resumo em vez do aviso avulso. */
  modo: "individual" | "agrupada";
  /** Quantas vendas a janela tem AGORA e o faturamento delas. */
  totalNaJanela: number;
  grossNaJanela: number;
  fim: number;
  /** É esta venda que abre a rajada? (dispara o resumo de abertura) */
  abre: boolean;
  /** A rajada passou de quatro? (existe resumo de fechamento a atualizar) */
  precisaDeFechamento: boolean;
};

function decisaoDe(j: JanelaDeVendas, n: number): DecisaoNaJanela {
  const membros = Object.values(j.membros);
  return {
    janelaId: j.id,
    n,
    modo: n >= LIMIAR_AGRUPAMENTO ? "agrupada" : "individual",
    totalNaJanela: membros.length,
    grossNaJanela: membros.reduce((s, m) => s + m.gross, 0),
    fim: j.fim,
    abre: n === LIMIAR_AGRUPAMENTO,
    precisaDeFechamento: membros.length > LIMIAR_AGRUPAMENTO,
  };
}

/**
 * Registra a venda na janela e devolve a decisão. IDEMPOTENTE: registrar o mesmo
 * `eventId` de novo devolve a MESMA posição, sem contar outra venda.
 *
 * @param atual a janela em curso (ou `null`); pode já ter vencido.
 */
export function registrarNaJanela(
  atual: JanelaDeVendas | null,
  venda: { eventId: string; gross: number },
  agora: number,
): { janela: JanelaDeVendas; decisao: DecisaoNaJanela; jaEstava: boolean } {
  const gross = Number.isFinite(venda.gross) ? venda.gross : 0;

  if (atual && atual.membros[venda.eventId]) {
    return { janela: atual, decisao: decisaoDe(atual, atual.membros[venda.eventId].n), jaEstava: true };
  }

  if (atual && agora < atual.fim) {
    const n = Object.keys(atual.membros).length + 1;
    const janela: JanelaDeVendas = { ...atual, membros: { ...atual.membros, [venda.eventId]: { n, gross } } };
    return { janela, decisao: decisaoDe(janela, n), jaEstava: false };
  }

  const janela: JanelaDeVendas = {
    id: String(agora),
    inicio: agora,
    fim: agora + JANELA_MS,
    membros: { [venda.eventId]: { n: 1, gross } },
  };
  return { janela, decisao: decisaoDe(janela, 1), jaEstava: false };
}

/** Quantos minutos a rajada dura, pra frase do resumo. Nunca menos de 1. */
export function minutosDaJanela(j: Pick<JanelaDeVendas, "inicio" | "fim">): number {
  return Math.max(1, Math.round((j.fim - j.inicio) / 60_000));
}

/** Os ids dos dois pushes de resumo de uma janela. Determinísticos: publicar de novo é idempotente. */
export function idsDoResumo(janelaId: string): { abertura: string; fechamento: string; tag: string } {
  return {
    abertura: `resumo:${janelaId}:abertura`,
    fechamento: `resumo:${janelaId}:fechamento`,
    // Um identificador da JANELA, não do relógio: é o que faz o aparelho substituir a notificação.
    tag: `sales-summary-${janelaId}`,
  };
}
