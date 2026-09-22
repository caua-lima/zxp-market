import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { motivoRecusaDoCron } from "@/lib/api-auth";
import { currentMonthRangeBR, previousMonthRangeBR, syncOrdersRange, syncReturnsRange, syncClaimsRange } from "@/lib/ml/sync";
import { enviarLembretesDeTarefa } from "@/lib/task-reminders-run";
import { ehDomingoBR, fazerBackupSemanal } from "@/lib/backup-run";
import { dispararMarcos } from "@/lib/marcos-gatilho";
import { verificarDevolucoes } from "@/lib/devolucoes-run";
import { verificarEstoqueBaixo } from "@/lib/estoque-alerta-run";
import { podarWebhookLog } from "@/lib/webhook-log-prune";
import { registrarExecucaoDoCron } from "@/lib/cron-heartbeat";
import { varrerEntregasPendentes } from "@/lib/notification-dispatch";

export const maxDuration = 60;

/**
 * ⚠ AGENDAMENTO: o plano Hobby da Vercel só aceita cron DIÁRIO. Qualquer
 * expressão que rode mais de uma vez por dia (ex.: "0 9,15,23 * * *") faz o
 * DEPLOY INTEIRO falhar com "Hobby accounts are limited to daily cron jobs" —
 * e o `npm run build` local passa normalmente, porque essa validação só
 * acontece no deploy. Já aconteceu uma vez aqui: o app parou de subir e não
 * havia erro de build pra explicar. Se precisar de sincronização mais
 * frequente, NÃO mexa no schedule — o webhook já mantém os pedidos em tempo
 * real e o Dashboard ressincroniza sozinho a cada 15 min enquanto aberto;
 * este cron é rede de segurança, não o caminho principal.
 *
 * Endpoint de sincronização automática, chamado pelo Vercel Cron.
 * O Vercel injeta `Authorization: Bearer <CRON_SECRET>` quando a env
 * CRON_SECRET está configurada — validamos isso via isCronRequest.
 *
 * Sincroniza o mês atual (pedidos + devoluções) para manter o dashboard
 * sempre atualizado sem depender do botão manual.
 */
export async function GET(req: Request) {
  const recusa = motivoRecusaDoCron(req);
  if (recusa) {
    /**
     * O MOTIVO vai no corpo porque as correções são opostas: variável ausente
     * se resolve na Vercel, segredo errado se resolve conferindo o valor.
     * Nada aqui vaza o segredo — só diz qual dos dois casos é.
     */
    console.error(`[cron] chamada recusada: ${recusa}`);
    return NextResponse.json({ error: "unauthorized", motivo: recusa }, { status: 401 });
  }

  try {
    const accessToken = await getMlAccessToken();

    /**
     * Mes corrente + MES ANTERIOR.
     *
     * So o mes corrente deixava um buraco real: no dia 1o, tudo que ainda ia
     * mudar no mes que acabou parava de ser atualizado pra sempre — repasse do
     * Mercado Pago (money_release_date/net_received costumam cair dias depois
     * da venda), devolucao concluida em disputa, status de envio finalizando.
     * O fechamento do mes ficava congelado num estado que ainda ia mudar.
     */
    const atual = currentMonthRangeBR();
    const anterior = previousMonthRangeBR();

    /**
     * ─── POR QUE allSettled, E NÃO all ──────────────────────────────────
     *
     * Com `Promise.all`, uma única falha de sync rejeitava tudo e o cron
     * abortava ali — levando junto o backup semanal, os marcos, o alerta de
     * estoque e o aviso de devolução, TODOS em silêncio. E o sync é a parte
     * menos confiável daqui: são dezenas de chamadas ao ML, qualquer uma
     * pode cair.
     *
     * Nenhum desses passos depende do sync ter dado certo: marcos leem o
     * faturamento por HTTP, estoque e devoluções leem ao vivo do ML,
     * lembrete e backup leem o Firestore. Eram independentes no efeito e
     * acoplados só pelo `await` — o pior tipo de acoplamento, porque não
     * aparece até o dia em que falha.
     *
     * Evidência de que isto mordia: `backups_semanais` está vazio, e o
     * backup roda ANTES dos marcos na sequência abaixo.
     */
    const nomes = ["orders/atual", "returns/atual", "claims/atual", "orders/anterior", "returns/anterior", "claims/anterior"];
    /**
     * Sem token, nenhuma chamada ao ML pode sair — mas isso não pode mais
     * derrubar o resto do cron (lembrete, backup, marcos, alerta de estoque,
     * devolução, outbox de push, poda) como acontecia antes com o 400
     * antecipado. Os seis passos entram como "falha" — mesmo formato de uma
     * falha de rede — e o resto da função segue normalmente.
     */
    const resultados: PromiseSettledResult<Awaited<ReturnType<typeof syncOrdersRange>>>[] = accessToken
      ? await Promise.allSettled([
          syncOrdersRange(accessToken, atual),
          syncReturnsRange(accessToken, atual),
          /*
            Reclamacoes/devolucoes ja rodavam no sync-all (botao manual) mas NAO no
            cron: sem alguem abrir o app, devolucao nunca era atualizada sozinha.

            O `.catch(() => 0)` que havia aqui sumiu: ele transformava falha em
            "zero sincronizadas", que se le como sucesso. O allSettled abaixo ja
            garante que uma falha nao derruba o resto, e agora ela aparece.
          */
          syncClaimsRange(accessToken, atual),
          syncOrdersRange(accessToken, anterior),
          syncReturnsRange(accessToken, anterior),
          syncClaimsRange(accessToken, anterior),
        ])
      : nomes.map(() => ({ status: "rejected" as const, reason: new Error("Token ML não encontrado") }));
    /**
     * Falha vira `null`, não zero: "não sincronizou" e "sincronizou nada" são
     * coisas diferentes, e a resposta do cron é o único lugar onde dá pra
     * enxergar isso depois. Os erros vão junto em `syncFalhas`.
     */
    const syncFalhas: string[] = [];
    const valores = resultados.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      const motivo = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(`[cron] sync ${nomes[i]} falhou`, r.reason);
      syncFalhas.push(`${nomes[i]}: ${motivo}`);
      return null;
    });
    const [ordensAtual, devAtual, claimsAtual, ordensAnterior, devAnterior, claimsAnterior] = valores;

    /**
     * A rodada completou?
     *
     * `ok: true` significava só "a função não explodiu". Com seis etapas
     * independentes e `allSettled`, é perfeitamente possível a resposta dizer
     * ok enquanto metade do período não sincronizou — e era o que acontecia,
     * porque o número de registros de uma etapa que falhou era `null` ou zero,
     * que se lê como "não havia nada".
     *
     * O índice tem que vir do array ORIGINAL (`valores`), não de uma versão já
     * filtrada: mapear `etapasSync.map((e, i) => nomes[i])` depois de um
     * `.filter()` desalinha `i` assim que a primeira etapa falha — a segunda
     * etapa bem-sucedida herda o nome da PRIMEIRA. Guardar o índice original
     * junto do valor evita o desalinhamento.
     */
    const etapasSync = valores
      .map((v, i) => ({ v, i }))
      .filter((x): x is { v: NonNullable<typeof valores[number]>; i: number } => x.v != null);
    const syncCompleto = syncFalhas.length === 0 && etapasSync.every((e) => e.v.completo);
    const syncIncompletas = etapasSync
      .filter((e) => !e.v.completo)
      .map((e) => nomes[e.i]);

    // Lembrete de prazo das tarefas pega carona nesta execução diária em vez
    // de virar um cron próprio (ver o aviso do Hobby acima). Best-effort: um
    // erro aqui não pode derrubar a sincronização de pedidos, que é o que
    // realmente importa neste endpoint.
    const lembretes = await enviarLembretesDeTarefa().catch((err: unknown) => {
      console.error("[cron] lembrete de tarefa falhou", err);
      return null;
    });

    // Backup semanal (ver lib/backup-run.ts) — igual ao lembrete, pega carona
    // nesta execução diária em vez de virar cron próprio, e só faz algo aos
    // domingos. Best-effort: nunca pode derrubar a sincronização de pedidos.
    const backup = ehDomingoBR()
      ? await fazerBackupSemanal().catch((err: unknown) => {
          console.error("[cron] backup semanal falhou", err);
          return null;
        })
      : null;

    /**
     * Marcos comemorativos. Pega carona nesta execucao diaria, como o lembrete
     * e o backup — o plano Hobby da Vercel so aceita um cron por dia (ver o
     * aviso no topo). Best-effort: comemoracao nao pode derrubar a
     * sincronizacao, que e o que mantem o painel correto.
     *
     * O faturamento vem do MESMO agregado que o Dashboard usa. Recalcular aqui
     * criaria uma segunda definicao de faturamento, e definicao duplicada foi a
     * origem de quase todo numero errado nesta base.
     */
    const marcos = await (async () => {
      const origem = new URL(req.url).origin;
      return dispararMarcos(origem, req.headers.get("authorization"));
    })();

    /**
     * Estoque no mínimo. Depois do sync de propósito: as vendas que acabaram
     * de entrar já baixaram o estoque no ML, então a leitura aqui é a mais
     * recente possível. Best-effort — nunca derruba o cron.
     */
    const estoqueBaixo = await verificarEstoqueBaixo().catch((err) => {
      console.error("[cron] alerta de estoque falhou", err);
      return null;
    });

    /**
     * Devoluções e reclamações. Os tipos existiam no app desde sempre, mas
     * ninguém os emitia — a rota chamada "returns" busca cancelamento, que é
     * outra coisa e já vem pelo webhook.
     */
    const devolucoes = await verificarDevolucoes().catch((err) => {
      console.error("[cron] aviso de devolucao falhou", err);
      return null;
    });

    /**
     * Varredura do outbox de push: reenvia o que ficou pendente (retry vencido,
     * concessão de worker que morreu, fan-out incompleto), refaz espelhos
     * pendentes e apaga o que já passou da retenção. Depois de tudo que PRODUZ
     * aviso, pra pegar também o que acabou de ser publicado. Best-effort.
     */
    const entregasPush = await varrerEntregasPendentes({ limpar: true }).catch((err) => {
      console.error("[cron] varredura do outbox de push falhou", err);
      return null;
    });

    /**
     * Poda da trilha do webhook. Por ultimo de proposito: e manutencao, e
     * nao pode competir por tempo com nada que o usuario percebe.
     */
    const poda = await podarWebhookLog().catch((err) => {
      console.error("[cron] poda do webhook_log falhou", err);
      return null;
    });

    /**
     * Carimbo da execucao. Sem ele, "o cron rodou?" so dava pra responder
     * procurando efeitos colaterais — e quando NADA rodou, nao ha efeito
     * nenhum pra procurar.
     */
    await registrarExecucaoDoCron({
      syncFalhas: syncFalhas.length,
      lembretes: lembretes?.enviados ?? null,
      backup: backup?.feito ?? false,
      marcos: marcos
        ? marcos.faturamento.length + marcos.dia.length + marcos.recordes.length
          + (marcos.reputacao ? 1 : 0)
        : null,
      estoqueBaixo: estoqueBaixo?.avisados?.length ?? null,
      devolucoes: devolucoes?.avisados?.length ?? null,
      poda: poda?.apagados ?? null,
    });

    return NextResponse.json({
      // "Não explodiu" e "sincronizou tudo" viraram campos diferentes.
      ok: syncCompleto,
      sincronizacaoCompleta: syncCompleto,
      etapasIncompletas: syncIncompletas.length > 0 ? syncIncompletas : undefined,
      poda,
      marcos,
      devolucoes,
      estoqueBaixo,
      entregasPush,
      syncFalhas: syncFalhas.length > 0 ? syncFalhas : undefined,
      atual: { orders: ordensAtual, returns: devAtual, claims: claimsAtual, range: atual },
      anterior: { orders: ordensAnterior, returns: devAnterior, claims: claimsAnterior, range: anterior },
      lembretesTarefa: lembretes,
      backupSemanal: backup,
      at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "cron_sync_failed", details: msg }, { status: 500 });
  }
}
