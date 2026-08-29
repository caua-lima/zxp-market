import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { isCronRequest } from "@/lib/api-auth";
import { currentMonthRangeBR, previousMonthRangeBR, syncOrdersRange, syncReturnsRange, syncClaimsRange } from "@/lib/ml/sync";
import { enviarLembretesDeTarefa } from "@/lib/task-reminders-run";
import { ehDomingoBR, fazerBackupSemanal } from "@/lib/backup-run";
import { verificarMarcos } from "@/lib/marcos-run";
import { verificarDevolucoes } from "@/lib/devolucoes-run";
import { verificarEstoqueBaixo } from "@/lib/estoque-alerta-run";
import { podarWebhookLog } from "@/lib/webhook-log-prune";

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
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = await getMlAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Token ML não encontrado" }, { status: 400 });
    }

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
    const resultados = await Promise.allSettled([
      syncOrdersRange(accessToken, atual),
      syncReturnsRange(accessToken, atual),
      // Reclamacoes/devolucoes ja rodavam no sync-all (botao manual) mas NAO
      // no cron: sem alguem abrir o app, devolucao nunca era atualizada
      // sozinha. Best-effort, igual la — nao pode derrubar o resto.
      syncClaimsRange(accessToken, atual).catch(() => 0),
      syncOrdersRange(accessToken, anterior),
      syncReturnsRange(accessToken, anterior),
      syncClaimsRange(accessToken, anterior).catch(() => 0),
    ]);
    /**
     * Falha vira `null`, não zero: "não sincronizou" e "sincronizou nada" são
     * coisas diferentes, e a resposta do cron é o único lugar onde dá pra
     * enxergar isso depois. Os erros vão junto em `syncFalhas`.
     */
    const syncFalhas: string[] = [];
    const nomes = ["orders/atual", "returns/atual", "claims/atual", "orders/anterior", "returns/anterior", "claims/anterior"];
    const valores = resultados.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      const motivo = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(`[cron] sync ${nomes[i]} falhou`, r.reason);
      syncFalhas.push(`${nomes[i]}: ${motivo}`);
      return null;
    });
    const [ordensAtual, devAtual, claimsAtual, ordensAnterior, devAnterior, claimsAnterior] = valores;

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
      try {
        const mesAtual = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
        const origem = new URL(req.url).origin;
        const auth = req.headers.get("authorization");
        /**
         * Faturamento é best-effort. Falhar aqui NÃO pode cancelar a checagem
         * de reputação: eram duas conquistas independentes amarradas numa
         * chamada só, e quando esta falhava (401 do cron, que era o caso) as
         * duas morriam caladas.
         */
        let faturamento: number | null = null;
        try {
          const rm = await fetch(`${origem}/api/ml/metrics?month=${mesAtual}`, {
            headers: auth ? { Authorization: auth } : {},
            cache: "no-store",
          });
          if (rm.ok) {
            const j = (await rm.json()) as { faturamentoLiquido?: number };
            faturamento = Number(j.faturamentoLiquido ?? 0);
          } else {
            console.error("[cron] faturamento do mes indisponivel:", rm.status);
          }
        } catch (err) {
          console.error("[cron] faturamento do mes falhou", err);
        }
        return await verificarMarcos(faturamento, mesAtual);
      } catch (err) {
        console.error("[cron] marcos falharam", err);
        return null;
      }
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
     * Poda da trilha do webhook. Por ultimo de proposito: e manutencao, e
     * nao pode competir por tempo com nada que o usuario percebe.
     */
    const poda = await podarWebhookLog().catch((err) => {
      console.error("[cron] poda do webhook_log falhou", err);
      return null;
    });

    return NextResponse.json({
      ok: true,
      poda,
      marcos,
      devolucoes,
      estoqueBaixo,
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
