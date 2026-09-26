import { NextResponse } from "next/server";
import { motivoRecusaDoCron } from "@/lib/api-auth";
import { registrarExecucaoDoCron } from "@/lib/cron-heartbeat";
import { varrerInbox } from "@/lib/ml/webhook-inbox";
import { varrerEntregasPendentes } from "@/lib/notification-dispatch";

export const maxDuration = 60;

/**
 * O worker frequente — S09 da auditoria SaaS.
 *
 * ─── O QUE FALTAVA ──────────────────────────────────────────────────────
 *
 * O outbox de push e o inbox do webhook já sabiam retentar sozinhos: cada item
 * pendente tem um instante de elegibilidade, e qualquer varredura o acha. O que
 * não existia era QUEM varresse com regularidade. O cron da Vercel, no plano
 * Hobby, roda uma vez por dia (mais que isso e o deploy inteiro falha — ver
 * app/api/ml/cron). No resto do tempo a varredura pegava carona no webhook de
 * uma venda NOVA. Sem venda nova:
 *
 *  - o resumo de fechamento de uma rajada, agendado pro fim da janela com 10
 *    min de validade, expirava sem sair;
 *  - um push em retry esperava até o cron do dia seguinte — e a validade
 *    padrão de uma entrega é 6 h;
 *  - uma notificação do ML cujo processamento falhou ficava no inbox até o cron.
 *
 * ─── QUEM CHAMA ─────────────────────────────────────────────────────────
 *
 * `.github/workflows/worker.yml`, a cada 5 min (o mínimo do GitHub Actions;
 * de graça em repositório público). O GitHub pode atrasar agendamentos sob
 * carga — o intervalo real fica entre 5 e ~15 min. Sem mexer no plano da
 * Vercel, é o que há; o carimbo abaixo aparece em /api/ml/diagnostico-push.
 *
 * Chamar a mais é inofensivo: inbox e outbox usam concessão em transação, e
 * cada item é processado por um worker só.
 */
async function tratar(req: Request) {
  const recusa = motivoRecusaDoCron(req);
  if (recusa) return NextResponse.json({ error: "unauthorized", motivo: recusa }, { status: 401 });

  const inicio = Date.now();
  // Inbox primeiro: o push que sair do processamento de uma notificação vai
  // pro outbox e é entregue na varredura seguinte, na mesma chamada.
  const inbox = await varrerInbox({ limite: 50, orcamentoMs: 20_000 }).catch((err) => {
    console.error("[worker] varredura do inbox falhou", err);
    return null;
  });
  const entregas = await varrerEntregasPendentes({ limite: 200, orcamentoMs: 25_000 }).catch((err) => {
    console.error("[worker] varredura do outbox falhou", err);
    return null;
  });

  const resumo = {
    inbox,
    entregas,
    duracaoMs: Date.now() - inicio,
  };
  await registrarExecucaoDoCron(resumo, "worker");
  // 200 mesmo com etapa falhando: o carimbo e o resumo dizem o que falhou, e um
  // erro aqui faria o GitHub marcar a execução como quebrada a cada 5 min por um
  // problema que a próxima varredura já pode ter resolvido. Só a autorização
  // (acima) responde erro — essa sim é configuração errada.
  return NextResponse.json({ ok: inbox !== null && entregas !== null, ...resumo });
}

export const GET = tratar;
export const POST = tratar;
