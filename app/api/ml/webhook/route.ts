import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { mapOrderItems } from "@/lib/ml/sync";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { buildPayload, enviarEPersistirEntrega, notificarVendaConfirmada } from "@/lib/ml/notificar-venda";
import { buildCancelContent, buildOrderDeepLink } from "@/lib/domain/notifications";

export const maxDuration = 30;

const ML_API = "https://api.mercadolibre.com";

/**
 * Trilha de TODA chamada recebida do Mercado Livre.
 *
 * Existe porque "não chega notificação" era impossível de diagnosticar: sem
 * registro nenhum, não dava pra distinguir "o ML nunca chamou" (webhook não
 * cadastrado, tópico não assinado, URL apontando pro deploy antigo) de "o ML
 * chamou e nós falhamos". São problemas opostos e a correção de um não ajuda
 * em nada no outro.
 *
 * Guarda só metadado — id do pedido, status, o que decidimos e o erro
 * resumido. Nunca token, nunca corpo completo. Consultável em
 * /api/ml/diagnostico-push.
 */
/**
 * Tópico que o app não trata: conta, em vez de gravar um doc por chamada.
 *
 * ─── POR QUE DEIXOU DE SER UM DOC POR CHAMADA ───────────────────────────
 *
 * Medido na conta: 1.104 chamadas por dia, das quais 73% são tópicos que
 * esta rota descarta na linha seguinte — `shipments`, `items`,
 * `payments`, `invoices`, `stock-locations`, `price_suggestion`. Cada uma
 * gravava um documento, e `webhook_log` virou a maior coleção da base
 * (9.911 docs, contra 1.100 de `ml_orders`), acumulados em menos de 30 dias.
 *
 * O valor diagnóstico continua o mesmo: o que importa é saber que o ML chega
 * aqui e em qual tópico — "não configurado" x "configurado no tópico errado".
 * Isso é uma CONTAGEM, não um histórico: um contador por tópico por dia
 * responde igual e troca ~800 documentos diários por ~7.
 */
async function contarTopicoIgnorado(topic: string, dia: string) {
  try {
    await getAdminDb().collection("webhook_topicos").doc(dia).set({
      dia,
      [`topicos.${(topic || "sem_topico").replace(/[.$/[]#]/g, "_")}`]: FieldValue.increment(1),
      atualizadoEm: Date.now(),
    }, { merge: true });
  } catch { /* contagem nunca pode derrubar o webhook */ }
}

async function registrarChamada(dados: Record<string, unknown>) {
  try {
    await getAdminDb().collection("webhook_log").add({
      ...dados,
      at: new Date().toISOString(),
      // TTL de leitura: a rota de diagnóstico ordena por isto e lê só os
      // últimos. Não é uma coleção pra crescer sem limite ser problema —
      // cada doc é minúsculo e o volume é o de vendas.
      ts: Date.now(),
    });
  } catch { /* log nunca pode derrubar o webhook */ }
}

/**
 * Callback de notificações do Mercado Livre (tópico `orders_v2`). Precisa
 * ser cadastrado manualmente no painel de Developers do ML — não é algo que
 * dá pra configurar por código, é do lado do ML.
 *
 * O ML manda só um ponteiro (`resource`) a cada mudança no pedido — criação,
 * pagamento aprovado, troca de status de envio, etc. — então este endpoint
 * dispara VÁRIAS vezes pro mesmo pedido ao longo da vida dele.
 *
 * Idempotência: cada evento de negócio (venda confirmada, cancelamento) vira
 * um doc em `notification_events` cujo ID É o dedupeKey — o Firestore
 * garante, via `DocumentReference.create()`, que só a PRIMEIRA chamada cria
 * o doc. Chamadas repetidas (retry do ML, ou o webhook disparando de novo
 * por causa de outra mudança no mesmo pedido) recebem `created: false` e
 * simplesmente não mandam push de novo — sem precisar de transação própria
 * pra isso (ver lib/notification-events.ts).
 */
export async function POST(req: Request) {
  let body: { resource?: string; topic?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" });
  }

  const resource = body?.resource ?? "";
  const match = resource.match(/^\/orders\/(\d+)/);
  if (!match) {
    // outros tópicos (mensagens, reclamações, etc.) — ignora sem erro, não
    // queremos que o ML pare de mandar os outros por causa disso. Registra
    // mesmo assim: saber que o ML chega aqui, ainda que com outro tópico, já
    // separa "não configurado" de "configurado no tópico errado".
    await contarTopicoIgnorado(String(body?.topic ?? ""), new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()));
    return NextResponse.json({ ok: true, ignored: true });
  }
  const orderId = match[1];

  try {
    const token = await getValidMlAccessToken();
    const res = await fetch(`${ML_API}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      // 404 acontece com pedido de teste/sandbox do próprio ML — não é erro
      // nosso, não faz sentido o ML ficar retentando. Outros status, sim.
      return NextResponse.json({ ok: res.status === 404 }, { status: res.status === 404 ? 200 : 502 });
    }
    const order = (await res.json()) as Record<string, unknown>;
    const status = String(order.status ?? "");
    const items = mapOrderItems(order);
    const primeiro = items[0]?.title || "Pedido";

    const db = getAdminDb();
    const ref = db.collection("ml_orders").doc(orderId);
    const antes = await ref.get();
    const dataCriacao = String(order.date_created ?? "");
    /**
     * "Já era paga ANTES de nós existirmos como registro" — só serve pro
     * cancelamento, que precisa saber se a venda chegou a valer. Para a venda
     * em si NÃO se usa mais este sinal: ver vendaRecente() acima.
     */
    const jaConheciaComoPago = antes.exists && antes.data()?.status === "paid";

    // Mantém o dashboard atualizado mesmo em chamadas que não geram evento
    // (troca de status de envio, etc.) — sincronização completa (frete,
    // repasse) continua vindo do cron/sync manual, isto aqui é só o essencial.
    await ref.set({
      order_id: orderId,
      status: order.status ?? null,
      date_created: String(order.date_created ?? ""),
      total_amount: Number(order.total_amount ?? 0),
      currency: order.currency_id ?? "BRL",
      /**
       * buyer_id é o que permite calcular taxa de recompra (ver
       * lib/domain/repurchase.ts). lib/ml/sync.ts já gravava, mas o webhook
       * NÃO — então todo pedido que entrou por aqui e nunca passou por um
       * sync completo ficava sem comprador e sumia da conta de compradores
       * únicos, jogando a taxa pra baixo. Como é o webhook que registra as
       * vendas em tempo real, isso atingia justamente os pedidos recentes.
       */
      // Spread condicional, NAO `buyer_id: ... : null`: a gravacao usa
      // { merge: true }, entao escrever null APAGARIA o buyer_id que um sync
      // completo ja tivesse salvo. Quando o webhook nao traz o comprador, o
      // certo e nao tocar no campo.
      ...(((order.buyer as Record<string, unknown> | undefined)?.id)
        ? { buyer_id: String((order.buyer as Record<string, unknown>).id) }
        : {}),
      items,
      pack_id: order.pack_id ? String(order.pack_id) : null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    // ── Venda confirmada ─────────────────────────────────────────
    // Toda a regra (idade, classificacao, dedupe, agrupamento, push) vive em
    // lib/ml/notificar-venda.ts — a MESMA que o sync usa como rede de
    // seguranca. Duplicar aqui era o que permitia os dois caminhos divergirem.
    const resultadoVenda = await notificarVendaConfirmada({
      orderId,
      status,
      dateCreated: dataCriacao,
      items,
      // O ID do envio, não o valor: `order.shipping_cost` é o que o comprador
      // pagou (zero em frete grátis), e usá-lo inflava a margem do aviso.
      shippingId: String((order.shipping as Record<string, unknown>)?.id ?? "").trim() || null,
    });

    /**
     * ── Cancelamento ──
     * Só avisa se a venda chegou a ser ANUNCIADA como venda. A pergunta certa
     * é "existe evento sale_paid deste pedido?", não "o doc do pedido estava
     * com status paid?": o sync sobrescreve esse status direto pra
     * "cancelled" (mesma corrida descrita em vendaRecente), e aí o
     * cancelamento de uma venda que o usuário JÁ tinha visto passava batido.
     * `jaConheciaComoPago` fica como atalho — se o doc ainda diz "paid", não
     * precisa nem ler notification_events.
     */
    const anunciamosAVenda = status !== "cancelled"
      ? false // nem chega a ler: só o ramo de cancelamento usa este sinal
      : jaConheciaComoPago ||
        (await db.collection("notification_events").doc(`sale_paid:${orderId}`).get()).exists;
    if (status === "cancelled" && anunciamosAVenda) {
      const dedupeKey = `sale_cancelled:${orderId}`;
      const valorImpacto = Number(order.total_amount ?? antes.data()?.total_amount ?? 0);
      const content = buildCancelContent(primeiro, items.length, valorImpacto);
      const { created, eventId } = await createNotificationEventIdempotent({
        type: "sale_cancelled", severity: "warning", entityType: "order", entityId: orderId, dedupeKey,
        title: content.title, body: content.body,
        orderId, orderExternalId: orderId,
        productName: primeiro, productCount: items.length,
        grossAmount: valorImpacto, financialState: "estimated",
        deepLink: buildOrderDeepLink(orderId),
      });
      if (created) {
        const payload = buildPayload(eventId, "sale_cancelled", content.title, content.body, {
          orderId, productName: primeiro, grossAmount: valorImpacto, financialState: "estimated", tag: `sale-${orderId}`,
        });
        await enviarEPersistirEntrega(eventId, "sale_cancelled", payload);
      }
    }

    await registrarChamada({
      orderId, topic: body?.topic ?? "", status,
      resultado: resultadoVenda.estado,
      enviados: "enviados" in resultadoVenda ? resultadoVenda.enviados : null,
      ok: true,
    });
    return NextResponse.json({ ok: true, venda: resultadoVenda.estado });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Erro TEM que virar registro: sem isso, "o ML chamou e nós quebramos"
    // era indistinguível de "o ML nunca chamou".
    await registrarChamada({ orderId, topic: body?.topic ?? "", ok: false, erro: msg.slice(0, 300) });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// O ML às vezes bate com GET pra checar se a URL responde antes de salvar a
// configuração de notificações no painel de developers.
export async function GET() {
  return NextResponse.json({ ok: true, service: "ml-orders-webhook" });
}
