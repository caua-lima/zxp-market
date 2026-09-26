import { NextResponse, after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { varrerEntregasPendentes } from "@/lib/notification-dispatch";
import { rotuloDaRecusa, validarNotificacao } from "@/lib/domain/webhook-ml";
import { idDoItem } from "@/lib/domain/webhook-inbox";
import { processarItem, receberNotificacao, varrerInbox } from "@/lib/ml/webhook-inbox";
import { SELLER_ID } from "@/lib/ml/orders";

/**
 * Teto do corpo: uma notificacao do ML tem algumas centenas de bytes. Ler um
 * corpo de megabytes numa rota publica e trabalho de graca pra quem manda.
 */
const LIMITE_CORPO = 16 * 1024;

export const maxDuration = 30;

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
    /**
     * Mapa aninhado, NÃO chave com ponto: `set()` trata "topicos.x" como um
     * nome de campo literal (é `update()` que interpreta ponto como caminho),
     * e o contador ficaria ilegível pra quem lê `data().topicos`. Verificado
     * contra o Firestore: com `merge`, o increment aninhado soma e preserva
     * os outros tópicos do mesmo dia.
     */
    await getAdminDb().collection("webhook_topicos").doc(dia).set({
      dia,
      topicos: { [(topic || "sem_topico").replace(/[.$/[]#]/g, "_")]: FieldValue.increment(1) },
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
  /**
   * Corpo com teto ANTES de desserializar. A rota e publica: o ML chama sem
   * token e nao ha como exigir um, entao tudo que da pra fazer e sair barato
   * de quem manda lixo.
   */
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declarado) && declarado > LIMITE_CORPO) {
    return NextResponse.json({ ok: false, error: "corpo_grande" }, { status: 413 });
  }

  let bruto = "";
  try {
    bruto = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: "corpo_ilegivel" });
  }
  if (bruto.length > LIMITE_CORPO) {
    return NextResponse.json({ ok: false, error: "corpo_grande" }, { status: 413 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(bruto);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" });
  }

  /**
   * Confere o que da pra conferir ANTES de gastar uma chamada a API do ML.
   *
   * A rota so olhava o formato do `resource`. Nao conferia o topico, nem de
   * qual vendedor era a notificacao, nem de qual aplicacao — entao qualquer um
   * que soubesse a URL disparava consulta a API com o NOSSO token e escritas
   * no Firestore, em laco, sem limite.
   *
   * O ML nao assina notificacao: isto nao prova origem e nao finge provar. O
   * objetivo e recusar lixo e engano sem pagar por eles; a garantia de nao
   * duplicar efeito continua sendo a idempotencia pelo dedupeKey.
   */
  const veredito = validarNotificacao(body, {
    sellerId: process.env.ML_SELLER_ID || SELLER_ID,
    appId: process.env.ML_APP_ID,
  });

  if (!veredito.ok) {
    // Contagem por dia, com o motivo: separa "nao configurado" de "configurado
    // no topico errado" de "chamada vinda de fora".
    await contarTopicoIgnorado(rotuloDaRecusa(veredito), new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()));
    return NextResponse.json({ ok: true, ignored: true, motivo: veredito.motivo });
  }
  const orderId = veredito.orderId;

  /**
   * ─── S07: CONFIRMA DURÁVEL, TRABALHA DEPOIS ─────────────────────────────
   *
   * O contrato do ML (página oficial de Notificações) é HTTP 200 em até
   * 500 ms, senão ele pode DESATIVAR os tópicos. A rota consultava o pedido na
   * API do ML, gravava e publicava push ANTES de responder — uma chamada ao ML
   * sozinha já passa disso.
   *
   * Agora: grava a notificação no inbox (uma transação) e responde. Consulta,
   * gravação e avisos rodam depois da resposta; o que falhar fica no inbox com
   * nova tentativa agendada, e a varredura (aqui de carona e no cron) retenta.
   * Ver lib/domain/webhook-inbox.ts.
   */
  try {
    await receberNotificacao({ topic: veredito.topic, orderId, sellerId: veredito.sellerId });
  } catch (err) {
    // Sem registro durável não se confirma recebimento: o erro faz o ML
    // retentar, que é exatamente o que se quer aqui.
    const msg = err instanceof Error ? err.message : String(err);
    await registrarChamada({ orderId, topic: veredito.topic, ok: false, erro: `inbox: ${msg.slice(0, 280)}` });
    return NextResponse.json({ ok: false, error: "inbox_indisponivel" }, { status: 500 });
  }

  /**
   * Depois da resposta, dentro do maxDuration desta rota: primeiro ESTE
   * pedido, depois o que estiver pendente no inbox, depois o outbox de push.
   * O cron da Vercel só roda uma vez por dia no plano gratuito — cada webhook
   * é uma chance barata de varrer o que ficou pra trás.
   */
  after(async () => {
    await processarItem(idDoItem(veredito.topic, orderId)).catch(() => {});
    await varrerInbox({ limite: 10, orcamentoMs: 8_000 }).catch(() => {});
    await varrerEntregasPendentes({ limite: 30, orcamentoMs: 10_000 }).catch(() => {});
  });
  return NextResponse.json({ ok: true, recebido: true });
}

// O ML às vezes bate com GET pra checar se a URL responde antes de salvar a
// configuração de notificações no painel de developers.
export async function GET() {
  return NextResponse.json({ ok: true, service: "ml-orders-webhook" });
}
