import "server-only";
import type { NotificationEventType, SalePushPayload } from "@/lib/domain/notifications";
import type { ContextoDeRajada } from "@/lib/domain/decisao-destinatario";
import { dependenciasReais, limparEntregasAntigas, processarEntregas, publicarEEntregar } from "@/lib/notification-outbox";
import { limparTestesAntigos, repararEspelhosPendentes } from "@/lib/notification-events";
import { limparJanelasAntigas } from "@/lib/notification-janelas";
import { COLECAO_FEED } from "@/lib/domain/notificacao-publico";

/**
 * A porta de entrada que os produtores usam pra mandar push.
 *
 * Todos — venda, cancelamento, devolução, marco, estoque, tarefa, resumos —
 * passam por aqui e por isso ganham, sem código próprio, o que o outbox dá:
 * destino por aparelho, retry só do que falhou, validade, TTL e recuperação
 * pela varredura. Antes, cada produtor tinha um `sendXxx` e uma trilha de
 * entrega própria, e só o caminho de venda tratava o evento já existente.
 *
 * NÃO lança: um problema de entrega nunca pode derrubar o webhook que o
 * disparou (o ML reenviaria e o pedido seria reprocessado). O que falhar fica
 * no outbox, e a varredura tenta de novo.
 */
export async function enviarEPersistirEntrega(
  eventId: string,
  type: NotificationEventType,
  payload: SalePushPayload,
  isSummary = false,
  opcoes: {
    audiencia?: string[] | null;
    origem?: string;
    validadeMs?: number;
    pushId?: string;
    rajada?: ContextoDeRajada;
    agrupamento?: { janelaId: string; n: number };
    conteudo?: { tipo: "resumo_janela"; janelaId: string } | null;
    entregarApos?: number;
    atualizaEvento?: boolean;
    apenasRegistros?: string[] | null;
  } = {},
): Promise<number> {
  try {
    const r = await publicarEEntregar(dependenciasReais(), {
      pushId: opcoes.pushId ?? eventId,
      eventId,
      type,
      payload,
      isSummary,
      audiencia: opcoes.audiencia,
      validadeMs: opcoes.validadeMs,
      origem: opcoes.origem ?? "produtor",
      rajada: opcoes.rajada,
      agrupamento: opcoes.agrupamento,
      conteudo: opcoes.conteudo,
      entregarApos: opcoes.entregarApos,
      atualizaEvento: opcoes.atualizaEvento,
      apenasRegistros: opcoes.apenasRegistros,
    });
    return r.aceitas;
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[notificacoes] falha ao publicar ${eventId} (${String(codigo ?? (err instanceof Error ? err.name : "erro"))})`);
    return 0;
  }
}

/**
 * Varre o que ficou pendente: retries vencidos, concessões que expiraram,
 * fan-outs incompletos e espelhos pendentes. Não depende de quem publicou.
 *
 * O cron da Vercel só roda uma vez por dia no plano gratuito, então isto
 * também é chamado de carona (depois de cada webhook e do cron) — o retry
 * não espera o dia seguinte enquanto houver movimento na loja.
 */
export async function varrerEntregasPendentes(opcoes: { limite?: number; orcamentoMs?: number; limpar?: boolean } = {}) {
  const deps = dependenciasReais();
  const entregas = await processarEntregas(deps, { limite: opcoes.limite ?? 100, orcamentoMs: opcoes.orcamentoMs ?? 15_000 });
  const espelhos = await repararEspelhosPendentes(deps.db).catch(() => 0);
  const limpos = opcoes.limpar
    ? (await limparEntregasAntigas(deps).catch(() => 0)) + (await limparJanelasAntigas(deps.db).catch(() => 0)) + (await limparTestesDosFeeds(deps.db).catch(() => 0))
    : 0;
  return { ...entregas, espelhosRefeitos: espelhos, antigosRemovidos: limpos };
}

/**
 * Apaga os avisos de TESTE vencidos (7 dias) dos feeds pessoais. O documento
 * `notification_feed/{email}` nunca é criado (só a subcoleção), por isso os
 * e-mails vêm de `listDocuments`, que enxerga esses pais "vazios".
 */
async function limparTestesDosFeeds(db: ReturnType<typeof dependenciasReais>["db"]): Promise<number> {
  const pais = await db.collection(COLECAO_FEED).listDocuments();
  return limparTestesAntigos(db, pais.slice(0, 200).map((p) => p.id));
}
