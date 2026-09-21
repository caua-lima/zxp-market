import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { consumirLimiteDaChave } from "@/lib/notification-limites";
import { dependenciasReais, publicarEEntregar, situacaoDoPush } from "@/lib/notification-outbox";
import { explicarTeste, type DestinoDoTeste } from "@/lib/domain/diagnostico-push";
import { idDoRegistro } from "@/lib/domain/push-registro";
import {
  buildCancelContent,
  buildGroupedSalesContent,
  buildReturnCompletedContent,
  buildSaleContent,
  classifySale,
  type SalePushPayload,
} from "@/lib/domain/notifications";
import type { StatusEntrega } from "@/lib/domain/entrega-destino";

export type TestScenario =
  | "sale_paid" | "sale_high_value" | "sale_low_margin" | "sale_negative_margin"
  | "sale_cancelled" | "return_completed" | "sales_summary" | "unavailable";

const SCENARIOS: TestScenario[] = [
  "sale_paid", "sale_high_value", "sale_low_margin", "sale_negative_margin",
  "sale_cancelled", "return_completed", "sales_summary", "unavailable",
];

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Teste é repetível de propósito, mas não infinito: cada um cria um aviso e um push. */
const LIMITE = { max: 10, janelaMs: 10 * 60_000 };

/**
 * O TEXTO de cada cenário — dados 100% inventados. Nunca lê pedido real nem
 * grava em `ml_orders`/`estoque`. O texto imita o de um aviso de verdade pra a
 * pessoa ver COMO ele aparece; o evento, porém, é do tipo "test": não é venda,
 * não vai pra Central do time e não leva link pra pedido (o de antes apontava
 * pra um pedido "TESTE-..." que não existe).
 */
function montarConteudo(scenario: TestScenario): { title: string; body: string } {
  const produto = "Produto de teste";
  switch (scenario) {
    case "sale_high_value":
      return buildSaleContent({ type: classifySale({ grossAmount: 480, estimatedProfit: 96, estimatedMargin: 20, metaMargem: null }).type, productName: produto, itemCount: 1, grossAmount: 480, estimatedProfit: 96, estimatedMargin: 20, metaMargem: null });
    case "sale_low_margin":
      return buildSaleContent({ type: "sale_low_margin", productName: produto, itemCount: 1, grossAmount: 120, estimatedProfit: 6, estimatedMargin: 5, metaMargem: null });
    case "sale_negative_margin":
      return buildSaleContent({ type: "sale_negative_margin", productName: produto, itemCount: 1, grossAmount: 89.9, estimatedProfit: -12.4, estimatedMargin: -13.8, metaMargem: null });
    case "sale_cancelled":
      return buildCancelContent(produto, 1, 139.8);
    case "return_completed":
      return buildReturnCompletedContent(produto, 1);
    case "sales_summary":
      return buildGroupedSalesContent(5, 486.2, 2);
    case "unavailable":
      return buildSaleContent({ type: "sale_paid", productName: produto, itemCount: 1, grossAmount: 139.8, estimatedProfit: null, estimatedMargin: null, metaMargem: null });
    case "sale_paid":
    default:
      return buildSaleContent({ type: "sale_paid", productName: produto, itemCount: 1, grossAmount: 139.8, estimatedProfit: 34.5, estimatedMargin: 24.7, metaMargem: null });
  }
}

/**
 * Dispara um push de TESTE — só pro aparelho que pediu (ou, sem identificação,
 * pros da própria pessoa), e devolve o que aconteceu com ESSE aparelho.
 *
 * ─── TESTE NÃO É VENDA ──────────────────────────────────────────────────
 *
 * O teste usava tipos de venda e uma coleção compartilhada: o teste de A virava
 * "venda" na Central de B, com pedido e link inexistentes. Agora:
 *  - o tipo é "test" (selo TESTE no título, sem valores nem pedido);
 *  - o evento vive no feed PESSOAL de quem testou (histórico técnico, apagado em
 *    7 dias) e nunca nas coleções do time;
 *  - a preferência não o esconde (ver avaliarPush): o teste prova o caminho até
 *    o aparelho, e um silêncio configurado não é defeito desse caminho.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => ({})) as { scenario?: unknown; deviceId?: unknown };
  const scenarioRaw = String(body?.scenario ?? "sale_paid");
  const scenario = (SCENARIOS as string[]).includes(scenarioRaw) ? (scenarioRaw as TestScenario) : "sale_paid";
  const deviceId = typeof body.deviceId === "string" && DEVICE_ID.test(body.deviceId) ? body.deviceId : null;

  const db = getAdminDb();
  const limite = await consumirLimiteDaChave(db, `teste:${gate.email}`, LIMITE);
  if (!limite.permitido) {
    return NextResponse.json(
      { ok: false, error: "Muitos testes seguidos. Espere um pouco e tente de novo.", rateLimited: true },
      { status: 429, headers: { "Retry-After": String(limite.esperarSegundos) } },
    );
  }
  const deps = dependenciasReais();
  const conteudo = montarConteudo(scenario);
  const title = `TESTE · ${conteudo.title}`;
  const horario = new Date().toISOString();

  const { eventId } = await createNotificationEventIdempotent({
    type: "test", severity: "info", entityType: "system", entityId: `teste-${scenario}`,
    // Sempre novo: o teste é repetível de propósito.
    dedupeKey: `test:${gate.email}:${scenario}:${Date.now()}`,
    title, body: conteudo.body,
    deepLink: "/",
    financialState: "unavailable",
  }, db, { audiencia: [gate.email] });

  // Sem orderId, sem valores e sem link de pedido: nada aqui aponta pra algo que não existe.
  const payload: SalePushPayload = {
    eventId, type: "test", title, body: conteudo.body,
    tag: `test-${eventId}`, deepLink: "/", timestamp: horario,
  };

  const alvo = deviceId ? [idDoRegistro(gate.email, deviceId)] : null;
  try {
    await publicarEEntregar(deps, {
      pushId: eventId, eventId, type: "test", payload, audiencia: [gate.email], apenasRegistros: alvo,
      origem: "teste", validadeMs: 10 * 60_000, atualizaEvento: false,
    });
  } catch (err) {
    console.error(`[teste] falha ao publicar o teste (${String((err as { code?: unknown })?.code ?? "erro")})`);
    return NextResponse.json({ ok: false, error: "Não consegui agendar o teste agora. Tente de novo.", scenario, eventId, horario }, { status: 500 });
  }

  const situacao = await situacaoDoPush(deps, eventId);
  const meuRegistro = deviceId ? idDoRegistro(gate.email, deviceId) : null;
  // Só status e códigos: nunca token nem e-mail no que volta ao navegador.
  const destinos: DestinoDoTeste[] = situacao.entregas.map((e) => ({
    este: meuRegistro != null && e.registroDocId === meuRegistro,
    status: e.status as StatusEntrega,
    motivo: typeof e.motivo === "string" ? e.motivo : undefined,
    erro: typeof e.ultimoErro?.codigo === "string" ? e.ultimoErro.codigo : undefined,
  }));
  const veredito = explicarTeste(destinos, deviceId != null);

  return NextResponse.json({
    ok: true, scenario, eventId,
    title, body: conteudo.body, horario,
    resultado: veredito.resultado,
    explicacao: veredito.explicacao,
    destinos,
    // Compatibilidade com a tela anterior.
    enviados: destinos.filter((d) => d.status === "accepted").length,
    bloqueioMotivo: veredito.resultado === "aceito" ? null : veredito.explicacao,
  });
}
