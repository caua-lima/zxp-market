/**
 * Criar o aviso e ENTREGAR o aviso são duas coisas.
 *
 * ─── O PUSH QUE SE PERDIA PRA SEMPRE ────────────────────────────────────
 *
 * `createNotificationEventIdempotent` garante um evento por `dedupeKey` — isso
 * está certo, e é o que impede o mesmo pedido gerar dois avisos.
 *
 * O problema é o que vinha logo depois:
 *
 *   if (!created) return { estado: "ja_existia", eventId };
 *
 * A entrega ficou grudada na criação. Se o evento foi criado e o envio falhou
 * em seguida — FCM fora do ar, rede caindo, a função sendo encerrada no meio —
 * o documento fica lá, sem entrega. E a próxima tentativa recebe
 * `created: false`, devolve "já existia" e NÃO TENTA DE NOVO.
 *
 * O push some. Não com erro: em silêncio, e para sempre. A rede de segurança
 * do sync tinha o mesmo furo, porque ela checava se o EVENTO existia, não se
 * ele havia sido entregue.
 *
 * ─── O QUE MUDA ─────────────────────────────────────────────────────────
 *
 * Evento existente sem entrega vira uma PENDÊNCIA: tem tentativas contadas,
 * uma concessão curta pra dois processos não enviarem juntos, e um teto —
 * porque insistir infinitamente num aviso que nunca vai passar é só gastar
 * quota e encher o log.
 *
 * E há um prazo. Um aviso de venda entregue três dias depois não é um aviso, é
 * ruído: a venda já apareceu no painel, já foi embalada, talvez já entregue.
 * Passado o prazo a pendência é encerrada como vencida, não como enviada.
 *
 * ─── SOBRE "EXATAMENTE UMA VEZ" ─────────────────────────────────────────
 *
 * Isto NÃO promete entrega exatamente uma vez no aparelho. Não dá: entre o FCM
 * aceitar a mensagem e o celular exibi-la há uma rede inteira, e um reenvio
 * depois de uma falha ambígua pode duplicar. O que existe contra isso é a
 * `tag`/`collapseKey` do payload, que faz o aparelho SUBSTITUIR a notificação
 * anterior em vez de empilhar outra — uma defesa de exibição, não de entrega.
 */

export type EstadoEntrega = {
  /** Quando tentamos entregar pela última vez (ms). */
  pushAttemptedAt?: unknown;
  /** Quando pelo menos um aparelho recebeu (ms). Presente = entregue. */
  pushDeliveredAt?: unknown;
  /** Resumo do último erro. */
  pushError?: unknown;
  /** Quantas vezes já tentamos. */
  tentativas?: unknown;
  /** Até quando alguém já está tentando entregar. */
  entregaLeaseAte?: unknown;
};

export type Pendencia =
  | { acao: "entregar"; tentativa: number }
  | { acao: "ja_entregue" }
  | { acao: "outro_entregando" }
  | { acao: "desistir"; motivo: "tentativas" | "vencida" };

/**
 * Teto de tentativas.
 *
 * Cinco cobre indisponibilidade momentânea do FCM com folga. Além disso o
 * problema não é transitório — é token morto, projeto mal configurado,
 * permissão revogada — e insistir só gasta quota.
 */
export const MAX_TENTATIVAS = 5;

/** Concessão de entrega: curta, porque um processo pode morrer no meio. */
export const LEASE_ENTREGA_MS = 60_000;

/**
 * Prazo de validade de um aviso.
 *
 * Seis horas. Um aviso de venda entregue três dias depois não é aviso, é
 * ruído: a venda já apareceu no painel e já foi tratada. Melhor encerrar como
 * vencida — e deixar isso registrado — do que mandar tarde.
 */
export const VALIDADE_MS = 6 * 3600 * 1000;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * O que fazer com este evento agora.
 *
 * @param criadoEm quando o evento nasceu (ms) — base do prazo de validade.
 */
export function avaliarPendencia(
  d: EstadoEntrega | null | undefined,
  criadoEm: number,
  agora: number,
): Pendencia {
  // Já chegou em algum aparelho: nada a fazer.
  if (d?.pushDeliveredAt) return { acao: "ja_entregue" };

  const lease = num(d?.entregaLeaseAte);
  if (lease > 0 && agora < lease) return { acao: "outro_entregando" };

  const tentativas = num(d?.tentativas);
  if (tentativas >= MAX_TENTATIVAS) return { acao: "desistir", motivo: "tentativas" };

  /**
   * O prazo conta do NASCIMENTO do evento, não da última tentativa — senão
   * tentar de hora em hora esticaria a validade indefinidamente e o aviso
   * chegaria dois dias depois.
   */
  if (Number.isFinite(criadoEm) && criadoEm > 0 && agora - criadoEm > VALIDADE_MS) {
    return { acao: "desistir", motivo: "vencida" };
  }

  return { acao: "entregar", tentativa: tentativas + 1 };
}

/** Os campos a gravar ao ASSUMIR a entrega — antes de chamar o FCM. */
export function patchTentando(tentativa: number, agora: number): Record<string, unknown> {
  return {
    "delivery.pushAttemptedAt": agora,
    "delivery.tentativas": tentativa,
    "delivery.entregaLeaseAte": agora + LEASE_ENTREGA_MS,
  };
}

/**
 * Os campos a gravar depois de tentar.
 *
 * @param enviados quantos aparelhos receberam. Zero NÃO é entrega: pode não
 *   haver dispositivo registrado, e nesse caso insistir é inútil — mas quem
 *   decide isso é o teto de tentativas, não este patch.
 */
export function patchResultado(enviados: number, agora: number, erro?: string): Record<string, unknown> {
  const chegou = num(enviados) > 0;
  return {
    "delivery.entregaLeaseAte": null,
    ...(chegou ? { "delivery.pushDeliveredAt": agora, "delivery.pushError": null } : {}),
    ...(!chegou && erro ? { "delivery.pushError": String(erro).slice(0, 200) } : {}),
    ...(!chegou && !erro ? { "delivery.pushError": "nenhum dispositivo recebeu" } : {}),
  };
}

/** Encerra a pendência sem entregar, registrando por quê. */
export function patchDesistencia(motivo: "tentativas" | "vencida", agora: number): Record<string, unknown> {
  return {
    "delivery.entregaLeaseAte": null,
    "delivery.desistidoEm": agora,
    "delivery.pushError": motivo === "tentativas"
      ? `desisti apos ${MAX_TENTATIVAS} tentativas`
      : "aviso vencido: entregar agora seria ruido, nao aviso",
  };
}
