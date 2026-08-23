/**
 * Rateio do frete quando uma compra vira VÁRIOS pedidos.
 *
 * ─── O ERRO QUE ISTO CORRIGE ────────────────────────────────────────────
 *
 * Compra com produtos diferentes vira um PACOTE no Mercado Livre: uma venda
 * pro comprador, vários pedidos na API — e UM envio só. A API devolve o custo
 * daquele envio, e o sync gravava esse custo INTEIRO em cada pedido do pacote.
 * Somando pedido a pedido, o mesmo frete entrava duas, quatro, cinco vezes.
 *
 * Medido na conta, num único dia:
 *
 *   pacote com 5 pedidos · envio R$ 7,75 → o app somava R$ 38,75
 *   pacote com 4 pedidos · envio R$ 6,50 → o app somava R$ 26,00
 *   pacote com 2 pedidos · envio R$ 3,00 → o app somava R$  6,00
 *
 *   R$ 99,30 somados contra R$ 45,80 reais — R$ 53,50 de frete que não existe.
 *
 * Não é erro cosmético: era o que fazia o dia aparecer com margem NEGATIVA
 * (−2,7%) quando o resultado real era positivo. Decisão de preço tomada em
 * cima disso teria sido a decisão errada.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────
 *
 * O frete é do ENVIO, não do pedido. Cada envio entra uma vez, e o custo é
 * distribuído entre as unidades daquela compra — assim o total fecha e a
 * margem por produto continua carregando a fatia que lhe cabe.
 *
 * Puro: recebe os pedidos já lidos e devolve a fatia de cada um.
 */

export type PedidoComFrete = {
  orderId: string;
  /** Pacote do ML. Vazio/nulo = pedido avulso, é o próprio grupo. */
  packId?: string | null;
  /** Id do envio. Mais preciso que o pacote quando disponível. */
  shippingId?: string | null;
  /** Custo do ENVIO como a API devolveu (o mesmo valor repetido no pacote). */
  shippingCost: number;
  /** Unidades do pedido — base do rateio dentro do grupo. */
  unidades: number;
};

/**
 * O que agrupa pedidos do mesmo envio.
 *
 * `shippingId` tem prioridade porque é literalmente o envio. O `packId` cobre
 * o caso em que ele não foi persistido (o sync grava pack_id, mas não
 * shipping_id). Sem nenhum dos dois, o pedido é seu próprio grupo — que é o
 * comportamento correto pra venda avulsa e o mais conservador quando falta
 * informação: no máximo deixa de agrupar, nunca some com frete real.
 */
export function chaveDoEnvio(p: PedidoComFrete): string {
  const envio = String(p.shippingId ?? "").trim();
  if (envio) return `s:${envio}`;
  const pack = String(p.packId ?? "").trim();
  if (pack) return `p:${pack}`;
  return `o:${p.orderId}`;
}

export type RateioFrete = {
  /** orderId → fatia do frete que cabe àquele pedido. */
  porPedido: Map<string, number>;
  /** Soma correta: cada envio contado UMA vez. */
  total: number;
  /** Quanto seria somado no jeito antigo (pedido a pedido) — serve pro diagnóstico. */
  totalSemRateio: number;
  /** Quantos envios tinham mais de um pedido. */
  enviosCompartilhados: number;
};

export function ratearFretePorPedido(pedidos: PedidoComFrete[]): RateioFrete {
  const grupos = new Map<string, PedidoComFrete[]>();
  for (const p of pedidos) {
    const k = chaveDoEnvio(p);
    const arr = grupos.get(k) ?? [];
    arr.push(p);
    grupos.set(k, arr);
  }

  const porPedido = new Map<string, number>();
  let total = 0;
  let enviosCompartilhados = 0;

  for (const grupo of grupos.values()) {
    /**
     * Custo do envio = o MAIOR do grupo, não a soma.
     *
     * Num pacote a API repete o mesmo valor em todos os pedidos, então maior e
     * "qualquer um" dão o mesmo resultado. O maior é escolhido pro caso de um
     * pedido do grupo ainda não ter o custo buscado (0): pegar o primeiro
     * poderia pegar justamente o zero e perder o frete inteiro.
     */
    const custo = grupo.reduce((m, p) => Math.max(m, Math.max(Number(p.shippingCost) || 0, 0)), 0);
    total += custo;
    if (grupo.length > 1) enviosCompartilhados += 1;

    const unidades = grupo.reduce((s, p) => s + Math.max(Number(p.unidades) || 0, 0), 0);
    for (const p of grupo) {
      // Sem unidades conhecidas, divide igual entre os pedidos — melhor que
      // jogar tudo num só ou perder o custo.
      const fatia = unidades > 0
        ? custo * (Math.max(Number(p.unidades) || 0, 0) / unidades)
        : custo / grupo.length;
      porPedido.set(p.orderId, fatia);
    }
  }

  const totalSemRateio = pedidos.reduce((s, p) => s + Math.max(Number(p.shippingCost) || 0, 0), 0);
  return { porPedido, total, totalSemRateio, enviosCompartilhados };
}
