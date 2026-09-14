import type { NotificationEvent, NotificationEventType, SalePushPayload } from "@/lib/domain/notifications";
import { podeCapacidade } from "@/lib/domain/capacidades";
import type { Papel, PermissionTab } from "@/lib/domain/types";

/**
 * Quanto do aviso cada pessoa pode ver — e quem ainda pode receber aviso.
 *
 * ─── OS DOIS BURACOS QUE ISTO FECHA ─────────────────────────────────────
 *
 * 1. CONTEÚDO. `serializarPayload` mandava `grossAmount`, `estimatedProfit` e
 *    `estimatedMargin` pra TODOS os dispositivos, e o título/corpo vinham
 *    prontos com o dinheiro escrito dentro ("Venda de R$ 129,90", "margem
 *    estimada 6,2%", "prejuízo estimado de R$ 18,40"). Um `member` — o papel
 *    que existe justamente pra acompanhar o resultado SEM ver custo e margem
 *    — recebia tudo no celular. Barrar a aba e redigir a resposta da API não
 *    adianta se o mesmo número chega pelo push.
 *
 * 2. REVOGAÇÃO. O envio lia a coleção `pushTokens` inteira e mandava pra
 *    todo mundo. Tirar o acesso de alguém em `controleAcesso` não parava
 *    nada: o token do aparelho continuava cadastrado, e a pessoa seguia
 *    recebendo o faturamento da empresa até o token morrer sozinho.
 *    Preferência de notificação nunca foi autorização — quem perdeu o acesso
 *    não é "alguém que desligou o aviso", é alguém que não devia receber.
 */

export type NivelConteudo = "completo" | "sem_financeiro";

/** O que cada destinatário pode ver, decidido pela MESMA matriz das APIs. */
export function nivelDoDestinatario(
  papel: Papel,
  permissoesEdicao: PermissionTab[],
): NivelConteudo {
  return podeCapacidade(papel, permissoesEdicao, "ver_financeiro") ? "completo" : "sem_financeiro";
}

/**
 * Título e corpo sem dinheiro nenhum, por tipo de evento.
 *
 * Reescrever é mais seguro do que tentar limpar o texto pronto: o texto
 * original é montado em uma dúzia de ramos (ver buildSaleContent), e um ramo
 * novo passaria despercebido por qualquer filtro. Aqui, tipo desconhecido cai
 * no genérico — que não diz nada.
 */
function textoSemFinanceiro(
  type: NotificationEventType,
  produto: string,
): { title: string; body: string } {
  const alvo = produto || "Pedido";
  switch (type) {
    case "sale_paid":
    case "sale_high_value":
    case "sale_low_margin":
    case "sale_negative_margin":
      // Todos viram o MESMO título: "alto valor" e "margem em atenção" já são
      // informação financeira, mesmo sem número.
      return { title: "Nova venda confirmada", body: alvo };
    case "sale_cancelled":
      return { title: "Pedido cancelado", body: alvo };
    case "return_opened":
      return { title: "Devolução aberta", body: alvo };
    case "return_completed":
      return { title: "Devolução concluída", body: `${alvo} · venda revertida` };
    case "task_assigned":
      return { title: "Nova tarefa atribuída a você", body: alvo };
    case "stock_low":
      return { title: "Estoque baixo", body: alvo };
    case "sync_warning":
      return { title: "Aviso de sincronização", body: "Confira a central de avisos" };
    case "milestone":
      return { title: "Marco batido 🏆", body: "A VAZXPRESS bateu mais uma meta" };
    default:
      return { title: "Novo aviso", body: "Confira a central de avisos" };
  }
}

/**
 * Rede de segurança: sobrou dinheiro no texto?
 *
 * Pega "R$", percentual e número com vírgula decimal. Existe pra o dia em que
 * alguém acrescentar um tipo de evento e esquecer de `textoSemFinanceiro` —
 * o teste falha, e em produção o texto vira o genérico em vez de vazar.
 */
export function contemFinanceiro(texto: string): boolean {
  return /R\$|\d+(?:[.,]\d+)?\s*%|\d{1,3}(?:\.\d{3})*,\d{2}/.test(texto);
}

/** Campos do payload que carregam dinheiro e somem na redação. */
export const CAMPOS_FINANCEIROS_DO_PUSH = [
  "grossAmount",
  "estimatedProfit",
  "estimatedMargin",
  "financialState",
] as const;

/**
 * Devolve o payload como este destinatário pode vê-lo.
 *
 * Não muda `eventId`, `tag` nem `deepLink`: o aparelho precisa deles pra
 * substituir a notificação anterior e pra abrir a tela certa — e a tela do
 * outro lado já barra o que a pessoa não pode ver.
 */
export function redigirPush(payload: SalePushPayload, nivel: NivelConteudo): SalePushPayload {
  if (nivel === "completo") return payload;

  const { title, body } = textoSemFinanceiro(payload.type, payload.productName ?? "");
  const redigido: SalePushPayload = {
    ...payload,
    title,
    body,
    grossAmount: undefined,
    estimatedProfit: undefined,
    estimatedMargin: undefined,
    financialState: undefined,
    // `itensJson` é nome e quantidade de produto, sem preço — fica.
  };

  // Se ainda assim sobrou dinheiro (tipo novo sem tratamento), cai no genérico.
  if (contemFinanceiro(redigido.title) || contemFinanceiro(redigido.body)) {
    redigido.title = "Novo aviso";
    redigido.body = "Confira a central de avisos";
  }
  return redigido;
}

export type AcessoDoDestinatario = {
  papel: Papel;
  permissoesEdicao: PermissionTab[];
};

export type DestinoDoEnvio<T> = {
  /** Quem recebe, já separado pelo nível de conteúdo. */
  porNivel: Map<NivelConteudo, T[]>;
  /** Tokens de quem NÃO tem mais acesso — não recebem, e a origem some. */
  semAcesso: T[];
};

/**
 * Separa os dispositivos entre quem recebe o quê — e quem não recebe mais.
 *
 * Fail-closed: e-mail que não está em `acessos` cai em `semAcesso`. Isso cobre
 * acesso removido, e-mail vazio no registro do aparelho e registro órfão de
 * antes de existir controle de acesso. Nenhum desses deve continuar recebendo
 * o faturamento da empresa.
 */
export function separarPorAcesso<T extends { email: string }>(
  registros: T[],
  acessos: Map<string, AcessoDoDestinatario>,
): DestinoDoEnvio<T> {
  const porNivel = new Map<NivelConteudo, T[]>();
  const semAcesso: T[] = [];

  for (const r of registros) {
    const acesso = acessos.get((r.email || "").toLowerCase());
    if (!acesso) { semAcesso.push(r); continue; }
    const nivel = nivelDoDestinatario(acesso.papel, acesso.permissoesEdicao);
    const lista = porNivel.get(nivel) ?? [];
    lista.push(r);
    porNivel.set(nivel, lista);
  }

  return { porNivel, semAcesso };
}

/**
 * A COLECAO que cada nivel pode ler.
 *
 * As regras do Firestore sao por documento — nao da pra esconder tres campos
 * de um doc que a pessoa pode ler. Entao o evento e gravado em duas colecoes:
 * a original, com tudo, restrita a quem ve financeiro; e o espelho redigido,
 * que qualquer autorizado le. Cada pessoa escuta a colecao que alcanca.
 *
 * Sem isso, o `member` lia `notification_events` direto — pela Central ou
 * pelo SDK — e via grossAmount, estimatedProfit e estimatedMargin de toda
 * venda, alem do dinheiro escrito no titulo e no corpo.
 */
export const COLECAO_EVENTOS = "notification_events";
export const COLECAO_EVENTOS_PUBLICA = "notification_events_publico";

export function colecaoDoNivel(nivel: NivelConteudo): string {
  return nivel === "completo" ? COLECAO_EVENTOS : COLECAO_EVENTOS_PUBLICA;
}

/** Campos do evento persistido que carregam dinheiro. */
export const CAMPOS_FINANCEIROS_DO_EVENTO = [
  "grossAmount",
  "returnAmount",
  "estimatedProfit",
  "estimatedMargin",
] as const;

/**
 * A versao do evento que vai pro espelho publico.
 *
 * Remove os campos de dinheiro E reescreve titulo/corpo, que vinham prontos
 * com o valor dentro. `financialState` fica de fora tambem: "unavailable" ou
 * "estimated" ja e informacao sobre o calculo financeiro.
 */
export function redigirEvento<T extends Partial<NotificationEvent>>(evento: T): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...evento };
  for (const campo of CAMPOS_FINANCEIROS_DO_EVENTO) delete copia[campo];
  delete copia.financialState;

  const { title, body } = textoSemFinanceiro(
    (evento.type ?? "") as NotificationEventType,
    String(evento.productName ?? ""),
  );
  copia.title = title;
  copia.body = body;

  if (contemFinanceiro(String(copia.title)) || contemFinanceiro(String(copia.body))) {
    copia.title = "Novo aviso";
    copia.body = "Confira a central de avisos";
  }
  return copia;
}
