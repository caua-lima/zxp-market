import { NextResponse } from "next/server";
import { getMlAccessToken } from "../token";
import { isCronRequest } from "@/lib/api-auth";
import { currentMonthRangeBR, previousMonthRangeBR, syncOrdersRange, syncReturnsRange, syncClaimsRange } from "@/lib/ml/sync";
import { enviarLembretesDeTarefa } from "@/lib/task-reminders-run";
import { ehDomingoBR, fazerBackupSemanal } from "@/lib/backup-run";
import { verificarMarcos } from "@/lib/marcos-run";
import { verificarEstoqueBaixo } from "@/lib/estoque-alerta-run";

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

    const resultados = await Promise.all([
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
    const [ordensAtual, devAtual, claimsAtual, ordensAnterior, devAnterior, claimsAnterior] = resultados;

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
        const rm = await fetch(`${origem}/api/ml/metrics?month=${mesAtual}`, {
          headers: auth ? { Authorization: auth } : {},
          cache: "no-store",
        });
        if (!rm.ok) return null;
        const j = (await rm.json()) as { faturamentoLiquido?: number };
        return await verificarMarcos(Number(j.faturamentoLiquido ?? 0), mesAtual);
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

    return NextResponse.json({
      ok: true,
      marcos,
      estoqueBaixo,
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
