import "server-only";
import type { NotificationEventType, SalePushPayload } from "@/lib/domain/notifications";
import type { ContextoDeRajada } from "@/lib/domain/decisao-destinatario";
import { dependenciasReais, limparEntregasAntigas, processarEntregas, publicarEEntregar, type EspecPush } from "@/lib/notification-outbox";
import {
  createNotificationEventIdempotent,
  limparTestesDosFeeds,
  repararEspelhosPendentes,
  type NewNotificationEvent,
} from "@/lib/notification-events";
import { limparJanelasAntigas } from "@/lib/notification-janelas";

export type OpcoesDeEnvio = {
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
};

/** A especificação de um push — a MESMA usada pra criar junto do evento e pra entregar. */
export function especDoPush(
  eventId: string,
  type: NotificationEventType,
  payload: SalePushPayload,
  isSummary = false,
  opcoes: OpcoesDeEnvio = {},
): EspecPush {
  return {
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
  };
}

/**
 * Publica e já tenta entregar. NÃO lança: um problema de entrega nunca pode
 * derrubar o produtor que o disparou. O que falhar fica no outbox e a varredura
 * tenta de novo — DESDE QUE o push tenha sido gravado, e é pra isso que existe
 * criarEventoEPublicar.
 */
export async function enviarEspec(spec: EspecPush): Promise<number> {
  try {
    const r = await publicarEEntregar(dependenciasReais(), spec);
    return r.aceitas;
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[notificacoes] falha ao publicar ${spec.pushId} (${String(codigo ?? (err instanceof Error ? err.name : "erro"))})`);
    return 0;
  }
}

/**
 * A porta de entrada que os produtores usam pra mandar push.
 *
 * Todos — venda, cancelamento, devolução, marco, estoque, tarefa, resumos —
 * passam por aqui e por isso ganham, sem código próprio, o que o outbox dá:
 * destino por aparelho, retry só do que falhou, validade, TTL e recuperação
 * pela varredura. Antes, cada produtor tinha um `sendXxx` e uma trilha de
 * entrega própria, e só o caminho de venda tratava o evento já existente.
 */
export async function enviarEPersistirEntrega(
  eventId: string,
  type: NotificationEventType,
  payload: SalePushPayload,
  isSummary = false,
  opcoes: OpcoesDeEnvio = {},
): Promise<number> {
  return enviarEspec(especDoPush(eventId, type, payload, isSummary, opcoes));
}

/**
 * Cria o evento COM o push no mesmo lote e já tenta entregar — S09.
 *
 * É o que um produtor com evento deve usar. Criar o evento e depois chamar
 * `enviarEPersistirEntrega` deixava uma janela: o evento gravado, o push não,
 * e ninguém pra perceber. Aqui, gravado o evento, o push está no outbox; se a
 * entrega imediata falhar ou o processo morrer, a varredura (o worker a cada
 * 5 min, ver app/api/worker) completa.
 */
export async function criarEventoEPublicar(
  evento: NewNotificationEvent,
  push: EspecPush,
  opcoes: { audiencia?: string[] } = {},
): Promise<{ created: boolean; eventId: string; enviados: number }> {
  const r = await createNotificationEventIdempotent(evento, undefined, { ...opcoes, push });
  const enviados = await enviarEspec(push);
  return { ...r, enviados };
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
