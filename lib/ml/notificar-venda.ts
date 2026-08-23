import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { estimateOrderFinance, type ProdutoCusto } from "@/lib/ml/order-finance";
import { sendSalePushToAll } from "@/lib/push-send";
import { createNotificationEventIdempotent, markPushAttempted, markPushDelivered, markPushError } from "@/lib/notification-events";
import { registrarVendaNaJanela } from "@/lib/notification-groups";
import {
  buildGroupedSalesContent,
  buildOrderDeepLink,
  buildSaleContent,
  classifySale,
  type NotificationEventSeverity,
  type NotificationEventType,
  type SalePushPayload,
} from "@/lib/domain/notifications";

/**
 * Notificação de venda confirmada, num lugar só.
 *
 * ─── POR QUE ISTO SAIU DE DENTRO DO WEBHOOK ─────────────────────────────
 *
 * Enquanto esta lógica morava só no handler do webhook, o push dependia
 * INTEIRAMENTE de o Mercado Livre chamar a nossa URL. Qualquer falha nesse
 * caminho — notificação não cadastrada no painel de Developers, tópico
 * `orders_v2` não assinado, URL antiga apontando pra outro deploy, retry
 * estourado, indisponibilidade momentânea — significava venda sem aviso, sem
 * nada no sistema registrando que o aviso não saiu.
 *
 * Agora o sync usa a MESMA função (ver lib/ml/sync.ts): toda vez que ele
 * encontra um pedido pago recente sem evento, o aviso sai. O webhook continua
 * sendo o caminho rápido (segundos); o sync vira a rede de segurança
 * (minutos). Um push por venda continua garantido pelo `dedupeKey`, que é
 * atômico no Firestore — os dois caminhos podem correr juntos sem duplicar.
 */

const norm = (s: string) => s.trim().toLowerCase();
const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");

/**
 * Idade máxima de um pedido para ainda valer push de "venda confirmada".
 *
 * O webhook dispara a cada mudança do pedido — inclusive de ENVIO, dias depois
 * da venda — e o sync varre o mês inteiro. Sem este teto, pedido antigo que
 * nunca gerou evento viraria "venda confirmada" agora, notificando algo que
 * já foi. 12h cobre com folga atraso e retry reais sem ressuscitar venda velha.
 */
export const IDADE_MAX_VENDA_MS = 12 * 3600 * 1000;

export function vendaRecente(dateCreated: string, agora = Date.now()): boolean {
  const t = Date.parse(dateCreated);
  if (!Number.isFinite(t)) return false; // sem data confiável, não inventa venda nova
  const idade = agora - t;
  // Data no futuro (relógio torto de um dos lados) conta como recente.
  return idade <= IDADE_MAX_VENDA_MS;
}

export type ItemPedido = { title?: string; quantity?: number; unit_price?: number; item_id?: string; sku?: string; sale_fee?: number };

/** Custo médio + imposto de cada produto, indexado por MLB e SKU. */
export async function carregarProdutos(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection("estoque").get();
  const porMlb = new Map<string, ProdutoCusto>();
  const porSku = new Map<string, ProdutoCusto>();
  for (const doc of snap.docs) {
    const d = doc.data();
    const entry: ProdutoCusto = { custo: Number(d.custoMedio ?? d.custo ?? 0), imposto: d.imposto, impostoFaixas: d.impostoFaixas };
    const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
    for (const m of mlbs) { const n = normId(String(m)); if (n) porMlb.set(n, entry); }
    const sku = String(d.sku ?? "").trim();
    if (sku) porSku.set(norm(sku), entry);
  }
  return { porMlb, porSku };
}

/**
 * Meta de margem do mês atual, se configurada — mesma lógica de "meta ativa"
 * do MetasTab. Só usada como limiar de "margem em atenção".
 */
export async function metaMargemAtual(db: FirebaseFirestore.Firestore): Promise<number | null> {
  try {
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const mesAtual = `${brNow.getUTCFullYear()}-${String(brNow.getUTCMonth() + 1).padStart(2, "0")}`;
    const snap = await db.collection("metasHistorico").orderBy("createdAt", "desc").get();
    const doMes = snap.docs.find((d) => d.data()?.mes === mesAtual);
    const escolhido = doMes ?? snap.docs[0];
    const v = escolhido?.data()?.metaMargem;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

function tipoParaSeveridade(type: NotificationEventType): NotificationEventSeverity {
  switch (type) {
    case "sale_high_value": case "sale_paid": return "success";
    case "sale_low_margin": return "warning";
    case "sale_negative_margin": case "sale_cancelled": case "return_opened": case "return_completed": return "danger";
    default: return "info";
  }
}

/** Máximos defensivos pro payload `data` do FCM (~4KB de teto). */
const ITENS_PUSH_MAX = 15;
const ITENS_PUSH_TITULO_MAX = 80;

export function buildPayload(eventId: string, type: NotificationEventType, title: string, body: string, opts: {
  orderId: string; productName?: string; grossAmount?: number; estimatedProfit?: number; estimatedMargin?: number;
  financialState?: "estimated" | "confirmed" | "unavailable"; tag: string;
  itens?: { title: string; quantity: number }[];
}): SalePushPayload {
  return {
    eventId, type, title, body, tag: opts.tag,
    orderId: opts.orderId, deepLink: buildOrderDeepLink(opts.orderId),
    productName: opts.productName,
    grossAmount: opts.grossAmount != null ? opts.grossAmount.toFixed(2) : undefined,
    estimatedProfit: opts.estimatedProfit != null ? opts.estimatedProfit.toFixed(2) : undefined,
    estimatedMargin: opts.estimatedMargin != null ? opts.estimatedMargin.toFixed(1) : undefined,
    financialState: opts.financialState,
    itensJson: opts.itens && opts.itens.length > 1
      ? JSON.stringify(opts.itens.slice(0, ITENS_PUSH_MAX).map((i) => ({ title: i.title.slice(0, ITENS_PUSH_TITULO_MAX), quantity: i.quantity })))
      : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Envia o push do evento já persistido, registrando tentativa/entrega/erro na
 * trilha do próprio evento (nunca o token ou payload completo).
 */
export async function enviarEPersistirEntrega(eventId: string, type: NotificationEventType, payload: SalePushPayload, isSummary = false) {
  await markPushAttempted(eventId);
  try {
    const { enviados, bloqueadosPorPreferencia } = await sendSalePushToAll(payload, type, isSummary);
    if (enviados > 0) await markPushDelivered(eventId);
    else await markPushError(eventId, bloqueadosPorPreferencia > 0 ? "todos os destinatários bloquearam por preferência/horário silencioso" : "nenhum dispositivo registrado");
    return enviados;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPushError(eventId, msg.slice(0, 160));
    return 0;
  }
}

export type ResultadoNotificacao =
  | { estado: "notificada"; eventId: string; enviados: number }
  | { estado: "ja_existia"; eventId: string }
  | { estado: "agrupada"; eventId: string }
  | { estado: "antiga" }
  | { estado: "nao_paga" };

export type PedidoParaNotificar = {
  orderId: string;
  status: string;
  dateCreated: string;
  items: ItemPedido[];
  shippingCost: number | null;
};

/**
 * Cria o evento de "venda confirmada" e dispara o push, se ainda não existir.
 *
 * Idempotente por construção: `dedupeKey` é `sale_paid:{orderId}` e o
 * documento é criado com `create()`, que falha se já existir. Webhook e sync
 * podem chamar ao mesmo tempo sem risco de push duplicado — é justamente essa
 * garantia que permite ter dois caminhos.
 */
export async function notificarVendaConfirmada(
  pedido: PedidoParaNotificar,
  ctx?: { porMlb: Map<string, ProdutoCusto>; porSku: Map<string, ProdutoCusto>; metaMargem: number | null },
): Promise<ResultadoNotificacao> {
  if (pedido.status !== "paid") return { estado: "nao_paga" };
  if (!vendaRecente(pedido.dateCreated)) return { estado: "antiga" };

  const db = getAdminDb();
  const { porMlb, porSku } = ctx ?? await carregarProdutos(db);
  const metaMargem = ctx ? ctx.metaMargem : await metaMargemAtual(db);

  const finance = estimateOrderFinance(
    pedido.items, porMlb, porSku, pedido.shippingCost,
    pedido.dateCreated || new Date().toISOString(),
    metaMargem,
  );
  const { type } = classifySale(finance);
  const content = buildSaleContent({ ...finance, type, itemCount: finance.itemCount, semCadastro: finance.semCadastro });
  const financialState: "estimated" | "unavailable" = finance.estimatedProfit == null ? "unavailable" : "estimated";

  /**
   * dedupeKey ESTÁVEL por pedido — nunca varia com a classificação (alto
   * valor / margem baixa / etc.). Se variasse, um retry que recalculasse pra
   * outro tipo criaria um SEGUNDO evento pro mesmo pedido, que é exatamente a
   * duplicidade que isto existe pra evitar.
   */
  const dedupeKey = `sale_paid:${pedido.orderId}`;
  const { created, eventId } = await createNotificationEventIdempotent({
    type, severity: tipoParaSeveridade(type), entityType: "order", entityId: pedido.orderId, dedupeKey,
    title: content.title, body: content.body,
    orderId: pedido.orderId, orderExternalId: pedido.orderId,
    productName: finance.productName, productCount: finance.itemCount, quantity: finance.quantityTotal,
    itens: finance.itemCount > 1 ? finance.itens : undefined,
    grossAmount: finance.grossAmount,
    estimatedProfit: finance.estimatedProfit ?? undefined,
    estimatedMargin: finance.estimatedMargin ?? undefined,
    financialState,
    deepLink: buildOrderDeepLink(pedido.orderId),
  });

  if (!created) return { estado: "ja_existia", eventId };

  const payload = buildPayload(eventId, type, content.title, content.body, {
    orderId: pedido.orderId, productName: finance.productName, grossAmount: finance.grossAmount,
    estimatedProfit: finance.estimatedProfit ?? undefined, estimatedMargin: finance.estimatedMargin ?? undefined,
    financialState, tag: `sale-${pedido.orderId}`, itens: finance.itens,
  });

  // Prejuízo NUNCA agrupa — é o aviso que não pode se perder num resumo.
  if (type === "sale_negative_margin") {
    const enviados = await enviarEPersistirEntrega(eventId, type, payload);
    return { estado: "notificada", eventId, enviados };
  }

  const decisao = await registrarVendaNaJanela(finance.grossAmount);
  if (decisao.modo === "individual") {
    const enviados = await enviarEPersistirEntrega(eventId, type, payload);
    return { estado: "notificada", eventId, enviados };
  }
  if (decisao.modo === "resumo_dispara") {
    const resumo = buildGroupedSalesContent(decisao.totalNaJanela, decisao.grossAcumulado, decisao.janelaMinutos);
    const payloadResumo = buildPayload(eventId, type, resumo.title, resumo.body, {
      orderId: pedido.orderId, tag: `sales-summary-${Math.floor(Date.now() / 90000)}`,
    });
    const enviados = await enviarEPersistirEntrega(eventId, type, payloadResumo, true);
    return { estado: "notificada", eventId, enviados };
  }
  // "resumo_silencioso": o resumo já saiu na venda que disparou o agrupamento.
  return { estado: "agrupada", eventId };
}

// ── Marcos comemorativos ───────────────────────────────────────────

/**
 * Cria o evento de um marco e manda o push, se ainda não existir.
 *
 * A dedupe é a peça central: a `chave` do marco vira o `dedupeKey`, e o
 * Firestore garante criação única com `create()`. Sem isso, o faturamento que
 * passou dos R$ 10 mil no dia 5 geraria um aviso a cada sync — cerca de 1.900
 * até o fim do mês — e o usuário desligaria as notificações no primeiro dia.
 *
 * NUNCA agrupa na janela de resumo (registrarVendaNaJanela): marco é raro e
 * é a única notícia boa que o app manda. Perdê-la dentro de um "4 vendas nos
 * últimos 90s" seria o oposto do ponto.
 */
export async function notificarMarco(marco: { chave: string; titulo: string; corpo: string }): Promise<boolean> {
  const { created, eventId } = await createNotificationEventIdempotent({
    type: "system",
    severity: "success",
    entityType: "system",
    entityId: marco.chave,
    dedupeKey: marco.chave,
    title: marco.titulo,
    body: marco.corpo,
    financialState: "confirmed",
    deepLink: "/",
  });
  if (!created) return false;

  await enviarEPersistirEntrega(
    eventId,
    "system",
    buildPayload(eventId, "system", marco.titulo, marco.corpo, {
      orderId: "",
      tag: marco.chave,
    }),
  );
  return true;
}
