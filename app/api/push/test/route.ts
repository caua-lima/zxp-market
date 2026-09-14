import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { sendPushToUser } from "@/lib/push-send";
import { createNotificationEventIdempotent, markPushAttempted, markPushDelivered, markPushError } from "@/lib/notification-events";
import {
  buildCancelContent,
  buildGroupedSalesContent,
  buildOrderDeepLink,
  buildReturnCompletedContent,
  buildSaleContent,
  classifySale,
  type NotificationEventSeverity,
  type NotificationEventType,
  type SalePushPayload,
} from "@/lib/domain/notifications";

export type TestScenario =
  | "sale_paid" | "sale_high_value" | "sale_low_margin" | "sale_negative_margin"
  | "sale_cancelled" | "return_completed" | "sales_summary" | "unavailable";

const SCENARIOS: TestScenario[] = [
  "sale_paid", "sale_high_value", "sale_low_margin", "sale_negative_margin",
  "sale_cancelled", "return_completed", "sales_summary", "unavailable",
];

/**
 * Dados 100% inventados por cenário — NUNCA lê pedido real nem grava nada em
 * `ml_orders`/`estoque`. O orderId sintético (`TESTE-...`) deixa óbvio, se
 * aparecer em qualquer lugar, que não é uma venda de verdade.
 */
function montarCenario(scenario: TestScenario) {
  const produto = "Produto de teste";
  switch (scenario) {
    case "sale_high_value": {
      const grossAmount = 480;
      const { type } = classifySale({ grossAmount, estimatedProfit: 96, estimatedMargin: 20, metaMargem: null });
      const content = buildSaleContent({ type, productName: produto, itemCount: 1, grossAmount, estimatedProfit: 96, estimatedMargin: 20, metaMargem: null });
      return { type, severity: "success" as NotificationEventSeverity, content, grossAmount, estimatedProfit: 96, estimatedMargin: 20, financialState: "estimated" as const };
    }
    case "sale_low_margin": {
      const grossAmount = 120;
      const content = buildSaleContent({ type: "sale_low_margin", productName: produto, itemCount: 1, grossAmount, estimatedProfit: 6, estimatedMargin: 5, metaMargem: null });
      return { type: "sale_low_margin" as NotificationEventType, severity: "warning" as NotificationEventSeverity, content, grossAmount, estimatedProfit: 6, estimatedMargin: 5, financialState: "estimated" as const };
    }
    case "sale_negative_margin": {
      const grossAmount = 89.9;
      const content = buildSaleContent({ type: "sale_negative_margin", productName: produto, itemCount: 1, grossAmount, estimatedProfit: -12.4, estimatedMargin: -13.8, metaMargem: null });
      return { type: "sale_negative_margin" as NotificationEventType, severity: "danger" as NotificationEventSeverity, content, grossAmount, estimatedProfit: -12.4, estimatedMargin: -13.8, financialState: "estimated" as const };
    }
    case "sale_cancelled": {
      const grossAmount = 139.8;
      const content = buildCancelContent(produto, 1, grossAmount);
      return { type: "sale_cancelled" as NotificationEventType, severity: "warning" as NotificationEventSeverity, content, grossAmount, estimatedProfit: undefined, estimatedMargin: undefined, financialState: "estimated" as const };
    }
    case "return_completed": {
      const content = buildReturnCompletedContent(produto, 1);
      return { type: "return_completed" as NotificationEventType, severity: "warning" as NotificationEventSeverity, content, grossAmount: 139.8, estimatedProfit: undefined, estimatedMargin: undefined, financialState: "estimated" as const };
    }
    case "sales_summary": {
      const content = buildGroupedSalesContent(5, 486.2, 2);
      return { type: "sale_paid" as NotificationEventType, severity: "success" as NotificationEventSeverity, content, grossAmount: 486.2, estimatedProfit: undefined, estimatedMargin: undefined, financialState: "estimated" as const };
    }
    case "unavailable": {
      const content = buildSaleContent({ type: "sale_paid", productName: produto, itemCount: 1, grossAmount: 139.8, estimatedProfit: null, estimatedMargin: null, metaMargem: null });
      return { type: "sale_paid" as NotificationEventType, severity: "info" as NotificationEventSeverity, content, grossAmount: 139.8, estimatedProfit: undefined, estimatedMargin: undefined, financialState: "unavailable" as const };
    }
    case "sale_paid":
    default: {
      const grossAmount = 139.8;
      const content = buildSaleContent({ type: "sale_paid", productName: produto, itemCount: 1, grossAmount, estimatedProfit: 34.5, estimatedMargin: 24.7, metaMargem: null });
      return { type: "sale_paid" as NotificationEventType, severity: "success" as NotificationEventSeverity, content, grossAmount, estimatedProfit: 34.5, estimatedMargin: 24.7, financialState: "estimated" as const };
    }
  }
}

/**
 * Dispara um cenário de teste completo (evento persistido + push real, só
 * pros dispositivos do usuário logado) — o botão "Testar" do sino vira um
 * menu de cenários em vez de mandar sempre o mesmo aviso genérico. Nunca usa
 * dado real: tudo aqui é inventado, com orderId prefixado "TESTE-" pra nunca
 * ser confundido com uma venda de verdade em nenhum lugar que ler
 * notification_events depois.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => ({}));
  const scenarioRaw = String(body?.scenario ?? "sale_paid");
  const scenario = (SCENARIOS as string[]).includes(scenarioRaw) ? (scenarioRaw as TestScenario) : "sale_paid";

  const orderId = `TESTE-${Date.now()}`;
  const cenario = montarCenario(scenario);
  const dedupeKey = `test:${gate.email}:${scenario}:${Date.now()}`; // sempre novo — teste é repetível de propósito

  const horario = new Date().toISOString();

  const { eventId } = await createNotificationEventIdempotent({
    type: cenario.type, severity: cenario.severity, entityType: "order", entityId: orderId, dedupeKey,
    title: cenario.content.title, body: cenario.content.body,
    orderId, orderExternalId: orderId,
    productName: "Produto de teste", productCount: 1,
    grossAmount: cenario.grossAmount, estimatedProfit: cenario.estimatedProfit, estimatedMargin: cenario.estimatedMargin,
    financialState: cenario.financialState,
    deepLink: buildOrderDeepLink(orderId),
  });

  const payload: SalePushPayload = {
    eventId, type: cenario.type, title: cenario.content.title, body: cenario.content.body,
    tag: `sale-${orderId}`, orderId, deepLink: buildOrderDeepLink(orderId),
    productName: "Produto de teste",
    grossAmount: cenario.grossAmount.toFixed(2),
    estimatedProfit: cenario.estimatedProfit != null ? cenario.estimatedProfit.toFixed(2) : undefined,
    estimatedMargin: cenario.estimatedMargin != null ? cenario.estimatedMargin.toFixed(1) : undefined,
    financialState: cenario.financialState,
    timestamp: horario,
  };

  await markPushAttempted(eventId);
  try {
    const { enviados } = await sendPushToUser(gate.email, payload);
    if (enviados > 0) await markPushDelivered(eventId);
    return NextResponse.json({
      ok: true, scenario, eventId, orderId,
      title: cenario.content.title, body: cenario.content.body,
      enviados, horario,
      bloqueioMotivo: enviados === 0 ? "Nenhum dispositivo seu está registrado — ative notificações neste aparelho primeiro." : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPushError(eventId, msg.slice(0, 160));
    return NextResponse.json({ ok: false, error: msg, scenario, eventId, orderId, horario }, { status: 500 });
  }
}
