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
