import type { NotificationEventType, SalePushPayload } from "@/lib/domain/notifications";
import {
  avaliarPush,
  mostrarValoresNoPush,
  relogioNoFuso,
  type LeituraDePreferencias,
  type MotivoDoBloqueio,
} from "@/lib/domain/notification-preferences";
import {
  nivelDoDestinatario,
  nivelEfetivoDoPush,
  type AcessoDoDestinatario,
  type NivelConteudo,
} from "@/lib/domain/notificacao-publico";
import { tipoEfetivoParaDestinatario } from "@/lib/domain/personalizacao-push";

/**
 * O que fazer com UM destinatário na hora de enviar — decidido no momento do
 * ENVIO, não no do agendamento.
 *
 * Acesso e preferência mudam entre o evento nascer e o worker chegar (um retry
 * acontece minutos depois; um agendamento, horas). Decidir no agendamento
 * mandaria push pra quem perdeu o acesso ou desligou o aviso nesse intervalo.
 * Aqui a decisão é refeita com o que vale AGORA.
 */
export type DecisaoDoDestinatario =
  | { acao: "enviar"; nivel: NivelConteudo; tipo: NotificationEventType }
  | { acao: "suprimir"; motivo: MotivoSupressao }
  | { acao: "adiar"; motivo: "preferencia_indisponivel"; ate: number };

/**
 * Por que um destinatário NÃO recebe. Nenhuma destas é falha de entrega: são
 * decisões legítimas, e o destino termina em `suppressed`, não em erro.
 *
 *  - `agrupada_em_resumo`: a venda entrou numa rajada e a pessoa recebe o
 *    resumo em vez do aviso avulso;
 *  - `prefere_individual`: o resumo da rajada não vale pra quem quer cada venda.
 */
export type MotivoSupressao = "sem_acesso" | MotivoDoBloqueio | "agrupada_em_resumo" | "prefere_individual";

/**
 * Onde este push está numa rajada de vendas (ver lib/domain/janela-de-vendas):
 *  - `individual_agrupada`: o aviso avulso de uma venda que caiu na rajada —
 *    quem AGRUPA não o recebe;
 *  - `resumo`: o resumo da rajada — quem NÃO agrupa não o recebe.
 * Ausente: push comum, sem relação com rajada.
 */
export type ContextoDeRajada = "individual_agrupada" | "resumo";

/** Quantas vezes se adia esperando a preferência voltar a ser legível antes de seguir com a versão SEGURA. */
export const MAX_ADIAMENTOS_POR_PREFERENCIA = 3;
const ESPERA_PREFERENCIA_MS = 60_000;

export function decidirDestinatario(p: {
  type: NotificationEventType;
  isSummary: boolean;
  rajada?: ContextoDeRajada;
  /** O payload do push, pra a decisão por valor (limiar de alto valor da pessoa). */
  payload: Pick<SalePushPayload, "type" | "grossAmount" | "financialState">;
  /** `undefined` = a pessoa não está em controleAcesso (perdeu o acesso, ou nunca teve). */
  acesso: AcessoDoDestinatario | undefined;
  leitura: LeituraDePreferencias;
  adiamentos: number;
  agora: number;
}): DecisaoDoDestinatario {
  // Fail-closed: sem acesso registrado, sem envio — preferência nunca foi autorização.
  if (!p.acesso) return { acao: "suprimir", motivo: "sem_acesso" };

  // Não deu pra ler a preferência: não se sabe se a pessoa quer este aviso. Espera um
  // pouco (a falha costuma ser passageira); esgotada a espera, segue com a versão
  // SEGURA — sem financeiro — em vez de descartar o aviso.
  if (p.leitura.estado === "indisponivel" && p.adiamentos < MAX_ADIAMENTOS_POR_PREFERENCIA) {
    return { acao: "adiar", motivo: "preferencia_indisponivel", ate: p.agora + ESPERA_PREFERENCIA_MS };
  }

  const prefs = p.leitura.prefs;

  /**
   * Agrupar exige aceitar o resumo. Quem ligou "agrupar" mas desligou o resumo
   * ficaria sem NENHUM aviso durante uma rajada (o avulso suprimido e o resumo
   * também) — dois controles que, juntos, calam sem a pessoa ter pedido silêncio.
   * Nesse caso vale o que ela DEIXOU LIGADO: os avisos avulsos.
   */
  const agrupa = prefs.groupFastSales && prefs.toggles.sales_summary;
  if (p.rajada === "individual_agrupada" && agrupa) return { acao: "suprimir", motivo: "agrupada_em_resumo" };
  if (p.rajada === "resumo" && !agrupa) return { acao: "suprimir", motivo: "prefere_individual" };

  // O limiar de alto valor é da pessoa: o mesmo evento vira "venda comum" ou
  // "alto valor" conforme o que ELA configurou — e o toggle checado é o do tipo que ela vê.
  const tipo = p.isSummary ? p.type : tipoEfetivoParaDestinatario(p.payload, prefs);

  const relogio = relogioNoFuso(p.agora, prefs.quietHoursTimezone);
  const avaliacao = avaliarPush(tipo, prefs, relogio, p.isSummary);
  if (!avaliacao.permitido) return { acao: "suprimir", motivo: avaliacao.motivo };

  const nivel = nivelEfetivoDoPush(
    nivelDoDestinatario(p.acesso.papel, p.acesso.permissoesEdicao),
    mostrarValoresNoPush(p.leitura),
  );
  return { acao: "enviar", nivel, tipo };
}
