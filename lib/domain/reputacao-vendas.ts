import { chaveDoEnvio } from "./frete-pacote";

/**
 * O bloco "Acompanhamos suas vendas nos últimos 60 dias" do Seller Center.
 *
 * ─── AS QUATRO DEFINIÇÕES, MEDIDAS CONTRA O PAINEL ──────────────────────
 *
 * Cada número tem uma definição própria, e três das quatro NÃO são o que
 * parecem. Medido contra a conta em 22/08/2026 (painel: 750 / 696 / 727 /
 * R$ 33.377), com a janela batendo exata em "23 de jun":
 *
 *   Vendas      = todos os pedidos, inclusive cancelados
 *   Com Envios  = ENVIOS DISTINTOS, não pedidos com envio
 *   Concluídas  = pedidos não cancelados
 *   Faturado    = soma dos não cancelados
 *
 * O "Com Envios" foi o que revelou a regra: 762 pedidos tinham envio, mas o
 * painel mostrava 696. Deduplicando por envio dá 682 — e a diferença de 14
 * para o painel é a mesma ordem das vendas que entraram depois do print. É a
 * MESMA natureza do erro de frete que inflava a margem: um pacote tem vários
 * pedidos e UM envio só (ver frete-pacote.ts).
 *
 * ─── POR QUE ISTO PRECISA DE DADO AO VIVO ───────────────────────────────
 *
 * O banco não serve: o sync cobre mês atual + anterior, e uma janela de 60
 * dias alcança o mês retrasado. Medido — junho tinha ZERO pedidos gravados, e
 * a conta fechava 691 contra 750 do painel. Quem chama precisa buscar do ML.
 */

export type PedidoParaReputacao = {
  status?: unknown;
  shippingId?: string | null;
  packId?: string | null;
  orderId: string;
  total: number;
  /**
   * Dia do pedido no fuso de Sao Paulo, yyyy-mm-dd. So a serie diaria usa —
   * os agregados nao precisam, e por isso e opcional.
   */
  dia?: string | null;
};

/** Um dia da serie: o que aquele dia produziu, sozinho. */
export type DiaDeVendas = {
  dia: string;
  concluidas: number;
  faturado: number;
};

export type BlocoVendas = {
  /** Todos os pedidos da janela, inclusive cancelados. */
  vendas: number;
  /** Envios distintos — um pacote com 5 pedidos conta 1. */
  comEnvios: number;
  /** Pedidos que não foram cancelados. */
  concluidas: number;
  /** Faturamento das concluídas. */
  faturado: number;
};

function ehCancelado(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "cancelled" || s === "invalid";
}

export function montarBlocoVendas(pedidos: PedidoParaReputacao[]): BlocoVendas {
  const envios = new Set<string>();
  let concluidas = 0;
  let faturado = 0;

  for (const p of pedidos) {
    // Só entra na contagem de envios quem TEM envio: pedido sem envio não é
    // "um envio a menos", é um pedido de outra natureza (retirada, digital).
    if (String(p.shippingId ?? "").trim()) {
      envios.add(chaveDoEnvio({
        orderId: p.orderId,
        shippingId: p.shippingId,
        packId: p.packId,
        shippingCost: 0,
        unidades: 0,
      }));
    }
    if (ehCancelado(p.status)) continue;
    concluidas += 1;
    faturado += Math.max(Number(p.total) || 0, 0);
  }

  return { vendas: pedidos.length, comEnvios: envios.size, concluidas, faturado };
}

/**
 * O que cada dia produziu, separadamente.
 *
 * ─── POR QUE A SERIE, E NAO SO O TOTAL ──────────────────────────────────
 *
 * A janela da medalha e MOVEL: "3 meses + os dias do mes vigente". Quando o
 * mes vira, o mes mais antigo SAI dela. Medindo em 05/09 a janela e 01/06 a
 * 05/09; em 01/10 ela passa a ser 01/07 a 01/10, e junho inteiro desaparece
 * do acumulado.
 *
 * Com so o total da janela nao da pra saber quanto vai sair — e a projecao
 * que somava ritmo sem subtrair nada prometia uma data que a conta nunca
 * alcancaria. A serie e o que permite simular a janela andando.
 *
 * Dias sem venda NAO aparecem: quem simula precisa tratar dia ausente como
 * zero de qualquer forma, e inventar linhas vazias so aumenta o tamanho.
 */
export function serieDiariaDeVendas(pedidos: PedidoParaReputacao[]): DiaDeVendas[] {
  const porDia = new Map<string, DiaDeVendas>();

  for (const p of pedidos) {
    const dia = String(p.dia ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    if (ehCancelado(p.status)) continue;

    const atual = porDia.get(dia) ?? { dia, concluidas: 0, faturado: 0 };
    atual.concluidas += 1;
    atual.faturado += Math.max(Number(p.total) || 0, 0);
    porDia.set(dia, atual);
  }

  return Array.from(porDia.values()).sort((a, b) => a.dia.localeCompare(b.dia));
}
