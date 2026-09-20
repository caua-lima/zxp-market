/**
 * A entrega de UM aviso a UM aparelho — o que a sustenta, do agendamento ao fim.
 *
 * ─── POR QUE POR DESTINO ────────────────────────────────────────────────
 *
 * A entrega era um estado do EVENTO: "algum aparelho recebeu? então acabou".
 * Duas consequências ruins:
 *
 *  - com dez destinos, um aceito fechava o evento e os outros nove que falharam
 *    de forma transitória nunca eram reenviados;
 *  - o reenvio do que faltasse (se existisse) reenviaria a TODOS, e quem já
 *    tinha recebido receberia de novo.
 *
 * Agora cada (aviso, aparelho) é um registro com o próprio estado. Reenviar é
 * reenviar só o que está pendente, e "concluído" é uma conta sobre destinos.
 *
 * ─── OS ESTADOS ─────────────────────────────────────────────────────────
 *
 *   pending            criado, ninguém tentou ainda
 *   leased             um worker tem a concessão (vence em LEASE_MS)
 *   retry_scheduled    falhou de forma transitória; volta em `proximaTentativaEm`
 *   accepted           o provedor (FCM) ACEITOU a mensagem — não é "exibido"
 *   suppressed         não enviado de propósito: preferência, sem acesso, aparelho removido
 *   expired            passou da validade antes de conseguir enviar
 *   permanent_failure  não vai passar: token inválido, tentativas esgotadas, payload recusado
 *
 * "accepted" é o que o servidor sabe: o FCM devolveu um id de mensagem. Entre
 * isso e o aparelho exibir há a rede, o sistema operacional, a permissão e o
 * Service Worker. Nada aqui promete entrega exatamente uma vez nem exibição —
 * o que existe contra duplicata visível é a `tag` do payload, que faz o
 * aparelho substituir a notificação anterior.
 *
 * ─── A CONCESSÃO (LEASE) ────────────────────────────────────────────────
 *
 * Quem vai enviar primeiro GRAVA a concessão, numa transação, e só então
 * chama o FCM. Duas coisas decorrem disso:
 *
 *  - dois workers nunca enviam o mesmo destino: o segundo lê a concessão
 *    gravada e recua;
 *  - se o worker morrer no meio, a concessão vence sozinha e outro assume — ao
 *    custo de, se o FCM já tinha aceitado, o aparelho receber duas vezes
 *    (a `tag` colapsa na tela). É "pelo menos uma vez", dito com todas as letras.
 *
 * O campo `proximaTentativaEm` é "quando este registro precisa de atenção de
 * novo": em `pending` é agora, em `leased` é o fim da concessão, em
 * `retry_scheduled` é a hora do retry, e nos terminais NÃO EXISTE. Um único
 * campo com uma única consulta de intervalo acha tudo que está pendente —
 * inclusive concessões que venceram — sem índice composto.
 */

export type StatusEntrega =
  | "pending"
  | "leased"
  | "retry_scheduled"
  | "accepted"
  | "suppressed"
  | "expired"
  | "permanent_failure";

export const STATUS_TERMINAIS: ReadonlySet<StatusEntrega> = new Set([
  "accepted",
  "suppressed",
  "expired",
  "permanent_failure",
]);

/** Concessão curta: um worker pode morrer no meio, e o destino não pode ficar preso. */
export const LEASE_MS = 60_000;

/** Teto de tentativas por destino. Seis cobre um FCM instável com folga; depois disso o problema não é transitório. */
export const MAX_TENTATIVAS_DESTINO = 6;

/**
 * Validade padrão de um aviso. Um aviso de venda entregue de madrugada, seis
 * horas depois, não é aviso — a venda já apareceu no painel e já foi tratada.
 */
export const VALIDADE_PADRAO_MS = 6 * 3600 * 1000;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_TETO_MS = 10 * 60_000;

export type EntregaDestino = {
  status: StatusEntrega;
  tentativas: number;
  proximaTentativaEm?: number | null;
  leaseId?: string | null;
  leaseAte?: number | null;
  /** Quando o aviso deixa de valer (ms). */
  expiraEm: number;
  /** Quantas vezes o envio foi ADIADO por falta de informação (não gasta tentativa). */
  adiamentos?: number;
};

/**
 * Espera antes do retry `tentativa` (1 = a primeira falha): exponencial com
 * jitter de ±25%. O jitter existe pra os destinos que falharam juntos (o FCM
 * caiu) não voltarem juntos — voltar em bloco é como se derruba de novo um
 * serviço que acabou de se recuperar.
 *
 * @param aleatorio número em [0, 1) — parâmetro pra a função ser pura e testável.
 */
export function esperaDoRetry(tentativa: number, aleatorio: number): number {
  const exp = Math.min(BACKOFF_TETO_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, tentativa - 1));
  const fator = 0.75 + 0.5 * Math.min(Math.max(aleatorio, 0), 0.999999);
  return Math.round(exp * fator);
}

export type AvaliacaoDaEntrega =
  | { acao: "pular"; motivo: "terminal" | "concessao_ativa" | "ainda_nao" }
  | { acao: "expirar" }
  | { acao: "esgotar" }
  | { acao: "reivindicar"; tentativa: number };

/**
 * O que fazer com este destino agora.
 *
 * Tentativa que virou concessão vencida (worker morreu) conta como tentativa —
 * `tentativas` é incrementado AO reivindicar, não ao terminar. Sem isso um
 * destino que derruba o worker toda vez seria tentado pra sempre.
 */
export function avaliarEntrega(e: EntregaDestino, agora: number): AvaliacaoDaEntrega {
  if (STATUS_TERMINAIS.has(e.status)) return { acao: "pular", motivo: "terminal" };

  if (e.status === "leased" && (e.leaseAte ?? 0) > agora) return { acao: "pular", motivo: "concessao_ativa" };

  if (e.status !== "leased" && (e.proximaTentativaEm ?? 0) > agora) return { acao: "pular", motivo: "ainda_nao" };

  // A validade pesa antes de tudo: tarde demais, enviar é ruído.
  if (agora >= e.expiraEm) return { acao: "expirar" };

  if (e.tentativas >= MAX_TENTATIVAS_DESTINO) return { acao: "esgotar" };

  return { acao: "reivindicar", tentativa: e.tentativas + 1 };
}

/** Campos a gravar ao reivindicar. `proximaTentativaEm` acompanha a concessão: se o worker morrer, é por ela que o destino é achado de novo. */
export function patchReivindicada(tentativa: number, agora: number, leaseId: string): Record<string, unknown> {
  return {
    status: "leased" satisfies StatusEntrega,
    tentativas: tentativa,
    leaseId,
    leaseAte: agora + LEASE_MS,
    proximaTentativaEm: agora + LEASE_MS,
    ultimaTentativaEm: agora,
  };
}

/** O que um envio devolveu, já traduzido pra este domínio. */
export type ResultadoDoEnvio =
  | { tipo: "aceito"; messageId?: string }
  | { tipo: "transitorio"; codigo: string }
  | { tipo: "token_invalido"; codigo: string }
  | { tipo: "permanente"; codigo: string }
  | { tipo: "suprimido"; motivo: string }
  | { tipo: "adiar"; ate: number; motivo: string }
  | { tipo: "expirado" };

/**
 * `null` significa "apagar o campo" — quem grava troca por FieldValue.delete().
 * É assim que o estado terminal sai da consulta por `proximaTentativaEm`.
 */
const LIMPA_CONCESSAO = { leaseId: null, leaseAte: null, proximaTentativaEm: null } as const;

/**
 * Os campos a gravar depois de um resultado.
 *
 * `e.tentativas` já inclui a tentativa em curso (foi incrementada ao
 * reivindicar).
 */
export function patchResultado(
  e: Pick<EntregaDestino, "tentativas" | "expiraEm" | "adiamentos">,
  r: ResultadoDoEnvio,
  agora: number,
  aleatorio: number,
): Record<string, unknown> {
  switch (r.tipo) {
    case "aceito":
      return {
        status: "accepted" satisfies StatusEntrega,
        acceptedByProviderAt: agora,
        ...(r.messageId ? { providerMessageId: r.messageId } : {}),
        ultimoErro: null,
        ...LIMPA_CONCESSAO,
      };

    case "transitorio": {
      if (e.tentativas >= MAX_TENTATIVAS_DESTINO) {
        return {
          status: "permanent_failure" satisfies StatusEntrega,
          motivo: "tentativas_esgotadas",
          ultimoErro: { codigo: r.codigo, em: agora },
          ...LIMPA_CONCESSAO,
        };
      }
      // O retry nunca passa da validade: na hora de expirar, o próprio worker
      // registra o `expired` — em vez de o aviso simplesmente sumir da fila.
      const quando = Math.min(agora + esperaDoRetry(e.tentativas, aleatorio), e.expiraEm);
      return {
        status: "retry_scheduled" satisfies StatusEntrega,
        proximaTentativaEm: quando,
        ultimoErro: { codigo: r.codigo, em: agora },
        leaseId: null,
        leaseAte: null,
      };
    }

    case "token_invalido":
      return {
        status: "permanent_failure" satisfies StatusEntrega,
        motivo: "token_invalido",
        ultimoErro: { codigo: r.codigo, em: agora },
        ...LIMPA_CONCESSAO,
      };

    case "permanente":
      return {
        status: "permanent_failure" satisfies StatusEntrega,
        motivo: "recusado_pelo_provedor",
        ultimoErro: { codigo: r.codigo, em: agora },
        ...LIMPA_CONCESSAO,
      };

    case "suprimido":
      return { status: "suppressed" satisfies StatusEntrega, motivo: r.motivo, ...LIMPA_CONCESSAO };

    case "adiar":
      // Adiar por falta de informação (preferência indisponível) NÃO gasta a
      // tentativa: a tentativa é do envio, e nada foi enviado.
      return {
        status: "retry_scheduled" satisfies StatusEntrega,
        proximaTentativaEm: Math.min(r.ate, e.expiraEm),
        motivoAdiado: r.motivo,
        adiamentos: (e.adiamentos ?? 0) + 1,
        tentativas: Math.max(0, e.tentativas - 1),
        leaseId: null,
        leaseAte: null,
      };

    case "expirado":
      return { status: "expired" satisfies StatusEntrega, motivo: "validade", ...LIMPA_CONCESSAO };
  }
}

/** Patch de quem chegou a `esgotar` ou `expirar` sem enviar. */
export function patchEncerrada(acao: "esgotar" | "expirar", agora: number): Record<string, unknown> {
  return acao === "expirar"
    ? { status: "expired" satisfies StatusEntrega, motivo: "validade", encerradoEm: agora, ...LIMPA_CONCESSAO }
    : { status: "permanent_failure" satisfies StatusEntrega, motivo: "tentativas_esgotadas", encerradoEm: agora, ...LIMPA_CONCESSAO };
}

export type ResumoDeEntregas = {
  total: number;
  aceitos: number;
  pendentes: number; // pending + leased + retry_scheduled
  suprimidos: number;
  expirados: number;
  falhas: number;
  /** Tudo em estado terminal. */
  concluido: boolean;
};

/** A conta que substitui o antigo "algum aparelho recebeu": sobre TODOS os destinos. */
export function resumirEntregas(entregas: { status: StatusEntrega }[]): ResumoDeEntregas {
  const r: ResumoDeEntregas = { total: entregas.length, aceitos: 0, pendentes: 0, suprimidos: 0, expirados: 0, falhas: 0, concluido: false };
  for (const e of entregas) {
    if (e.status === "accepted") r.aceitos++;
    else if (e.status === "suppressed") r.suprimidos++;
    else if (e.status === "expired") r.expirados++;
    else if (e.status === "permanent_failure") r.falhas++;
    else r.pendentes++;
  }
  r.concluido = r.pendentes === 0;
  return r;
}
