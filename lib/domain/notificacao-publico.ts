import {
  NOTIFICATION_TYPE_META,
  type NotificationEvent,
  type NotificationEventSeverity,
  type NotificationEventType,
  type SalePushPayload,
} from "@/lib/domain/notifications";
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
 * O nível que VALE pro push: acesso E preferência.
 *
 * `showFinancialValuesInPush` era gravada, mostrada na tela de configuração
 * e ignorada no envio — quem desligava continuava recebendo lucro e margem na
 * tela de bloqueio. O acesso continua sendo o teto (ninguém vê mais do que a
 * função permite), e a preferência só pode REDUZIR: valor financeiro no push
 * exige as duas coisas ao mesmo tempo.
 *
 * O dono continua vendo o dinheiro DENTRO do app; a preferência é sobre o que
 * aparece na tela de bloqueio, onde qualquer um por perto lê.
 */
export function nivelEfetivoDoPush(acesso: NivelConteudo, mostrarValores: boolean): NivelConteudo {
  return acesso === "completo" && mostrarValores ? "completo" : "sem_financeiro";
}

/** As três classificações de venda que revelam margem/valor só pelo NOME do tipo. */
const TIPOS_DE_VENDA_CLASSIFICADA: ReadonlySet<string> = new Set([
  "sale_high_value",
  "sale_low_margin",
  "sale_negative_margin",
]);

/**
 * O tipo que o destinatário sem acesso financeiro enxerga.
 *
 * `sale_negative_margin` no campo `type` ou no ícone da Central diz "esta
 * venda deu prejuízo" sem um único número — o mesmo vazamento que o título já
 * evitava. Toda venda classificada vira `sale_paid`. Tipo desconhecido vira
 * `system`: melhor um aviso genérico do que um rótulo que ninguém revisou.
 */
export function tipoPublico(type: string): NotificationEventType {
  if (TIPOS_DE_VENDA_CLASSIFICADA.has(type)) return "sale_paid";
  return type in NOTIFICATION_TYPE_META ? (type as NotificationEventType) : "system";
}

const SEVERIDADES: ReadonlySet<string> = new Set(["success", "info", "warning", "danger"]);

/**
 * A severidade pública. Vendas viram "success" — "danger" numa venda é
 * "prejuízo" e "warning" é "margem baixa", ambos financeiros. Nos outros tipos
 * (cancelamento, devolução, tarefa) a severidade não carrega dinheiro e fica.
 */
export function severidadePublica(type: string, severidade: unknown): NotificationEventSeverity {
  const publico = tipoPublico(type);
  if (publico === "sale_paid") return "success";
  if (typeof severidade === "string" && SEVERIDADES.has(severidade)) return severidade as NotificationEventSeverity;
  return NOTIFICATION_TYPE_META[publico].severity;
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

/**
 * Campos que um push SEM financeiro pode carregar. Lista de PERMISSÃO.
 *
 * A versão anterior removia quatro campos conhecidos (a lista negra). Campo
 * novo no payload — e este payload cresce a cada feature — vazava por padrão
 * até alguém lembrar de acrescentá-lo à lista de remoção. Aqui é o contrário:
 * o que não está nesta lista não sai, e esquecer é seguro.
 */
export const CAMPOS_PUBLICOS_DO_PUSH = [
  "eventId", "type", "title", "body", "icon", "badge", "tag",
  "orderId", "deepLink", "productName", "itensJson", "timestamp",
] as const;

/** Rede de segurança do texto — ver contemFinanceiro. */
function textoSeguro(titulo: string, corpo: string): { title: string; body: string } {
  if (contemFinanceiro(titulo) || contemFinanceiro(corpo)) {
    return { title: "Novo aviso", body: "Confira a central de avisos" };
  }
  return { title: titulo, body: corpo };
}

/**
 * Devolve o payload como este destinatário pode vê-lo. `nivel` é o nível
 * EFETIVO — acesso combinado com a preferência (ver nivelEfetivoDoPush).
 *
 * Não muda `eventId`, `tag` nem `deepLink`: o aparelho precisa deles pra
 * substituir a notificação anterior e pra abrir a tela certa — e a tela do
 * outro lado já barra o que a pessoa não pode ver.
 *
 * Resumo agrupado é tratado à parte: o texto pronto traz o faturamento da
 * janela ("R$ 412,80 em pedidos nos últimos 2 min"), e reescrevê-lo como se
 * fosse UMA venda esconderia que são várias.
 */
export function redigirPush(payload: SalePushPayload, nivel: NivelConteudo): SalePushPayload {
  if (nivel === "completo") return payload;

  const texto = payload.resumoCount && payload.resumoCount > 1
    ? { title: `${payload.resumoCount} novas vendas confirmadas`, body: "Confira na central de avisos" }
    : textoSemFinanceiro(payload.type, payload.productName ?? "");
  const seguro = textoSeguro(texto.title, texto.body);

  const bruto: Record<string, unknown> = { ...payload, type: tipoPublico(payload.type), ...seguro };
  const redigido: Record<string, unknown> = {};
  for (const campo of CAMPOS_PUBLICOS_DO_PUSH) {
    if (bruto[campo] !== undefined) redigido[campo] = bruto[campo];
  }
  return redigido as unknown as SalePushPayload;
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
  /**
   * Se a PESSOA aceita valor financeiro no push. Obrigatório de propósito: um
   * padrão aqui seria um consentimento inventado, e foi exatamente a omissão
   * dele que fez a preferência ser ignorada no envio.
   */
  mostrarValores: (email: string) => boolean,
): DestinoDoEnvio<T> {
  const porNivel = new Map<NivelConteudo, T[]>();
  const semAcesso: T[] = [];

  for (const r of registros) {
    const acesso = acessos.get((r.email || "").toLowerCase());
    if (!acesso) { semAcesso.push(r); continue; }
    const email = (r.email || "").toLowerCase();
    const nivel = nivelEfetivoDoPush(
      nivelDoDestinatario(acesso.papel, acesso.permissoesEdicao),
      mostrarValores(email),
    );
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

/**
 * Campos do evento que o espelho público pode carregar. Lista de PERMISSÃO
 * pelo mesmo motivo do push: a lista negra de quatro campos deixava passar
 * qualquer campo financeiro novo, e mantinha `type` e `severity` — que por
 * si só dizem "esta venda deu prejuízo".
 *
 * `delivery` fica de fora: é o estado interno do envio, sem utilidade pra
 * quem lê a Central e sem motivo pra ser público.
 */
export const CAMPOS_PUBLICOS_DO_EVENTO = [
  "id", "entityType", "entityId", "dedupeKey", "accountId",
  "orderId", "orderExternalId", "productName", "productCount", "quantity",
  "itens", "deepLink", "createdAt", "readBy", "dismissedBy",
] as const;

/**
 * A versao do evento que vai pro espelho publico.
 *
 * Titulo/corpo sao reescritos (vinham prontos com o valor), `type` e
 * `severity` sao normalizados (ver tipoPublico) e so os campos da lista de
 * permissao passam. `financialState` fica de fora: "unavailable" ou
 * "estimated" ja e informacao sobre o calculo financeiro.
 */
export function redigirEvento<T extends Partial<NotificationEvent>>(evento: T): Record<string, unknown> {
  const tipo = String(evento.type ?? "");
  const base = textoSemFinanceiro(tipo as NotificationEventType, String(evento.productName ?? ""));
  const texto = textoSeguro(base.title, base.body);

  const origem = evento as Record<string, unknown>;
  const publico: Record<string, unknown> = {};
  for (const campo of CAMPOS_PUBLICOS_DO_EVENTO) {
    if (origem[campo] !== undefined) publico[campo] = origem[campo];
  }
  publico.type = tipoPublico(tipo);
  publico.severity = severidadePublica(tipo, evento.severity);
  publico.title = texto.title;
  publico.body = texto.body;
  return publico;
}
