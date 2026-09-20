import type { NotificationEventType } from "@/lib/domain/notifications";
import {
  isPushAllowedForRecipient,
  mostrarValoresNoPush,
  type LeituraDePreferencias,
} from "@/lib/domain/notification-preferences";
import {
  nivelDoDestinatario,
  nivelEfetivoDoPush,
  type AcessoDoDestinatario,
  type NivelConteudo,
} from "@/lib/domain/notificacao-publico";

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
  | { acao: "enviar"; nivel: NivelConteudo }
  | { acao: "suprimir"; motivo: "sem_acesso" | "preferencia" }
  | { acao: "adiar"; motivo: "preferencia_indisponivel"; ate: number };

/** Quantas vezes se adia esperando a preferência voltar a ser legível antes de seguir com a versão SEGURA. */
export const MAX_ADIAMENTOS_POR_PREFERENCIA = 3;
const ESPERA_PREFERENCIA_MS = 60_000;

export function decidirDestinatario(p: {
  type: NotificationEventType;
  isSummary: boolean;
  /** `undefined` = a pessoa não está em controleAcesso (perdeu o acesso, ou nunca teve). */
  acesso: AcessoDoDestinatario | undefined;
  leitura: LeituraDePreferencias;
  agoraBR: { minutosDoDia: number; diaSemana: number };
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

  if (!isPushAllowedForRecipient(p.type, p.leitura.prefs, p.agoraBR, p.isSummary)) {
    return { acao: "suprimir", motivo: "preferencia" };
  }

  const nivel = nivelEfetivoDoPush(
    nivelDoDestinatario(p.acesso.papel, p.acesso.permissoesEdicao),
    mostrarValoresNoPush(p.leitura),
  );
  return { acao: "enviar", nivel };
}
