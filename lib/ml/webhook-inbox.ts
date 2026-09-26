import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { gravarPedidos } from "@/lib/ml/gravar-pedido";
import { buildPayload, notificarVendaConfirmada } from "@/lib/ml/notificar-venda";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { enviarEPersistirEntrega } from "@/lib/notification-dispatch";
import { instanteDaConfirmacao } from "@/lib/domain/confirmacao-de-venda";
import { estadoDoPedido, mapOrderItems } from "@/lib/domain/estado-do-pedido";
import { buildCancelContent, buildOrderDeepLink } from "@/lib/domain/notifications";
import {
  APAGAR,
  aoConcluir,
  aoReceber,
  aoReivindicar,
  idDoItem,
  pedidoEhDoVendedor,
  podeReivindicar,
  type Alteracao,
  type Desfecho,
  type ItemInbox,
} from "@/lib/domain/webhook-inbox";

const ML_API = "https://api.mercadolibre.com";
export const COLECAO_INBOX = "ml_webhook_inbox";

const inbox = () => getAdminDb().collection(COLECAO_INBOX);

/** `APAGAR` (domínio, sem Firestore) vira `FieldValue.delete()`. */
function paraFirestore(a: Alteracao): Record<string, unknown> {
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v === APAGAR ? FieldValue.delete() : v]));
}

/**
 * Trilha de cada notificação processada — o que decidimos e o erro resumido,
 * nunca token nem corpo. Consultável em /api/ml/diagnostico-push.
 */
async function registrarChamada(dados: Record<string, unknown>) {
  try {
    await getAdminDb().collection("webhook_log").add({ ...dados, at: new Date().toISOString(), ts: Date.now() });
  } catch { /* log nunca pode derrubar o processamento */ }
}

/**
 * Grava a notificação no inbox. É a ÚNICA coisa que a rota faz antes de
 * responder — uma transação, uma leitura e uma escrita, dentro dos 500 ms que
 * o ML dá. Se ela falhar, a rota responde erro e o ML retenta: sem registro
 * durável não se confirma recebimento.
 */
export async function receberNotificacao(nova: { topic: string; orderId: string; sellerId: string }, agora = Date.now()) {
  const db = getAdminDb();
  const ref = inbox().doc(idDoItem(nova.topic, nova.orderId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? (snap.data() as ItemInbox) : undefined;
    tx.set(ref, paraFirestore(aoReceber(atual, nova, agora)), { merge: true });
  });
}

export type ResultadoItem =
  | { id: string; estado: "nao_elegivel" }
  | { id: string; estado: "perdeu_concessao"; desfecho: Desfecho }
  | { id: string; estado: "concluido"; desfecho: Desfecho };

/** Processa UM item: assume a concessão, trabalha fora da transação, conclui. */
export async function processarItem(
  id: string,
  processar: (orderId: string, sellerId: string) => Promise<Desfecho> = processarNotificacaoDePedido,
): Promise<ResultadoItem> {
  const db = getAdminDb();
  const ref = inbox().doc(id);
  const dono = randomUUID();

  const item = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? (snap.data() as ItemInbox) : undefined;
    if (!atual || !podeReivindicar(atual, Date.now())) return null;
    tx.update(ref, paraFirestore(aoReivindicar(atual, dono, Date.now())));
    return atual;
  });
  if (!item) return { id, estado: "nao_elegivel" };

  // Fora da transação: o Firestore reexecuta o callback em contenção, e aqui
  // dentro há chamada ao ML e push.
  let desfecho: Desfecho;
  try {
    desfecho = await processar(item.orderId, item.sellerId);
  } catch (err) {
    desfecho = { tipo: "falha", erro: err instanceof Error ? err.message : String(err) };
    // Erro TEM que virar registro: sem isso, "o ML chamou e nós quebramos"
    // era indistinguível de "o ML nunca chamou".
    await registrarChamada({ orderId: item.orderId, topic: item.topic, ok: false, erro: desfecho.erro.slice(0, 300) });
  }

  const concluiu = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const alteracao = aoConcluir(snap.exists ? (snap.data() as ItemInbox) : undefined, dono, desfecho, Date.now());
    if (!alteracao) return false;
    tx.update(ref, paraFirestore(alteracao));
    return true;
  });
  return concluiu ? { id, estado: "concluido", desfecho } : { id, estado: "perdeu_concessao", desfecho };
}

/**
 * Varre o que está elegível: pendente vencido e concessão de processo morto.
 *
 * Roda de carona depois de cada webhook e no cron diário — o plano gratuito da
 * Vercel não tem worker frequente (S09 trata disso). Mais antigos primeiro, com
 * teto de itens e de tempo pra caber na função de quem chamou.
 */
export async function varrerInbox(opcoes: { limite?: number; orcamentoMs?: number } = {}) {
  const limite = opcoes.limite ?? 50;
  const prazo = Date.now() + (opcoes.orcamentoMs ?? 15_000);
  const snap = await inbox().where("elegivelEm", "<=", Date.now()).orderBy("elegivelEm").limit(limite).get();

  const resumo = { elegiveis: snap.size, feitos: 0, descartados: 0, falhas: 0, parouPorTempo: false };
  for (const doc of snap.docs) {
    if (Date.now() >= prazo) { resumo.parouPorTempo = true; break; }
    const r = await processarItem(doc.id).catch(() => null);
    if (!r || r.estado === "nao_elegivel") continue;
    if (r.desfecho.tipo === "feito") resumo.feitos++;
    else if (r.desfecho.tipo === "descartado") resumo.descartados++;
    else resumo.falhas++;
  }
  return resumo;
}

/**
 * Apaga itens concluídos há mais de `diasRetencao` — um por pedido, pra sempre,
 * seria a mesma coleção sem teto que o `webhook_log` já foi.
 *
 * Só `feito` e `descartado`: a fila de falhas (`falhou`) fica, é o que alguém
 * precisa ver. E cada delete leva a precondição da leitura: se uma notificação
 * nova reviveu o item entre a consulta e o delete, o delete falha e ele fica.
 */
export async function podarInbox(opcoes: { diasRetencao?: number; limite?: number } = {}) {
  const corte = Date.now() - (opcoes.diasRetencao ?? 30) * 86_400_000;
  const snap = await inbox().where("concluidoEm", "<", corte).limit(opcoes.limite ?? 300).get();
  let apagados = 0;
  await Promise.all(snap.docs.map(async (d) => {
    const estado = d.get("estado");
    if (estado !== "feito" && estado !== "descartado") return;
    try {
      await d.ref.delete({ lastUpdateTime: d.updateTime });
      apagados++;
    } catch { /* mudou depois da leitura: fica pra próxima */ }
  }));
  return { apagados };
}

/**
 * O trabalho que a rota fazia ANTES de responder: busca o estado atual do
 * pedido, confere que é nosso, grava (com a guarda de versão do S12) e produz
 * os avisos. Lança = falha que vale retentar; devolve `descartado` = nada a
 * fazer, de forma definitiva.
 */
export async function processarNotificacaoDePedido(orderId: string, sellerId: string): Promise<Desfecho> {
  const token = await getValidMlAccessToken();
  const res = await fetchML(`${ML_API}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 404) {
    // Pedido de teste/sandbox do próprio ML: não existe pra nós, e retentar não muda isso.
    await registrarChamada({ orderId, topic: "orders_v2", ok: true, resultado: "nao_encontrado" });
    return { tipo: "descartado", resultado: "nao_encontrado" };
  }
  if (!res.ok) throw new Error(`ML orders ${res.status}`);

  const order = (await res.json()) as Record<string, unknown>;
  if (!pedidoEhDoVendedor(order, sellerId)) {
    await registrarChamada({ orderId, topic: "orders_v2", ok: true, resultado: "nao_e_do_vendedor" });
    return { tipo: "descartado", resultado: "nao_e_do_vendedor" };
  }

  const status = String(order.status ?? "");
  const items = mapOrderItems(order);
  const primeiro = items[0]?.title || "Pedido";
  const db = getAdminDb();

  // Mantém o dashboard atualizado mesmo em chamadas que não geram evento
  // (troca de status de envio, etc.) — sincronização completa (frete,
  // repasse) continua vindo do cron/sync manual, isto aqui é só o essencial.
  // O mesmo estado que o sync grava, e só se este retrato não for mais velho
  // que o gravado (S12).
  const [gravacao] = await gravarPedidos(db, [{ orderId, estado: estadoDoPedido(order) }]);
  const antes = gravacao.antes;
  /**
   * "Já era paga ANTES de nós existirmos como registro" — só serve pro
   * cancelamento, que precisa saber se a venda chegou a valer. Para a venda
   * em si NÃO se usa este sinal: ver vendaRecente() em lib/ml/notificar-venda.
   */
  const jaConheciaComoPago = antes?.status === "paid";

  // ── Venda confirmada ─────────────────────────────────────────
  // Toda a regra (idade, classificacao, dedupe, agrupamento, push) vive em
  // lib/ml/notificar-venda.ts — a MESMA que o sync usa como rede de segurança.
  const resultadoVenda = await notificarVendaConfirmada({
    orderId,
    status,
    dateCreated: String(order.date_created ?? ""),
    // A aprovação do pagamento, não a criação, é o que diz se a venda é nova.
    datePaid: instanteDaConfirmacao(order),
    items,
    // O ID do envio, não o valor: `order.shipping_cost` é o que o comprador
    // pagou (zero em frete grátis), e usá-lo inflava a margem do aviso.
    shippingId: String((order.shipping as Record<string, unknown>)?.id ?? "").trim() || null,
  });

  /**
   * ── Cancelamento ──
   * Só avisa se a venda chegou a ser ANUNCIADA como venda. A pergunta certa
   * é "existe evento sale_paid deste pedido?", não "o doc do pedido estava
   * com status paid?": o sync pode ter gravado "cancelled" antes, e aí o
   * cancelamento de uma venda que o usuário JÁ tinha visto passava batido.
   * `jaConheciaComoPago` fica como atalho — se o doc ainda diz "paid", não
   * precisa nem ler notification_events.
   */
  const anunciamosAVenda = status !== "cancelled"
    ? false
    : jaConheciaComoPago ||
      (await db.collection("notification_events").doc(`sale_paid:${orderId}`).get()).exists;
  if (status === "cancelled" && anunciamosAVenda) {
    const dedupeKey = `sale_cancelled:${orderId}`;
    const valorImpacto = Number(order.total_amount ?? antes?.total_amount ?? 0);
    const content = buildCancelContent(primeiro, items.length, valorImpacto);
    const { eventId } = await createNotificationEventIdempotent({
      type: "sale_cancelled", severity: "warning", entityType: "order", entityId: orderId, dedupeKey,
      title: content.title, body: content.body,
      orderId, orderExternalId: orderId,
      productName: primeiro, productCount: items.length,
      grossAmount: valorImpacto, financialState: "estimated",
      deepLink: buildOrderDeepLink(orderId),
    });
    /**
     * Publica SEMPRE, também quando o evento já existia: um cancelamento cujo
     * envio falhou logo depois de criar o evento precisa de nova chance.
     * Publicar é idempotente — o que já foi aceito não é reenviado.
     */
    const payload = buildPayload(eventId, "sale_cancelled", content.title, content.body, {
      orderId, productName: primeiro, grossAmount: valorImpacto, financialState: "estimated", tag: `sale-${orderId}`,
    });
    await enviarEPersistirEntrega(eventId, "sale_cancelled", payload, false, { origem: "webhook:cancelamento" });
  }

  await registrarChamada({
    orderId, topic: "orders_v2", status,
    resultado: resultadoVenda.estado,
    enviados: "enviados" in resultadoVenda ? resultadoVenda.enviados : null,
    estadoGravado: gravacao.gravouEstado,
    ok: true,
  });
  return { tipo: "feito", resultado: resultadoVenda.estado };
}
