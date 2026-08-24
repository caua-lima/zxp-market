// ── Central de eventos de notificação ────────────────────────────
// Modelo único de "evento" (venda, cancelamento, devolução, alerta de
// sincronização) que alimenta três canais: push nativo, toast de foreground
// e a Central de Notificações. O evento persistido no Firestore é a fonte de
// verdade — push é só um canal de ENTREGA dele, pode falhar sem perder o
// registro (ver lib/notification-events.ts).
//
// Tudo neste arquivo é puro (sem Firestore/rede) de propósito: dá pra testar
// a classificação e o texto de cada regra sem precisar de um pedido real.

export type NotificationEventType =
  | "sale_paid"
  | "sale_high_value"
  | "sale_low_margin"
  | "sale_negative_margin"
  | "sale_cancelled"
  | "return_opened"
  | "return_completed"
  | "sync_warning"
  | "task_assigned"
  | "stock_low"
  | "system";

export type NotificationEventSeverity = "success" | "info" | "warning" | "danger";

/** A partir de que valor bruto uma venda é "alto valor" — ver classifySale(). */
export const HIGH_VALUE_SALE_THRESHOLD = 250;

/** Margem % abaixo da qual uma venda com lucro positivo já é "em atenção", quando a meta do mês não está disponível. */
export const DEFAULT_LOW_MARGIN_THRESHOLD = 8;

export type NotificationEvent = {
  id: string;
  type: NotificationEventType;
  severity: NotificationEventSeverity;
  entityType: "order" | "return" | "task" | "system";
  entityId: string;
  /** Chave estável de deduplicação, ex.: "sale_paid:2000123456". Também é o id do documento — reaproveita a garantia de unicidade do próprio Firestore. */
  dedupeKey: string;
  title: string;
  body: string;
  accountId?: string;
  orderId?: string;
  orderExternalId?: string;
  productName?: string;
  productCount?: number;
  quantity?: number;
  /** Um item por produto distinto do pedido (nome + quantidade) — usado pelo "ver itens" da Central quando productCount > 1. */
  itens?: { title: string; quantity: number }[];
  grossAmount?: number;
  returnAmount?: number;
  estimatedProfit?: number;
  estimatedMargin?: number;
  financialState: "estimated" | "confirmed" | "unavailable";
  deepLink: string;
  createdAt: unknown; // FieldValue.serverTimestamp() na escrita, Timestamp na leitura
  /** email -> timestamp (ms) de quando cada pessoa leu/dispensou. */
  readBy?: Record<string, number>;
  dismissedBy?: Record<string, number>;
  delivery?: {
    pushAttemptedAt?: unknown;
    pushDeliveredAt?: unknown;
    pushError?: string;
  };
};

export type SalePushPayload = {
  eventId: string;
  type: NotificationEventType;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag: string;
  orderId?: string;
  deepLink: string;
  productName?: string;
  grossAmount?: string;
  estimatedProfit?: string;
  estimatedMargin?: string;
  financialState?: "estimated" | "confirmed" | "unavailable";
  /**
   * Itens do pedido (nome + quantidade), serializados em JSON — o payload
   * `data` do FCM só aceita string (ver serializarPayload em lib/push-send.ts).
   * Só o toast de foreground consome isto; a Central lê o array direto do
   * evento persistido (NotificationEvent.itens), sem passar por aqui.
   */
  itensJson?: string;
  timestamp: string;
};

function fmtBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

/** deepLink pra abrir Pedidos já com o drawer daquele pedido — ver app/page.tsx (?tab=&order=). */
export function buildOrderDeepLink(orderId: string): string {
  return `/?tab=pedidos&order=${encodeURIComponent(orderId)}`;
}

/** deepLink pra abrir Tarefas já com o modal daquela tarefa — ver app/page.tsx (?tab=&task=). */
export function buildTaskDeepLink(taskId: string): string {
  return `/?tab=tarefas&task=${encodeURIComponent(taskId)}`;
}

export type SaleFinanceInput = {
  grossAmount: number;
  estimatedProfit: number | null; // null = indisponível (case 5 do spec)
  estimatedMargin: number | null; // %, null junto com estimatedProfit
  /** Meta de margem do mês, se configurada — vira o limiar de "margem em atenção" no lugar do DEFAULT_LOW_MARGIN_THRESHOLD fixo. */
  metaMargem: number | null;
};

/**
 * Prioridade da classificação: primeiro os que exigem ATENÇÃO de verdade
 * (prejuízo, depois margem baixa), só então a celebração de alto valor — uma
 * venda de R$ 500 com prejuízo NÃO deve virar "Venda de alto valor 🚀", isso
 * esconderia o problema atrás de uma comemoração. Dado indisponível vem
 * antes de tudo: sem número, não dá pra classificar por valor/margem.
 */
export function classifySale(input: SaleFinanceInput): { type: NotificationEventType; severity: NotificationEventSeverity } {
  if (input.estimatedProfit == null || input.estimatedMargin == null) {
    return { type: "sale_paid", severity: "info" };
  }
  if (input.estimatedProfit < 0) {
    return { type: "sale_negative_margin", severity: "danger" };
  }
  const limiarMargem = input.metaMargem ?? DEFAULT_LOW_MARGIN_THRESHOLD;
  if (input.estimatedMargin < limiarMargem) {
    return { type: "sale_low_margin", severity: "warning" };
  }
  if (input.grossAmount >= HIGH_VALUE_SALE_THRESHOLD) {
    return { type: "sale_high_value", severity: "success" };
  }
  return { type: "sale_paid", severity: "success" };
}

export type SaleContentInput = SaleFinanceInput & {
  type: NotificationEventType;
  /** Item do pedido sem produto cadastrado — o CMV entra como zero. */
  semCadastro?: boolean;
  /** Nome do primeiro/principal produto do pedido. */
  productName: string;
  /** Quantos itens DISTINTOS tem o pedido — 1 = só o produto principal; 2+ nomeia os produtos (ver buildSaleContent). */
  itemCount: number;
  /** Nome de cada item distinto, na ordem do pedido — usado só quando itemCount > 1. */
  itens?: { title: string; quantity: number }[];
};

export type SaleContent = { title: string; body: string };

/**
 * Título e corpo do push/evento — a MESMA regra de texto documentada no
 * spec, num lugar só, pra webhook e teste de cenário (Fase 9 do painel de
 * testes) usarem exatamente o mesmo resultado.
 */
/**
 * Nome a exibir pro pedido — 1 item usa o nome do produto; 2+ nomeia quem
 * são, em vez do genérico "N itens no pedido" que não dizia nada até você
 * abrir o pedido pra descobrir. 2 itens: os dois nomes. 3+: o primeiro + "e
 * outros N", porque listar tudo no título estoura a notificação nativa (o SO
 * corta o texto sem aviso). O detalhe completo (nome × quantidade de cada
 * item) fica disponível no "ver itens" do toast e da Central — ver
 * SaleNotificationToast.tsx e NotificationCenter.tsx.
 */
function nomeDoPedido(input: SaleContentInput): string {
  if (input.itemCount <= 1) return input.productName || "Produto";
  const nomes = (input.itens ?? []).map((i) => i.title).filter(Boolean);
  if (nomes.length === 0) return `${input.itemCount} itens no pedido`; // sem detalhe — fallback antigo
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  return `${nomes[0]} e outros ${nomes.length - 1}`;
}

export function buildSaleContent(input: SaleContentInput): SaleContent {
  const produto = nomeDoPedido(input);
  const valor = fmtBRL(input.grossAmount);

  switch (input.type) {
    case "sale_high_value":
      return { title: "Venda de alto valor 🚀", body: `${valor} · ${produto}` };
    case "sale_low_margin":
      return {
        title: "Venda confirmada · margem em atenção",
        body: `${produto} · margem estimada ${(input.estimatedMargin ?? 0).toFixed(1)}%`,
      };
    case "sale_negative_margin":
      return {
        title: "Venda confirmada · revisar margem",
        body: `${produto} · prejuízo estimado de ${fmtBRL(Math.abs(input.estimatedProfit ?? 0))}`,
      };
    case "sale_paid":
    default:
      if (input.estimatedProfit == null) {
        /**
         * "Em atualização" soava temporário e não dizia o que fazer. Quando a
         * causa é produto sem cadastro, o número não vai chegar sozinho: o
         * custo entra como ZERO e o lucro do dia fica inflado até alguém
         * cadastrar o SKU. Vale dizer isso na hora, que é quando dá pra
         * corrigir barato.
         */
        if (input.semCadastro) {
          return {
            title: "Venda de produto sem cadastro",
            body: `${produto} · ${valor} — sem custo cadastrado, o lucro está inflado`,
          };
        }
        return { title: "Nova venda confirmada", body: `${produto} · cálculo financeiro em atualização` };
      }
      return { title: "Nova venda confirmada", body: `${produto} · ${valor}` };
  }
}

export function buildCancelContent(productName: string, itemCount: number, impactValue: number): SaleContent {
  const produto = itemCount > 1 ? `${itemCount} itens no pedido` : productName || "Produto";
  return { title: "Pedido cancelado", body: `${produto} · impacto de ${fmtBRL(Math.abs(impactValue))}` };
}

export function buildReturnCompletedContent(productName: string, itemCount: number): SaleContent {
  const produto = itemCount > 1 ? `${itemCount} itens no pedido` : productName || "Produto";
  return { title: "Devolução concluída", body: `${produto} · venda revertida` };
}

const PRIORITY_LABEL: Record<string, string> = { critica: "crítica", alta: "alta", media: "média", baixa: "baixa" };

/**
 * Tarefa atribuída a alguém — diferente de venda, isto vai só pra UMA pessoa
 * (quem recebeu a tarefa), não pro time todo. Severity "warning" pra
 * prioridade alta/crítica (chama mais atenção na Central/toast), "info" pro
 * resto — não é um alerta financeiro, só precisa ser notado.
 */
export function buildTaskAssignedContent(title: string, priority: string, dueDate?: string): SaleContent {
  const label = PRIORITY_LABEL[priority] ?? priority;
  const prazo = dueDate ? ` · prazo ${dueDate.split("-").reverse().join("/")}` : "";
  return { title: "Nova tarefa atribuída a você", body: `${title} · prioridade ${label}${prazo}` };
}

export function taskAssignedSeverity(priority: string): NotificationEventSeverity {
  return priority === "critica" || priority === "alta" ? "warning" : "info";
}

/** N vendas agrupadas numa janela curta (anti-spam) — ver lib/notification-groups.ts. */
export function buildGroupedSalesContent(count: number, totalGross: number, windowMinutes: number): SaleContent {
  return {
    title: `${count} novas vendas confirmadas`,
    body: `${fmtBRL(totalGross)} em pedidos nos últimos ${windowMinutes} min`,
  };
}

export const NOTIFICATION_TYPE_META: Record<
  NotificationEventType,
  { label: string; severity: NotificationEventSeverity; group: "vendas" | "alertas" | "sistema" }
> = {
  sale_paid: { label: "Venda confirmada", severity: "success", group: "vendas" },
  sale_high_value: { label: "Venda de alto valor", severity: "success", group: "vendas" },
  sale_low_margin: { label: "Margem em atenção", severity: "warning", group: "alertas" },
  sale_negative_margin: { label: "Margem negativa", severity: "danger", group: "alertas" },
  sale_cancelled: { label: "Cancelamento", severity: "warning", group: "alertas" },
  return_opened: { label: "Devolução aberta", severity: "warning", group: "alertas" },
  return_completed: { label: "Devolução concluída", severity: "warning", group: "alertas" },
  sync_warning: { label: "Aviso de sincronização", severity: "warning", group: "sistema" },
  task_assigned: { label: "Tarefa atribuída", severity: "info", group: "alertas" },
  stock_low: { label: "Full no mínimo (agendar coleta)", severity: "warning", group: "alertas" },
  system: { label: "Sistema", severity: "info", group: "sistema" },
};
