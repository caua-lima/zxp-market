/**
 * "Ao vivo" — o dia de hoje em andamento, como o painel Ao vivo do Mercado
 * Livre: quanto vendeu até agora, quantas vendas, quantas unidades, e como
 * isso se compara com ONTEM ATÉ ESTA MESMA HORA.
 *
 * ─── POR QUE "ATÉ ESTA HORA" E NÃO "ONTEM INTEIRO" ──────────────────────
 *
 * Às 10h da manhã, comparar o dia de hoje com o dia inteiro de ontem diz
 * sempre "−70%": é a manhã contra 24 horas. A pergunta que a barra responde é
 * "estou à frente ou atrás do ritmo de ontem?", e pra isso só conta o que
 * ontem já tinha vendido neste mesmo horário.
 *
 * ─── A MESMA BASE DO DASHBOARD ──────────────────────────────────────────
 *
 * "Vendas" aqui é o `faturamentoLiquido` do card "Vendas — Hoje" e o "Vendas
 * brutas" do Seller Center: pedidos válidos, sem cancelados nem devolvidos. A
 * classe de cada pedido chega pronta (a rota usa `classificarVenda`, a mesma
 * regra das métricas) — este módulo só soma, pra barra nunca mostrar um total
 * diferente do Dashboard.
 *
 * Puro (só outros módulos de domínio). Fuso: horário de Brasília (UTC−3, sem
 * horário de verão), o mesmo de lib/domain/periodo-br.ts.
 */

import { diaBRDe } from "./periodo-br";
import { classificarVenda, detectarPedidosSubstituidos } from "./venda-status";

const BR_OFFSET_MS = 3 * 3600 * 1000;
const DIA_MS = 24 * 3600 * 1000;
const HORA_MS = 3600 * 1000;

export type PedidoAoVivo = {
  orderId: string;
  /** Instante da venda (ISO com fuso, como o ML manda). */
  dateCreated: string;
  totalAmount: number;
  unidades: number;
  classe: "valida" | "cancelada" | "devolvida";
  /** Título do item principal — só pra "última venda". */
  titulo?: string;
};

export type TotalAoVivo = { vendas: number; pedidos: number; unidades: number };

export type ResumoAoVivo = {
  /** Dia de hoje em Brasília (AAAA-MM-DD). */
  dia: string;
  /** Hora cheia de agora em Brasília (0–23) — o "até as 14h" da comparação. */
  horaAtual: number;
  hoje: TotalAoVivo & { canceladoValor: number; canceladoPedidos: number };
  ontemAteAgora: TotalAoVivo;
  ontemInteiro: TotalAoVivo;
  /** Vendas por hora do dia (24 posições), hoje e ontem — o desenho do ritmo. */
  porHora: { hoje: number[]; ontem: number[] };
  ultimaVenda: { em: number; valor: number; titulo: string } | null;
};

/** Dia (AAAA-MM-DD) e milissegundos desde a meia-noite, em Brasília. */
function noFusoBR(ms: number): { dia: string; doDia: number } {
  const local = ms - BR_OFFSET_MS;
  const d = new Date(local);
  const dia = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { dia, doDia: ((local % DIA_MS) + DIA_MS) % DIA_MS };
}

const zero = (): TotalAoVivo => ({ vendas: 0, pedidos: 0, unidades: 0 });

export function resumirAoVivo(pedidos: readonly PedidoAoVivo[], agoraMs: number): ResumoAoVivo {
  const agora = noFusoBR(agoraMs);
  const ontem = noFusoBR(agoraMs - DIA_MS).dia;

  const hoje = { ...zero(), canceladoValor: 0, canceladoPedidos: 0 };
  const ontemAteAgora = zero();
  const ontemInteiro = zero();
  const porHora = { hoje: Array<number>(24).fill(0), ontem: Array<number>(24).fill(0) };
  let ultimaVenda: ResumoAoVivo["ultimaVenda"] = null;

  const somar = (t: TotalAoVivo, p: PedidoAoVivo) => {
    t.vendas += p.totalAmount;
    t.pedidos += 1;
    t.unidades += p.unidades;
  };

  for (const p of pedidos) {
    const ms = Date.parse(p.dateCreated);
    if (!Number.isFinite(ms)) continue;
    const quando = noFusoBR(ms);
    const ehHoje = quando.dia === agora.dia;
    const ehOntem = quando.dia === ontem;
    if (!ehHoje && !ehOntem) continue;

    if (p.classe !== "valida") {
      if (ehHoje) { hoje.canceladoValor += p.totalAmount; hoje.canceladoPedidos += 1; }
      continue;
    }

    const hora = Math.min(23, Math.floor(quando.doDia / HORA_MS));
    if (ehHoje) {
      somar(hoje, p);
      porHora.hoje[hora] += p.totalAmount;
      if (!ultimaVenda || ms > ultimaVenda.em) ultimaVenda = { em: ms, valor: p.totalAmount, titulo: p.titulo ?? "" };
    } else {
      somar(ontemInteiro, p);
      porHora.ontem[hora] += p.totalAmount;
      // Ontem ATÉ o mesmo relógio de agora (inclusive o instante exato).
      if (quando.doDia <= agora.doDia) somar(ontemAteAgora, p);
    }
  }

  return {
    dia: agora.dia,
    horaAtual: Math.floor(agora.doDia / HORA_MS),
    hoje, ontemAteAgora, ontemInteiro, porHora, ultimaVenda,
  };
}

/** Há quanto tempo, em texto curto: "agora", "há 4 min", "há 2 h". */
export function haQuantoTempo(em: number, agora: number): string {
  const min = Math.floor(Math.max(0, agora - em) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

/** O pedido como a busca do ML (ou o `ml_orders`) devolve — só o que a barra usa. */
export type PedidoBrutoAoVivo = {
  order_id?: unknown;
  status?: unknown;
  date_created?: unknown;
  total_amount?: unknown;
  pack_id?: unknown;
  buyer_id?: unknown;
  items?: { item_id?: unknown; quantity?: unknown; title?: unknown }[];
};

/**
 * Classifica os pedidos de UM dia do jeito que `/api/ml/metrics` classifica o
 * bloco "Vendas — Hoje": mesma detecção de pedido substituído (separação de
 * envio), mesma regra de cancelado/devolvido. Chamar por dia, e não com os dois
 * dias juntos, é de propósito — é assim que o Dashboard faz, e a barra tem que
 * dar o mesmo total que ele.
 *
 * Substituído some (o valor já está nos pedidos que nasceram no lugar).
 */
export function prepararPedidosAoVivo(
  pedidosDoDia: readonly PedidoBrutoAoVivo[],
  cancelIds: ReadonlySet<string>,
  devolIds: ReadonlySet<string>,
): PedidoAoVivo[] {
  const itensDe = (o: PedidoBrutoAoVivo) => (Array.isArray(o.items) ? o.items : []);
  const substituidos = detectarPedidosSubstituidos(
    pedidosDoDia.map((o) => ({
      orderId: String(o.order_id ?? ""),
      packId: (o.pack_id as string | null | undefined) ?? null,
      status: o.status,
      buyerId: (o.buyer_id as string | null | undefined) ?? null,
      dia: diaBRDe(String(o.date_created ?? "")),
      itens: itensDe(o).map((it) => ({ itemId: String(it.item_id ?? ""), qty: Number(it.quantity ?? 1) })),
    })),
  );

  const saida: PedidoAoVivo[] = [];
  for (const o of pedidosDoDia) {
    const orderId = String(o.order_id ?? "");
    const { classe } = classificarVenda({
      status: o.status,
      noCacheDeCancelados: cancelIds.has(orderId),
      temDevolucaoConcluida: devolIds.has(orderId),
      substituidoNoPacote: substituidos.has(orderId),
    });
    if (classe === "substituida") continue;
    const itens = itensDe(o);
    saida.push({
      orderId,
      dateCreated: String(o.date_created ?? ""),
      totalAmount: Number(o.total_amount ?? 0) || 0,
      unidades: itens.reduce((s, it) => s + Number(it.quantity ?? 1), 0),
      classe,
      titulo: String(itens[0]?.title ?? ""),
    });
  }
  return saida;
}

export type RitmoAoVivo = { texto: string; tom: "bom" | "ruim" | "neutro" };

/**
 * "↑ 18% vs ontem até 14:30" — a frase da comparação.
 *
 * Mesmas convenções do card "Vendas — Hoje": sobre zero não existe percentual
 * (vira "novo"), e variação que arredonda pra 0% é "igual", não "↑ 0%" em verde.
 * null = ontem e hoje ainda zerados, não há o que comparar.
 */
export function ritmoVsOntem(hoje: number, ontemAteAgora: number, relogio: string): RitmoAoVivo | null {
  const ate = `ontem até ${relogio}`;
  if (ontemAteAgora <= 0) {
    return hoje > 0 ? { texto: `novo vs ${ate}`, tom: "bom" } : null;
  }
  const pct = Math.round(((hoje - ontemAteAgora) / ontemAteAgora) * 100);
  if (pct === 0) return { texto: `= igual a ${ate}`, tom: "neutro" };
  return { texto: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs ${ate}`, tom: pct > 0 ? "bom" : "ruim" };
}

/** "14:30" em Brasília, de um instante. */
export function relogioBR(ms: number): string {
  const m = Math.floor(noFusoBR(ms).doDia / 60_000);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
