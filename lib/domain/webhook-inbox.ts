/**
 * Inbox das notificações do Mercado Livre — S07 da auditoria SaaS.
 *
 * ─── O CONTRATO DO ML ───────────────────────────────────────────────────
 *
 * Da página oficial de Notificações (developers.mercadolivre.com.br,
 * "produto-receba-notificacoes"): responder HTTP 200 em até 500 ms, senão o ML
 * pode DESATIVAR os tópicos; sem 200, ele retenta durante 1 hora (8
 * tentativas) e descarta. A própria página recomenda trabalhar com fila.
 *
 * A rota fazia tudo antes de responder: consultava o pedido na API do ML,
 * gravava, montava e publicava o push. Quando isso passava de 500 ms (e uma
 * chamada à API do ML sozinha passa), o ML via falha, retentava, e o tópico
 * corria risco de ser desligado — o app parava de saber das vendas em tempo
 * real sem erro nenhum aparecer.
 *
 * Agora a rota só valida, grava a notificação AQUI e responde. O trabalho
 * pesado roda depois da resposta, e o que falhar fica no inbox pra ser
 * retentado — por quem varrer o inbox, não pelo ML.
 *
 * ─── UM ITEM POR PEDIDO, NÃO POR NOTIFICAÇÃO ──────────────────────────────
 *
 * O ML manda só um ponteiro (`/orders/123`), e o processamento sempre busca o
 * estado ATUAL do pedido. Cinco notificações do mesmo pedido antes do
 * processamento são uma consulta só: o item coalesce.
 *
 * Mas não deduplica PRA SEMPRE: pedido recebe mudança legítima depois de
 * processado (pago, depois cancelado). Cada recebimento sobe a `geracao`; o
 * item concluído volta a pendente quando chega notificação nova, e quem
 * processou só marca `feito` se a geração não mudou enquanto trabalhava — a
 * notificação que chegou NO MEIO não se perde.
 *
 * ─── A CHAVE DA VARREDURA ────────────────────────────────────────────────
 *
 * `elegivelEm` é o único campo que a varredura consulta (`<= agora`): pendente
 * recebe o instante da próxima tentativa; processando recebe o fim da
 * concessão (processo que morreu volta a ser elegível sozinho); concluído,
 * descartado e esgotado APAGAM o campo e somem da consulta. Um campo só =
 * índice de campo único, que o Firestore cria sozinho — nada de índice
 * composto pra implantar à mão.
 */

export const TOPICO_PEDIDOS = "orders_v2";

/**
 * Concessão de quem processa. A rota do webhook tem `maxDuration` 30 s e o
 * trabalho roda dentro dela: 60 s garante que um processo vivo não perde o
 * item pra outro, e que um processo morto o devolve em um minuto.
 */
export const CONCESSAO_MS = 60_000;

/**
 * Espera antes de cada nova tentativa, em minutos. Depois da última, o item
 * vai pra fila de falhas (`falhou`) — visível, fora da varredura, e revivido
 * se o ML notificar o mesmo pedido de novo.
 */
export const ESPERAS_MIN = [1, 5, 15, 60, 180, 360] as const;
export const MAX_TENTATIVAS = ESPERAS_MIN.length;

export type EstadoItem = "pendente" | "processando" | "feito" | "descartado" | "falhou";

export type ItemInbox = {
  topic: string;
  orderId: string;
  sellerId: string;
  estado: EstadoItem;
  /** Sobe a cada notificação recebida. */
  geracao: number;
  recebidas: number;
  primeiraEm: number;
  ultimaEm: number;
  /** Tentativas de processamento que falharam desde o último sucesso. */
  tentativas: number;
  elegivelEm?: number | null;
  leaseDono?: string | null;
  /** A geração que o dono da concessão está processando. */
  geracaoEmProcesso?: number | null;
  ultimoErro?: string | null;
  /** O que o último processamento concluído decidiu (pra diagnóstico). */
  resultado?: string | null;
  concluidoEm?: number | null;
};

/** Marcador de "apague este campo" — quem grava traduz pra FieldValue.delete(). */
export const APAGAR = Symbol("apagar");
export type Alteracao = Record<string, unknown>;

/** O que gravar quando uma notificação válida chega. */
export function aoReceber(
  atual: ItemInbox | undefined,
  nova: { topic: string; orderId: string; sellerId: string },
  agora: number,
): Alteracao {
  if (!atual) {
    return {
      ...nova,
      estado: "pendente",
      geracao: 1,
      recebidas: 1,
      primeiraEm: agora,
      ultimaEm: agora,
      tentativas: 0,
      elegivelEm: agora,
    };
  }
  const base: Alteracao = {
    geracao: (Number(atual.geracao) || 0) + 1,
    recebidas: (Number(atual.recebidas) || 0) + 1,
    ultimaEm: agora,
    sellerId: nova.sellerId,
  };
  // Processando: não mexe. Quem processa vê a geração nova ao concluir e
  // devolve o item a pendente — assim não entram dois processos no mesmo item.
  if (atual.estado === "processando") return base;
  // Pendente (talvez esperando uma nova tentativa) ou já encerrado: notificação
  // nova é mudança nova no pedido — vale processar já. Encerrado volta a zero
  // tentativas: a falha antiga era de outro momento.
  return {
    ...base,
    estado: "pendente",
    elegivelEm: agora,
    ...(atual.estado === "pendente" ? {} : { tentativas: 0, ultimoErro: APAGAR }),
  };
}

/** Pode assumir o item? Pendente vencido, ou processando com a concessão vencida. */
export function podeReivindicar(atual: ItemInbox | undefined, agora: number): boolean {
  if (!atual) return false;
  // `typeof`, não `Number(...)`: Number(null) é 0, e um item sem elegibilidade
  // viraria elegível desde 1970.
  const elegivel = atual.elegivelEm;
  if (typeof elegivel !== "number" || !Number.isFinite(elegivel) || elegivel > agora) return false;
  return atual.estado === "pendente" || atual.estado === "processando";
}

export function aoReivindicar(atual: ItemInbox, dono: string, agora: number): Alteracao {
  return {
    estado: "processando",
    leaseDono: dono,
    geracaoEmProcesso: Number(atual.geracao) || 0,
    elegivelEm: agora + CONCESSAO_MS,
  };
}

export type Desfecho =
  /** Processado: o pedido foi gravado (ou não precisava). */
  | { tipo: "feito"; resultado: string }
  /** Nada a fazer, de forma definitiva: pedido de outro vendedor, sandbox. */
  | { tipo: "descartado"; resultado: string }
  /** Falhou e vale tentar de novo. */
  | { tipo: "falha"; erro: string };

/**
 * O que gravar ao terminar. `null` = não é mais o dono: outro processo assumiu
 * (a concessão venceu no meio) e o item é dele agora — não se toca.
 */
export function aoConcluir(atual: ItemInbox | undefined, dono: string, desfecho: Desfecho, agora: number): Alteracao | null {
  if (!atual || atual.estado !== "processando" || atual.leaseDono !== dono) return null;

  const soltar = { leaseDono: APAGAR, geracaoEmProcesso: APAGAR };
  const chegouNovaNoMeio = (Number(atual.geracao) || 0) !== (Number(atual.geracaoEmProcesso) || 0);

  if (desfecho.tipo === "falha") {
    const tentativas = (Number(atual.tentativas) || 0) + 1;
    const erro = desfecho.erro.slice(0, 300);
    if (tentativas >= MAX_TENTATIVAS && !chegouNovaNoMeio) {
      // Fila de falhas: fora da varredura, com o motivo à vista.
      return { ...soltar, estado: "falhou", tentativas, ultimoErro: erro, elegivelEm: APAGAR };
    }
    // Notificação nova no meio de uma falha: tenta já, a mudança é outra.
    const espera = chegouNovaNoMeio ? 0 : ESPERAS_MIN[Math.min(tentativas, MAX_TENTATIVAS) - 1] * 60_000;
    return { ...soltar, estado: "pendente", tentativas, ultimoErro: erro, elegivelEm: agora + espera };
  }

  if (chegouNovaNoMeio) {
    // O que processei já é velho: volta pra fila sem esperar.
    return { ...soltar, estado: "pendente", tentativas: 0, resultado: desfecho.resultado, elegivelEm: agora };
  }
  return {
    ...soltar,
    estado: desfecho.tipo,
    tentativas: 0,
    resultado: desfecho.resultado,
    concluidoEm: agora,
    ultimoErro: APAGAR,
    elegivelEm: APAGAR,
  };
}

/**
 * O pedido que o ML devolveu é mesmo NOSSO como vendedor?
 *
 * A notificação não prova nada (o ML não assina, e user_id no corpo é texto de
 * quem mandou). O que prova é o recurso canônico: o pedido consultado com o
 * nosso token. E consultar não basta — o token do vendedor também lê pedidos em
 * que a conta foi COMPRADORA, e um id desses numa notificação forjada gravaria
 * uma compra como venda. Sem vendedor no pedido, não há o que provar: descarta.
 */
export function pedidoEhDoVendedor(order: Record<string, unknown>, sellerId: string): boolean {
  const vendedor = (order.seller as Record<string, unknown> | undefined)?.id;
  if (vendedor === undefined || vendedor === null || String(vendedor).trim() === "") return false;
  return String(vendedor).trim() === String(sellerId).trim();
}

/** Id do documento do item — um por tópico e pedido. */
export function idDoItem(topic: string, orderId: string): string {
  return `${topic}:${orderId}`;
}
