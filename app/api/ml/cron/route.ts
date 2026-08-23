import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/api-auth";
import { currentMonthRangeBR, previousMonthRangeBR, syncOrdersRange, syncReturnsRange, syncClaimsRange } from "@/lib/ml/sync";
import { enviarLembretesDeTarefa } from "@/lib/task-reminders-run";
import { ehDomingoBR, fazerBackupSemanal } from "@/lib/backup-run";
import {
  getMlAccessToken,
  getSellerId,
  lerUltimoTenantSincronizado,
  tenantCol,
  listarTenantsComLicenca,
  salvarUltimoTenantSincronizado,
} from "@/lib/tenant";
import { cabeMaisUm, planejarSync } from "@/lib/domain/cron-tenants";
import { verificarMarcos } from "@/lib/marcos-run";
import { classificarVenda, detectarPedidosSubstituidos } from "@/lib/domain/venda-status";

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


/**
 * Faturamento liquido do mes, do tenant, lido dos pedidos ja sincronizados.
 *
 * Le do banco (nao ao vivo) porque roda LOGO DEPOIS do sync daquele tenant —
 * os pedidos acabaram de ser gravados. Buscar de novo no ML seria pagar duas
 * vezes pela mesma informacao.
 *
 * Usa a MESMA classificacao do Dashboard (classificarVenda), incluindo a
 * separacao de envio: um marco disparado sobre um numero inflado comemoraria
 * o que nao aconteceu.
 */
async function faturamentoDoMes(tenantId: string, mes: string): Promise<number> {
  const snap = await tenantCol(tenantId, "ml_orders")
    .where("date_created", ">=", `${mes}-01`)
    .where("date_created", "<=", `${mes}-31T23:59:59.999-03:00`)
    .get();

  const pedidos = snap.docs.map((d) => d.data());
  const substituidos = detectarPedidosSubstituidos(
    pedidos.map((o) => ({
      orderId: String(o.order_id ?? ""),
      packId: o.pack_id as string | null | undefined,
      status: o.status,
      buyerId: (o.buyer_id as string | null | undefined) ?? null,
      dia: String(o.date_created ?? "").slice(0, 10),
      itens: ((o.items as { item_id?: string; quantity?: number }[]) ?? []).map((it) => ({
        itemId: String(it.item_id ?? ""),
        qty: Number(it.quantity ?? 1),
      })),
    })),
  );

  let total = 0;
  for (const o of pedidos) {
    const classe = classificarVenda({
      status: o.status,
      noCacheDeCancelados: false,
      temDevolucaoConcluida: false,
      substituidoNoPacote: substituidos.has(String(o.order_id ?? "")),
    }).classe;
    if (classe === "valida") total += Number(o.total_amount ?? 0);
  }
  return total;
}

/**
 * Sincroniza UM tenant. Extraído do handler porque agora ele roda em laço —
 * e porque o erro de um cliente não pode derrubar o dos outros: cada volta é
 * um try próprio, e o resultado (ou a falha) entra no relatório.
 */
async function sincronizarTenant(tenantId: string) {
  const accessToken = await getMlAccessToken(tenantId);
  if (!accessToken) return { tenantId, ok: false, erro: "sem conexão com o Mercado Livre" };

  const sellerId = await getSellerId(tenantId);

  /**
   * Mes corrente + MES ANTERIOR.
   *
   * So o mes corrente deixava um buraco real: no dia 1o, tudo que ainda ia
   * mudar no mes que acabou parava de ser atualizado pra sempre — repasse do
   * Mercado Pago (money_release_date/net_received costumam cair dias depois
   * da venda), devolucao concluida em disputa, status de envio finalizando.
   */
  const atual = currentMonthRangeBR();
  const anterior = previousMonthRangeBR();

  const [ordensAtual, devAtual, claimsAtual, ordensAnterior, devAnterior, claimsAnterior] = await Promise.all([
    syncOrdersRange(tenantId, accessToken, sellerId, atual),
    syncReturnsRange(tenantId, accessToken, sellerId, atual),
    // Best-effort: reclamacao que falha nao pode derrubar a sincronizacao de
    // pedidos, que e o que realmente importa aqui.
    syncClaimsRange(tenantId, accessToken, atual).catch(() => 0),
    syncOrdersRange(tenantId, accessToken, sellerId, anterior),
    syncReturnsRange(tenantId, accessToken, sellerId, anterior),
    syncClaimsRange(tenantId, accessToken, anterior).catch(() => 0),
  ]);

  // Lembrete e backup pegam carona nesta execucao diaria em vez de virarem
  // cron proprio (ver o aviso do plano Hobby acima). Best-effort, os dois.
  const lembretes = await enviarLembretesDeTarefa(tenantId).catch((err: unknown) => {
    console.error(`[cron] lembrete de tarefa falhou (${tenantId})`, err);
    return null;
  });
  const backup = ehDomingoBR()
    ? await fazerBackupSemanal(tenantId).catch((err: unknown) => {
        console.error(`[cron] backup semanal falhou (${tenantId})`, err);
        return null;
      })
    : null;

  /**
   * Marcos comemorativos DESTE tenant. Dentro de sincronizarTenant de
   * proposito: o faturamento e a reputacao sao de cada cliente, e um marco
   * disparado com o numero de outro seria pior que marco nenhum.
   *
   * Best-effort: comemoracao nunca pode derrubar a sincronizacao, que e o que
   * mantem o painel correto.
   */
  const marcos = await (async () => {
    try {
      const mes = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
      // Faturamento do MESMO agregado que o painel usa — recalcular aqui
      // criaria uma segunda definicao, e definicao duplicada foi a origem de
      // quase todo numero errado nesta base.
      const liquido = ordensAtual > 0 ? await faturamentoDoMes(tenantId, mes) : 0;
      return await verificarMarcos(tenantId, liquido, mes);
    } catch (err) {
      console.error(`[cron] marcos falharam (${tenantId})`, err);
      return null;
    }
  })();

  return {
    tenantId,
    ok: true,
    marcos,
    atual: { orders: ordensAtual, returns: devAtual, claims: claimsAtual },
    anterior: { orders: ordensAnterior, returns: devAnterior, claims: claimsAnterior },
    lembretesTarefa: lembretes,
    backupSemanal: backup,
  };
}

export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const inicio = Date.now();

  /**
   * ── AGORA PERCORRE TODOS OS TENANTS ──
   *
   * Antes isto resolvia UM tenant e recusava quando existia um segundo — trava
   * deliberada, porque sincronizar o cliente errado seria pior que não rodar.
   * O plano de execução (quem roda, em que ordem) vive em
   * lib/domain/cron-tenants.ts, testado à parte.
   */
  const [tenants, ultimo] = await Promise.all([
    listarTenantsComLicenca(),
    lerUltimoTenantSincronizado(),
  ]);
  const plano = planejarSync(tenants, Date.now(), ultimo);

  const resultados: unknown[] = [];
  const semTempo: string[] = [];

  for (const t of plano.rodar) {
    /**
     * Orçamento de tempo: começar um tenant e ser cortado no meio deixa
     * escrita parcial e nenhum registro. Parar antes, com o nome de quem
     * ficou pra próxima, troca falha silenciosa por informação — e o rodízio
     * garante que ele venha primeiro na rodada seguinte.
     */
    if (!cabeMaisUm(inicio, Date.now(), maxDuration * 1000)) {
      semTempo.push(t.tenantId);
      continue;
    }
    try {
      resultados.push(await sincronizarTenant(t.tenantId));
      await salvarUltimoTenantSincronizado(t.tenantId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Um cliente com token expirado nao pode impedir a sincronizacao dos
      // outros — este catch e a diferenca entre "um cliente parado" e "todos".
      console.error(`[cron] falhou (${t.tenantId})`, err);
      resultados.push({ tenantId: t.tenantId, ok: false, erro: msg.slice(0, 200) });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: { total: tenants.length, sincronizados: resultados.length },
    resultados,
    // Nada some sem explicacao: licenca vencida/suspensa e falta de tempo
    // aparecem nomeados.
    pulados: plano.pulados,
    semTempo,
    duracaoMs: Date.now() - inicio,
    at: new Date().toISOString(),
  });
}
