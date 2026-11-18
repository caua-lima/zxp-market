import { CODIGO_PACOTE_SEPARADO } from "./separacao-pacote";

/**
 * "Esta venda valeu?" — a pergunta que decide se um pedido entra no faturamento.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * O faturamento líquido fechava ABAIXO do "Vendas brutas" do Seller Center, e
 * a decomposição foi exata:
 *
 *     app bruto 15.654,70 − ML 15.307,00 = 347,70   ← o que o ML de fato cancelou
 *     ML 15.307,00 − app líquido 14.946,72 = 360,28 ← o que o app cancelou A MAIS
 *     347,70 + 360,28 = 707,98 = "vendas canceladas" do app
 *
 * Ou seja: o app descontava ~R$ 360 de pedidos que o Mercado Livre continua
 * contando como venda boa. A causa é ter DUAS fontes para o mesmo sinal:
 *
 *   1. `status` do pedido, lido ao vivo do ML — autoritativo.
 *   2. a coleção `ml_returns`, alimentada por um sync que consulta
 *      `order.status=cancelled` e só ESCREVE. Nada nunca remove um pedido de
 *      lá. Um pedido que apareceu cancelado uma vez (cancelamento revertido,
 *      disputa ganha, estado transitório do ML) fica marcado para sempre — e
 *      seguia sendo descontado meses depois, mesmo com o ML já dizendo "paid".
 *
 * A regra que sai disso: **o status ao vivo manda**. `ml_returns` vira o que
 * sempre deveria ter sido — um cache, útil só quando não temos status.
 *
 * Devolução é outra história e continua vindo de `ml_returns`: ela nasce de um
 * claim pós-venda, que NÃO aparece no status do pedido. Só o cancelamento
 * tinha fonte duplicada.
 */

/**
 * ─── PEDIDO SUBSTITUÍDO (separação de envio) ────────────────────────────
 *
 * Quando o vendedor separa o envio de uma compra com 2+ unidades — prática
 * normal em agência, porque cada pacote ganha etiqueta própria e o produto vai
 * no próprio saco em vez de numa caixa — o Mercado Livre NÃO edita o pedido:
 * ele CANCELA o original e cria pedidos novos, unitários, no mesmo pacote.
 *
 * Para o ML isso nunca foi uma venda cancelada: é a mesma compra, reorganizada.
 * O painel dele conta só os pedidos novos. O app contava os três — o original
 * no faturamento bruto E nas vendas canceladas, mais os dois novos — inflando
 * o bruto pelo valor da compra e o total de "canceladas" junto.
 *
 * O que separa este caso de um cancelamento de verdade é o PACOTE (`pack_id`):
 * o pack é a compra, os pedidos são os envios dela. Se o pacote tem pedido
 * cancelado E pedido válido, a compra sobreviveu — o cancelado foi só
 * substituído. Se TODOS os pedidos do pacote estão cancelados, aí a compra
 * caiu de verdade e continua contando como cancelamento.
 *
 * Limite conhecido: numa compra de produtos diferentes em que o comprador
 * cancela só um deles, aquele item também cai aqui e deixa de aparecer no KPI
 * de "Vendas canceladas". O faturamento líquido continua certo (o valor sai
 * dos dois lados), e a contagem é exposta na Conferência — some do alerta,
 * não do número.
 */
export type PedidoParaSubstituicao = {
  orderId: string;
  /** Identificador do pacote/compra no ML. Vazio ou nulo = pedido avulso. */
  packId?: string | null;
  status: unknown;
  /**
   * Comprador e dia BR. Sem `pack_id` reaproveitado, é o único jeito de ligar
   * o pedido cancelado aos que nasceram no lugar dele — ver a 2ª regra abaixo.
   */
  buyerId?: string | null;
  dia?: string;
  /** Itens do pedido, pra provar que os novos cobrem o que o cancelado tinha. */
  itens?: { itemId: string; qty: number }[];
  /**
   * `cancel_detail.code` do ML. "pack_splitted" é a prova direta da separação
   * (ver lib/domain/separacao-pacote.ts) — vale antes das regras por dedução.
   */
  motivoCancelamento?: string | null;
};

/**
 * Quantos dias o pedido substituto pode nascer depois do cancelado.
 *
 * 3 dias cobre "cancelou hoje, despachou depois do fim de semana" sem virar
 * uma janela larga o bastante pra confundir com recompra do mesmo cliente.
 */
export const JANELA_SUBSTITUICAO_DIAS = 3;

/** Diferença em dias entre dois dias BR (YYYY-MM-DD). null se algum não for válido. */
function diffEmDias(de: string, para: string): number | null {
  const a = Date.parse(`${de}T00:00:00Z`);
  const b = Date.parse(`${para}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Soma as unidades por item_id de um conjunto de pedidos. */
function unidadesPorItem(pedidos: PedidoParaSubstituicao[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pedidos) {
    for (const it of p.itens ?? []) {
      const id = String(it.itemId ?? "").trim().toUpperCase();
      if (!id) continue;
      m.set(id, (m.get(id) ?? 0) + Math.max(Number(it.qty) || 0, 0));
    }
  }
  return m;
}

/**
 * Ids dos pedidos cancelados que na verdade foram SUBSTITUÍDOS por outros —
 * não devem contar nem como faturamento nem como cancelamento.
 *
 * ─── DUAS REGRAS, PORQUE O PACK_ID NÃO BASTA ────────────────────────────
 *
 * A primeira versão disto olhava só o `pack_id`, apostando que o Mercado
 * Livre reaproveitaria o pacote ao recriar os pedidos. Nem sempre reaproveita:
 * medido contra o Seller Center, ~12 pedidos por mês continuavam sendo
 * contados como cancelamento aqui e como venda boa lá — R$ 499,59 de
 * diferença num único mês.
 *
 * Por isso a 2ª regra, deliberadamente ESTREITA: o cancelado só é considerado
 * substituído se existirem pedidos válidos do MESMO comprador, no MESMO dia,
 * cobrindo TODOS os itens dele em quantidade igual ou maior. Exigir cobertura
 * completa é o que impede confundir com um cancelamento seguido de uma compra
 * diferente.
 *
 * Mesmo se a regra errar e capturar um cancelamento real seguido de recompra,
 * o faturamento líquido continua certo: o valor sai do cancelado e entra pelo
 * pedido novo. O que se perde é o registro no KPI de canceladas — e é
 * exatamente assim que o painel do ML se comporta.
 */
export function detectarPedidosSubstituidos(pedidos: PedidoParaSubstituicao[]): Set<string> {
  // pacote → tem algum pedido que sobreviveu?
  const pacoteTemValido = new Map<string, boolean>();
  for (const p of pedidos) {
    const pack = String(p.packId ?? "").trim();
    if (!pack) continue; // sem pacote não há substituição a detectar
    if (!ehStatusNaoVenda(p.status)) pacoteTemValido.set(pack, true);
    else if (!pacoteTemValido.has(pack)) pacoteTemValido.set(pack, false);
  }

  // comprador → pedidos VÁLIDOS dele, pra 2ª regra.
  const validosPorComprador = new Map<string, PedidoParaSubstituicao[]>();
  for (const p of pedidos) {
    if (ehStatusNaoVenda(p.status)) continue;
    const comprador = String(p.buyerId ?? "").trim();
    if (!comprador || !String(p.dia ?? "").trim()) continue;
    const arr = validosPorComprador.get(comprador) ?? [];
    arr.push(p);
    validosPorComprador.set(comprador, arr);
  }

  const substituidos = new Set<string>();
  for (const p of pedidos) {
    if (!ehStatusNaoVenda(p.status)) continue;

    // Regra 0 — o próprio ML disse: cancelado porque o pacote foi separado.
    // Não depende de achar os pedidos novos (eles nascem com outro pack_id e,
    // muitas vezes, em outro dia).
    if (String(p.motivoCancelamento ?? "").trim() === CODIGO_PACOTE_SEPARADO) {
      substituidos.add(String(p.orderId));
      continue;
    }

    // 1ª regra — pacote sobreviveu.
    const pack = String(p.packId ?? "").trim();
    if (pack && pacoteTemValido.get(pack)) {
      substituidos.add(String(p.orderId));
      continue;
    }

    // 2ª regra — mesmo comprador, mesmo dia, itens cobertos.
    const comprador = String(p.buyerId ?? "").trim();
    const dia = String(p.dia ?? "").trim();
    const itensCancelado = p.itens ?? [];
    if (!comprador || !dia || itensCancelado.length === 0) continue;

    const todosDoComprador = validosPorComprador.get(comprador);
    if (!todosDoComprador || todosDoComprador.length === 0) continue;

    /**
     * Janela PRA FRENTE, não "mesmo dia".
     *
     * A separação do envio não acontece na compra — acontece na hora de
     * despachar, que costuma ser no dia seguinte ou no outro. Como o ML só
     * cancela e recria NAQUELE momento, os pedidos novos nascem DEPOIS do
     * original. Exigir mesmo dia deixava passar justamente o caso comum.
     *
     * Só pra frente, de propósito: um pedido válido ANTERIOR não pode ser a
     * substituição de um cancelamento que ainda não aconteceu — aceitar isso
     * abriria a porta pra apagar cancelamento real de comprador recorrente.
     */
    const validos = todosDoComprador.filter((v) => {
      const d = diffEmDias(dia, String(v.dia ?? ""));
      return d != null && d >= 0 && d <= JANELA_SUBSTITUICAO_DIAS;
    });
    if (validos.length === 0) continue;

    const disponivel = unidadesPorItem(validos);
    const cobreTudo = itensCancelado.every((it) => {
      const id = String(it.itemId ?? "").trim().toUpperCase();
      if (!id) return false;
      return (disponivel.get(id) ?? 0) >= Math.max(Number(it.qty) || 0, 0);
    });
    if (cobreTudo) substituidos.add(String(p.orderId));
  }
  return substituidos;
}

export type ClassificacaoVenda =
  /** Cancelado só no papel: substituído por outro pedido do mesmo pacote. Não conta em lugar nenhum. */
  | "substituida"
  /** Não é venda: cancelada/inválida. Fica no bruto, sai do líquido e do lucro. */
  | "cancelada"
  /** Venda revertida por devolução concluída: produto volta ao estoque, 0 a 0. */
  | "devolvida"
  /** Venda que valeu. */
  | "valida";

/** Status do ML que significam "esta venda não aconteceu". */
export function ehStatusNaoVenda(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "cancelled" || s === "invalid";
}

/** O pedido trouxe um status utilizável? String vazia = não sabemos. */
export function temStatusConfiavel(status: unknown): boolean {
  return String(status ?? "").trim() !== "";
}

export type EntradaClassificacao = {
  /** `status` do pedido como o ML devolveu. */
  status: unknown;
  /** O pedido está marcado como cancelado no cache `ml_returns`. */
  noCacheDeCancelados: boolean;
  /** O pedido tem devolução CONCLUÍDA em `ml_returns`. */
  temDevolucaoConcluida: boolean;
  /**
   * O pedido foi cancelado apenas para ser substituído por outros do mesmo
   * pacote (separação de envio) — ver detectarPedidosSubstituidos.
   */
  substituidoNoPacote?: boolean;
};

export type ResultadoClassificacao = {
  classe: ClassificacaoVenda;
  /**
   * true quando o cache dizia "cancelada" mas o status ao vivo diz que a venda
   * vale. É o caso que inflava o total de canceladas — contabilizado e
   * exposto na conferência, nunca corrigido em silêncio.
   */
  resgatadoDoCache: boolean;
};

export function classificarVenda(e: EntradaClassificacao): ResultadoClassificacao {
  const statusConfiavel = temStatusConfiavel(e.status);

  /**
   * 0. Substituído no pacote vem ANTES de tudo: o pedido está cancelado de
   * verdade no ML, então qualquer regra baseada em status o trataria como
   * cancelamento. Mas o valor dele já está nos pedidos novos — contar aqui
   * seria contar a mesma compra duas vezes.
   */
  if (e.substituidoNoPacote && ehStatusNaoVenda(e.status)) {
    return { classe: "substituida", resgatadoDoCache: false };
  }

  // 1. Status ao vivo dizendo "cancelada" é definitivo.
  if (ehStatusNaoVenda(e.status)) return { classe: "cancelada", resgatadoDoCache: false };

  // 2. Cache diz cancelada, mas o ML diz que a venda está de pé.
  //    O ML é a fonte; sem isto, um cancelamento revertido nunca voltava.
  if (e.noCacheDeCancelados && statusConfiavel) {
    // A devolução ainda vale: ela vem de claim, sinal que o status não carrega.
    if (e.temDevolucaoConcluida) return { classe: "devolvida", resgatadoDoCache: true };
    return { classe: "valida", resgatadoDoCache: true };
  }

  // 3. Sem status utilizável, o cache é tudo que temos.
  if (e.noCacheDeCancelados) return { classe: "cancelada", resgatadoDoCache: false };

  // 4. Devolução concluída reverte a venda (produto volta ao estoque).
  if (e.temDevolucaoConcluida) return { classe: "devolvida", resgatadoDoCache: false };

  return { classe: "valida", resgatadoDoCache: false };
}
