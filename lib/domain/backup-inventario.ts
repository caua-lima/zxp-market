/**
 * O que se perde se o banco sumir hoje.
 *
 * ─── POR QUE ISTO É CÓDIGO E NÃO UM DOCUMENTO ────────────────────────────
 *
 * Um documento de backup envelhece em silêncio: alguém cria uma coleção nova,
 * ninguém lembra de abrir o .md, e seis meses depois o backup cobre 11 de 14
 * coleções sem que nada tenha avisado.
 *
 * Aqui o inventário é uma estrutura, e o teste compara a lista com as
 * coleções declaradas em `firestore.rules`. Coleção nova sem decisão de
 * backup QUEBRA O TESTE — a decisão passa a ser obrigatória em vez de
 * lembrada.
 *
 * ─── A CLASSIFICAÇÃO QUE IMPORTA ─────────────────────────────────────────
 *
 * Não é "importante / não importante". É de onde o dado voltaria:
 *
 *   irrecuperavel — só existe aqui. Foi digitado por uma pessoa ou é o
 *                   histórico do que aconteceu. Perdeu, acabou.
 *   rebuscavel    — o Mercado Livre é a fonte; dá pra sincronizar de novo,
 *                   pagando tempo e chamadas de API.
 *   efemero       — se perder, o app recria sozinho no uso normal.
 *
 * Só o primeiro grupo justifica RPO curto. Tratar os três do mesmo jeito é
 * como um backup fica caro demais pra rodar na frequência que precisaria.
 */

export type ClasseDeDado = "irrecuperavel" | "rebuscavel" | "efemero";

export type ItemDeBackup = {
  /** Nome da coleção, exatamente como em firestore.rules. */
  colecao: string;
  classe: ClasseDeDado;
  /** O que é, em uma linha. */
  conteudo: string;
  /** O que acontece com o app se este dado sumir. */
  perda: string;
};

export const INVENTARIO: readonly ItemDeBackup[] = [
  {
    colecao: "estoque",
    classe: "irrecuperavel",
    conteudo: "Produtos: custo médio, alíquota de imposto, faixas de vigência de custo, vínculo com o MLB.",
    perda:
      "O CMV vira zero e TODO lucro do app fica inflado. É o cadastro que " +
      "mais custou tempo humano e o único que nenhuma API devolve.",
  },
  {
    colecao: "estoque_movimentos",
    classe: "irrecuperavel",
    conteudo: "Entradas e ajustes de estoque, com o saldo anterior — o razão que reconstrói o custo médio.",
    perda:
      "Sem o razão, o custo médio atual não pode ser auditado nem recalculado: " +
      "o número continua lá, sem nada que explique como chegou nele.",
  },
  {
    colecao: "custos",
    classe: "irrecuperavel",
    conteudo: "Despesas cadastradas à mão: pró-labore, contador, aluguel, com vigência.",
    perda: "A DRE passa a mostrar resultado otimista, sem nenhum aviso de que faltam despesas.",
  },
  {
    colecao: "full_remessas",
    classe: "irrecuperavel",
    conteudo: "Custo das coletas pro Full informado manualmente.",
    perda:
      "O ML NÃO expõe esse valor pela API — foi por isso que ele é digitado. " +
      "Perdido, só voltaria conferindo envio por envio no painel do ML.",
  },
  {
    colecao: "metas",
    classe: "irrecuperavel",
    conteudo: "Metas de faturamento e margem em vigor.",
    perda: "Todo indicador de progresso perde o denominador.",
  },
  {
    colecao: "metasHistorico",
    classe: "irrecuperavel",
    conteudo: "Metas de períodos passados — o que se prometeu, na época em que se prometeu.",
    perda:
      "Some a capacidade de dizer se um mês passado bateu a meta DAQUELE mês. " +
      "Recriar com a meta de hoje reescreveria o passado.",
  },
  {
    colecao: "controleAcesso",
    classe: "irrecuperavel",
    conteudo: "Quem entra e com que papel.",
    perda:
      "NINGUÉM entra — nem o dono. É a coleção que precisa voltar PRIMEIRO " +
      "numa restauração, porque sem ela não há como usar o app pra conferir o resto.",
  },
  {
    colecao: "controleAcessoMeta",
    classe: "irrecuperavel",
    conteudo: "Marca de que o bootstrap do primeiro owner já aconteceu.",
    perda:
      "Sem ela o bootstrap reabre. Não é perda de informação, é perda de " +
      "trava — e por isso volta junto com controleAcesso, nunca depois.",
  },
  {
    colecao: "tarefas",
    classe: "irrecuperavel",
    conteudo: "Tarefas da operação, abertas e concluídas.",
    perda: "O que estava combinado pra fazer.",
  },
  {
    colecao: "ads_alteracoes",
    classe: "irrecuperavel",
    conteudo: "Registro de mudanças feitas em campanha e quando.",
    perda:
      "Some a única forma de ligar uma virada no ROAS à mudança que a causou. " +
      "O ML não guarda esse histórico pra gente.",
  },
  {
    colecao: "auditLog",
    classe: "irrecuperavel",
    conteudo: "Trilha de quem fez o quê.",
    perda: "Uma trilha de auditoria restaurável a partir de outra coisa não seria uma trilha de auditoria.",
  },
  {
    colecao: "dias",
    classe: "irrecuperavel",
    conteudo: "Fechamento por dia, com anotação de contexto.",
    perda:
      "Os números se recalculam do ML; a ANOTAÇÃO do dia, não. É o único " +
      "lugar onde fica registrado por que um dia foi fora da curva.",
  },
  {
    colecao: "rascunho",
    classe: "irrecuperavel",
    conteudo: "Texto em edição ainda não publicado.",
    perda: "Trabalho em andamento de quem estava escrevendo.",
  },
  {
    colecao: "alertasDispensados",
    classe: "irrecuperavel",
    conteudo: "Alertas que alguém marcou como já tratados.",
    perda:
      "Não é grave, é irritante do jeito que faz abandonar o recurso: todo " +
      "alerta já resolvido volta de uma vez.",
  },
  {
    colecao: "usuarios",
    classe: "irrecuperavel",
    conteudo: "Preferências por usuário, sob usuarios/{uid}/preferences.",
    perda: "Cada pessoa reconfigura a tela dela.",
  },
  {
    colecao: "notification_events",
    classe: "efemero",
    conteudo: "Fila e histórico de eventos de notificação já entregues.",
    perda: "Nada operacional — o histórico de avisos já lidos.",
  },
  {
    colecao: "notification_events_publico",
    classe: "efemero",
    conteudo: "A versão sem dado financeiro dos mesmos eventos, pra quem não vê custo nem margem.",
    perda: "Nada operacional — some junto com notification_events e pelo mesmo motivo.",
  },
  {
    colecao: "notification_feed",
    classe: "efemero",
    conteudo: "O feed de avisos direcionados de cada pessoa: tarefa atribuída, lembrete de prazo e testes.",
    perda: "Nada operacional — a tarefa em si está em tarefas; só o histórico do aviso se perde.",
  },
  {
    colecao: "notification_janelas",
    classe: "efemero",
    conteudo: "A janela de vendas rápidas em curso e as anteriores: quais vendas entraram em cada rajada.",
    perda: "Nada operacional — a próxima venda abre uma janela nova; só o resumo de uma rajada em andamento se perderia.",
  },
  {
    colecao: "notification_limites",
    classe: "efemero",
    conteudo: "Contadores de taxa das rotas de notificação (quantas atribuições de tarefa uma pessoa disparou na janela).",
    perda: "Nada — o contador recomeça do zero.",
  },
  {
    colecao: "notification_outbox",
    classe: "efemero",
    conteudo: "O que cada push agendado precisa pra ser enviado: payload completo, audiência e validade.",
    perda: "Nada operacional — avisos pendentes deixam de ser reenviados; o histórico está em notification_events.",
  },
  {
    colecao: "notification_entregas",
    classe: "efemero",
    conteudo: "O estado de entrega de cada aviso em cada aparelho (pendente, aceito, suprimido, vencido, falha).",
    perda: "Nada operacional — só o rastro de quem recebeu o quê; é apagado sozinho depois de 14 dias.",
  },
  {
    colecao: "pushTokens",
    classe: "efemero",
    conteudo: "Tokens de push por dispositivo.",
    perda: "O app registra de novo no próximo acesso de cada aparelho.",
  },
  {
    colecao: "ml_oauth_transacoes",
    classe: "efemero",
    conteudo: "State e verifier de autorizações em voo, com validade de minutos.",
    perda:
      "Nenhuma — e restaurar seria PIOR que perder: revive state já usado. " +
      "Esta coleção é excluída do backup de propósito.",
  },
  /**
   * ─── FUNDAÇÃO MULTI-TENANT (S01) — ainda não usada pelo app ────────────
   *
   * `tenants`/`members` existem só nas regras (firestore.rules), aditivas,
   * sem nenhuma rota ou tela escrevendo nelas ainda — ver
   * docs/saas/PROGRESSO.md. Classificadas já agora porque o teste logo
   * abaixo (`toda coleção de firestore.rules tem decisão de backup`) não
   * distingue "existe na regra" de "tem dado de verdade": a decisão
   * precisa existir ANTES da coleção começar a ser usada, não depois que
   * alguém notar que ela não está no backup.
   */
  {
    colecao: "tenants",
    classe: "irrecuperavel",
    conteudo: "Metadado do tenant: nome, plano, estado da assinatura.",
    perda: "A empresa perde a própria identidade no sistema — nome, plano, tudo que a distingue de outro tenant.",
  },
  {
    colecao: "members",
    classe: "irrecuperavel",
    conteudo: "Subcoleção de tenants/{id}: quem pertence ao tenant e com que papel — o controleAcesso multi-tenant.",
    perda: "NINGUÉM entra naquele tenant — mesma gravidade e mesma prioridade de restauração de controleAcesso hoje.",
  },
  {
    colecao: "memberships",
    classe: "irrecuperavel",
    conteudo: "Ponteiro reverso e-mail → tenantId, só lido pelo servidor (ver firestore.rules).",
    perda:
      "Tecnicamente reconstruível varrendo tenants/*/members/* inteiro, mas até existir uma " +
      "ferramenta que faça isso automaticamente, tratar como irrecuperável é o lado seguro do erro.",
  },
];

/** Coleções que NÃO devem ser restauradas nunca, mesmo se estiverem no dump. */
export const NUNCA_RESTAURAR: readonly string[] = ["ml_oauth_transacoes"];

/**
 * A ordem em que as coleções voltam.
 *
 * `controleAcesso` primeiro não é preferência: sem ela ninguém entra no app
 * pra conferir se a restauração deu certo. Uma restauração que termina com o
 * dono do lado de fora não terminou.
 */
export const ORDEM_DE_RESTAURACAO: readonly string[] = [
  "controleAcesso",
  "controleAcessoMeta",
  // Ainda não usadas pelo app (ver o comentário no INVENTARIO) — na ordem
  // certa desde já, pra não precisar lembrar disto quando a migração ligar
  // a fundação multi-tenant de verdade. tenants antes de members (a
  // subcoleção pressupõe o documento pai) e memberships por último (é só
  // um ponteiro pra members, reconstruível a partir dele).
  "tenants",
  "members",
  "memberships",
  "estoque",
  "estoque_movimentos",
  "custos",
  "full_remessas",
  "metas",
  "metasHistorico",
  "dias",
  "ads_alteracoes",
  "tarefas",
  "alertasDispensados",
  "rascunho",
  "usuarios",
  "auditLog",
];

export function classeDe(colecao: string): ClasseDeDado | null {
  return INVENTARIO.find((i) => i.colecao === colecao)?.classe ?? null;
}

/** O que precisa entrar no backup: tudo que não é efêmero. */
export function colecoesParaBackup(): string[] {
  return INVENTARIO.filter((i) => i.classe !== "efemero").map((i) => i.colecao);
}

export function podeRestaurar(colecao: string): boolean {
  return !NUNCA_RESTAURAR.includes(colecao);
}

/**
 * Onde o dump pode ser restaurado.
 *
 * ─── POR QUE ISTO É UMA FUNÇÃO E NÃO UM AVISO NO README ──────────────────
 *
 * "Uma cópia no mesmo banco não resolve todos os cenários de perda" — e o
 * cenário que ela não resolve é o mais provável de todos: não é o data center
 * pegar fogo, é um script de migração apagar a coleção errada. Uma cópia
 * dentro do mesmo projeto morre junto com o original.
 *
 * Restaurar POR CIMA do projeto de produção também é um cenário de perda: se
 * o dump estiver velho, a restauração apaga o que veio depois dele. Por isso
 * o destino padrão é outro projeto, e escrever em produção exige um sinal
 * explícito de quem está restaurando — não uma flag esquecida num script.
 */
export function avaliarDestino(args: {
  projetoDeOrigem: string;
  projetoDeDestino: string;
  confirmouProducao: boolean;
  /**
   * O destino é um emulador local?
   *
   * ─── POR QUE ISTO PRECISOU EXISTIR ────────────────────────────────────
   *
   * O ensaio no emulador usa o MESMO id de projeto de propósito: o id é o que
   * separa os dados dentro do emulador, e o app só encontra o que foi
   * restaurado se os dois combinarem.
   *
   * Só que a regra olhava o id e concluía "é produção" — recusando justamente
   * o ensaio, que é a coisa que ela existe pra viabilizar. Emulador não tem
   * produção pra proteger: nada nele sai da máquina.
   */
  emulador?: boolean;
}): { permitido: boolean; motivo: string } {
  if (!args.projetoDeDestino) {
    return { permitido: false, motivo: "destino_ausente" };
  }

  // Antes da comparação de id: o emulador é isolado por construção, e o id
  // igual ali é requisito, não risco.
  if (args.emulador) {
    return { permitido: true, motivo: "destino_emulador" };
  }
  if (args.projetoDeDestino !== args.projetoDeOrigem) {
    return { permitido: true, motivo: "destino_isolado" };
  }
  if (!args.confirmouProducao) {
    return { permitido: false, motivo: "producao_sem_confirmacao" };
  }
  return { permitido: true, motivo: "producao_confirmada" };
}

export function explicarDestino(motivo: string): string {
  if (motivo === "destino_emulador") {
    return "Destino é um emulador local — nada sai desta máquina, e o id igual ao de produção é requisito do ensaio.";
  }
  if (motivo === "destino_isolado") {
    return "Restaurando num projeto separado — o original fica intacto.";
  }
  if (motivo === "producao_confirmada") {
    return "Restaurando SOBRE a produção, com confirmação explícita. Tudo que foi criado depois do dump será sobrescrito.";
  }
  if (motivo === "producao_sem_confirmacao") {
    return "O destino é o mesmo projeto de origem. Restaurar aqui sobrescreve dados de produção — repita com --confirmar-producao se é isso mesmo.";
  }
  return "Nenhum projeto de destino foi informado.";
}

/**
 * Quantos dias de backup guardar.
 *
 * ─── O RACIOCÍNIO ───────────────────────────────────────────────────────
 *
 * A perda que a retenção precisa cobrir não é a que se descobre no mesmo dia
 * — essa o backup de ontem resolve. É a silenciosa: um custo médio corrompido
 * por importação errada só aparece quando alguém estranha a margem, e isso
 * leva semanas.
 *
 * Por isso a escada: diários cobrem o acidente óbvio, e os mensais existem
 * pra poder voltar a um mês fechado depois de descobrir tarde. 12 mensais dão
 * um ano — o bastante pra comparar com o mesmo mês do ano anterior, que é
 * quando a diferença fica evidente.
 */
export const RETENCAO = {
  diarios: 14,
  semanais: 8,
  mensais: 12,
} as const;

/** Decide se um backup de certa data ainda deve ser guardado. */
export function manterBackup(args: {
  /** Idade do backup, em dias. */
  idadeEmDias: number;
  /** É o backup do último dia do mês? */
  fimDeMes: boolean;
  /** É de domingo? */
  fimDeSemana: boolean;
}): boolean {
  if (args.idadeEmDias <= RETENCAO.diarios) return true;
  if (args.fimDeMes && args.idadeEmDias <= RETENCAO.mensais * 31) return true;
  if (args.fimDeSemana && args.idadeEmDias <= RETENCAO.semanais * 7) return true;
  return false;
}
