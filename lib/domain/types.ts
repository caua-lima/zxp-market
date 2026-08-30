export type Listing = {
  name: string;
  preco: string;
  retorno: string;
  custo: string;
  vendas: string;
  ads: string;
  mlb?: string;
  productId?: string;
};

export type ComputedAd = {
  name: string;
  faturamento: number;
  cmv: number;
  bruto: number;
  liquido: number;
  margem: number;
  ads: number;
  roas: number | null;
};

export type DaySummary = {
  ads: ComputedAd[];
  totalFaturamento: number;
  totalCMV: number;
  totalBruto: number;
  totalLiquido: number;
  totalAds: number;
  totalRoas: number | null;
  totalMargem: number;
};

export type ArchivedDay = DaySummary & {
  date: string;
  raw: Listing[];
  createdBy?: string;
};

export type Goals = {
  mes: string;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  // Meta de margem de lucro líquido em % (padrão 10). A meta diária é derivada
  // automaticamente da meta mensal (meta1 / dias do mês).
  metaMargem: number | null;
  metaDiaria: number | null;
  meta2Diaria: number | null;
  meta3Diaria: number | null;
  /** Meta de lucro líquido em R$, opcional e independente da meta de faturamento — nem todo mês com faturamento batido tem lucro batido junto. */
  metaLucro: number | null;
  label?: string;
};

export type GoalEntry = {
  id: string;
  mes: string;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  metaMargem: number | null;
  metaDiaria: number | null;
  meta2Diaria: number | null;
  meta3Diaria: number | null;
  metaLucro: number | null;
  label?: string;
  createdBy?: string;
  createdAt?: number;
};

export type CostCategoria =
  | "embalagem" | "ferramenta" | "equipe" | "logistica" | "servico"
  | "software" | "impostos" | "retirada" | "contabilidade" | "outros";

export const COST_CATEGORIA_LABEL: Record<CostCategoria, string> = {
  embalagem: "Embalagem", ferramenta: "Ferramenta", equipe: "Equipe", logistica: "Logística",
  servico: "Serviço", software: "Software", impostos: "Impostos", retirada: "Retirada",
  contabilidade: "Contabilidade", outros: "Outros",
};

export type Cost = {
  id: string;
  nome: string;
  valor: string;
  freq: "diario" | "mensal" | "avulso";
  data: string;
  /**
   * "dash" (padrão) desconta no lucro líquido do Dashboard — é o custo da
   * operação de venda. "dre" só aparece na DRE: pró-labore, contador,
   * retirada e afins, que não devem sujar o número que se olha todo dia.
   */
  escopo?: "dash" | "dre";
  categoria?: CostCategoria;
  centroCusto?: string; // ex.: "Anúncios ML", "Galpão", "Financeiro" — livre, não é enum
  observacao?: string;
  /** false = arquivado (some das listas ativas, mas continua contando no histórico — nunca apagado por engano). */
  ativo?: boolean;
  createdBy?: string;
};

export type DraftToday = {
  date: string;
  ads: Listing[];
  createdBy?: string;
  updatedAt?: number;
};

export type ImpostoFaixa = {
  desde: string;             // yyyy-mm-dd — primeira data em que a alíquota vale
  pct: number;               // ex.: 4 = 4%
};

/**
 * Alíquota que vale na data da venda. Sem faixas, cai no campo antigo, que
 * valia para todo o histórico. Antes da primeira faixa, 0.
 */
export function impostoNaData(
  prod: { imposto?: string | number; impostoFaixas?: ImpostoFaixa[] },
  dataISO: string,
): number {
  const faixas = prod.impostoFaixas;
  if (!faixas?.length) return Number(prod.imposto ?? 0) || 0;
  const dia = String(dataISO).slice(0, 10);
  let melhor: ImpostoFaixa | null = null;
  for (const f of faixas) {
    if (!f?.desde || f.desde > dia) continue;
    if (!melhor || f.desde > melhor.desde) melhor = f;
  }
  return melhor ? Number(melhor.pct) || 0 : 0;
}

export type CustoFaixa = {
  desde: string;             // yyyy-mm-dd — data em que esse custo médio passou a valer
  custo: number;
};

/**
 * Sentinela bem no passado — grava a "primeira" faixa retroativa quando um
 * produto ainda não tinha nenhuma (ver recomputeProduto em lib/firebase/data.ts).
 * Garante que qualquer pedido real sempre encontre alguma faixa aplicável.
 */
export const CUSTO_FAIXA_SENTINELA = "2000-01-01";

/**
 * Custo médio que valia na data da venda — cada entrada nova só vale DAQUI
 * PRA FRENTE, não reescreve a margem de vendas já feitas (ver comentário em
 * recomputeProduto). Sem faixas (produto ainda não passou por uma entrada
 * depois desta feature existir), cai no valor atual — mesmo comportamento de
 * antes, não 0: diferente do imposto, "sem histórico" aqui não significa
 * "custo zero", significa "só temos o valor de hoje".
 */
export function custoNaData(
  prod: { custoMedio?: number; custo?: string | number; custoMedioFaixas?: CustoFaixa[] },
  dataISO: string,
): number {
  const atual = Number(prod.custoMedio ?? prod.custo ?? 0) || 0;
  const faixas = prod.custoMedioFaixas;
  if (!faixas?.length) return atual;
  const dia = String(dataISO).slice(0, 10);
  let melhor: CustoFaixa | null = null;
  for (const f of faixas) {
    if (!f?.desde || f.desde > dia) continue;
    if (!melhor || f.desde > melhor.desde) melhor = f;
  }
  return melhor ? melhor.custo : atual;
}

export type Product = {
  id: string;
  name: string;
  custo: string;             // custo manual (fallback / compat)
  sku?: string;              // bate com items[].sku dos pedidos ML
  imposto?: string;          // % de imposto sobre a venda (ex: "8" = 8%)
  /**
   * Faixas de vigência do imposto, em ordem qualquer. A alíquota de uma venda
   * é a da faixa mais recente cujo `desde` <= data da venda. Venda anterior à
   * primeira faixa paga 0 — foi o caso da virada de MEI (isento) para ME.
   * Sem faixas, `imposto` vale para todo o histórico (comportamento antigo).
   */
  impostoFaixas?: ImpostoFaixa[];
  mlb?: string;              // 1º código MLB (compat); ver mlbs
  mlbs?: string[];           // vários anúncios (MLB) do mesmo produto
  ativo: boolean;
  createdBy?: string;
  // Calculados pelo livro de movimentações (média móvel ponderada):
  custoMedio?: number;       // custo médio atual — usado no CMV do lucro
  /**
   * Vigência do custo médio, em ordem qualquer — mesma ideia do impostoFaixas.
   * Cada entrada nova só vale a partir da própria data dela: vendas já
   * registradas continuam com o custo médio de quando aconteceram, em vez de
   * pular pro custo médio de hoje toda vez que o estoque é atualizado.
   */
  custoMedioFaixas?: CustoFaixa[];
  qtdLocal?: number;         // estoque no galpão (entradas − envios Full − ajustes)
  // @deprecated — preço e retorno vêm automaticamente das vendas do ML
  preco?: string;
  retorno?: string;
  // @deprecated — ADS e Full agora são puxados automaticamente do ML
  ads?: string;
  custo_envio_full?: string;
};

// Livro de movimentações do estoque local (galpão).
// entrada       = compra (soma qtd no galpão, entra no custo médio, exige custoUnit)
// saldo_inicial = estoque que já existia (ex.: já no Full) — entra só no custo
//                 médio, NÃO soma no galpão. Exige custoUnit.
// saida_full    = envio pro Full (baixa qtd do galpão, NÃO é venda, não mexe no custo)
// ajuste        = correção/perda/quebra (quantidade com sinal: + ou −)
export type MovimentoTipo = "entrada" | "saldo_inicial" | "saida_full" | "ajuste";

export const TIPO_MOVIMENTO_LABEL: Record<MovimentoTipo, string> = {
  entrada: "Entrada",
  saldo_inicial: "Custo do Full",
  saida_full: "Envio Full",
  ajuste: "Ajuste",
};

export type EstoqueMovimento = {
  id: string;
  productId: string;
  tipo: MovimentoTipo;
  quantidade: number;        // entrada/saida_full: positivo; ajuste: com sinal
  custoUnit?: number;        // só na entrada (R$/unidade)
  data: string;              // yyyy-mm-dd
  obs?: string;
  createdBy?: string;
  createdAt?: number;
  /** Presentes só quando a movimentação foi CORRIGIDA depois de criada (ver updateMovimento em lib/firebase/data.ts) — createdBy/createdAt originais nunca são sobrescritos. */
  updatedBy?: string;
  updatedAt?: number;
};

// Tipo do que foi alterado — estruturado (Fase 6 da reforma de Ads) pra dar
// pra montar frases automáticas ("ROAS alvo: 16x → 20x") e filtrar por tipo,
// sem depender de parsear texto livre.
export type AdsAlteracaoTipo = "orcamento" | "roas_alvo" | "status" | "criativo" | "preco" | "outro";

export const ADS_ALTERACAO_TIPO_LABEL: Record<AdsAlteracaoTipo, string> = {
  orcamento: "Orçamento",
  roas_alvo: "ROAS alvo",
  status: "Status",
  criativo: "Criativo/título",
  preco: "Preço/oferta",
  outro: "Outro",
};

// Registro MANUAL de alteração de campanha de Ads (ex.: "subi o ROAS pra
// 20x") — não vem do Mercado Livre, é o vendedor documentando a PRÓPRIA
// mudança pra saber quando mexeu da última vez. campaignId/productId são
// gravados junto (não recalculados depois) pra o filtro por produto
// continuar funcionando mesmo que o vínculo campanha↔produto mude no ML.
// `tipo`/`valorAnterior`/`valorNovo`/`motivo` são novos e opcionais — registro
// antigo (só com `nota`) continua válido e exibível, não precisa de migração.
export type AdsAlteracao = {
  id: string;
  campaignId: string;
  campaignName: string;
  productId: string;
  productName: string;
  tipo?: AdsAlteracaoTipo;
  valorAnterior?: string;
  valorNovo?: string;
  motivo?: string;
  nota: string;
  createdBy: string;
  createdByName?: string;
  createdAt: number;
};

// Abas com formulário/mutação de verdade e que fazem sentido liberar
// individualmente pra um colaborador. De propósito NÃO inclui:
// "tarefas" (já é leitura+escrita pra todo autorizado, por design — ver
// firestore.rules), "acesso" (sempre owner-only, nunca delegável) e
// "pedidos"/"dre" (telas só de leitura, sem nada pra "editar"). "ads" entrou
// quando o registro de alterações de campanha (ads_alteracoes) foi criado —
// as MÉTRICAS de Ads continuam só-leitura, só o changelog é editável.
export type PermissionTab = "custos" | "metas" | "estoque" | "ads";

export type AccessEntry = {
  email: string;
  // "admin"/"user" são papéis legados (contas cadastradas antes desta versão)
  // — continuam existindo em documentos antigos do Firestore, então o tipo
  // aceita ler os dois, mas toda escrita nova usa só "owner"/"colaborador".
  role: "owner" | "partner" | "member" | "colaborador" | "admin" | "user";
  displayName?: string;
  photoURL?: string;
  addedAt?: number;
  /**
   * Abas em que ESTE colaborador pode editar, além do padrão somente-leitura.
   * Ignorado pro owner (edita tudo sempre). Ausente/vazio = comportamento de
   * sempre (colaborador só lê) — campo aditivo, não muda ninguém já existente.
   */
  permissoesEdicao?: PermissionTab[];
};

/**
 * Os três papéis que existem hoje, depois de normalizar o que está gravado.
 *
 * ─── DE ONDE VEIO ESTA DIVISÃO ──────────────────────────────────────────
 *
 * Antes havia só "owner" e "colaborador". "Colaborador" acumulava dois casos
 * bem diferentes: quem participa da operação (e precisa ver custo, estoque,
 * preço, DRE) e quem só acompanha o resultado. Dar a segunda pessoa acesso a
 * custo e margem é vazar o núcleo do negócio sem necessidade.
 *
 *   owner   — dono. Vê e edita tudo, e só ele mexe em acessos.
 *   partner — o que "colaborador" sempre foi: vê todas as abas, edita só as
 *             liberadas em permissoesEdicao.
 *   member  — Dashboard e notificações, nada mais. Sem custo, sem margem,
 *             sem estoque, sem preço.
 */
export type Papel = "owner" | "partner" | "member";

/**
 * O papel efetivo de um registro.
 *
 * "colaborador", "admin" e "user" são valores gravados por versões
 * anteriores. Todos viram `partner`, que é exatamente o que eles já podiam
 * fazer — a migração não pode dar nem tirar acesso de ninguém por acidente,
 * e "member" é MAIS restrito que o que essas contas tinham.
 */
export function papelDe(role: AccessEntry["role"] | undefined | null): Papel {
  if (role === "owner") return "owner";
  if (role === "member") return "member";
  return "partner";
}

/** Rótulo de exibição do papel. */
export function roleLabel(role: AccessEntry["role"]): "Owner" | "Partner" | "Member" {
  const p = papelDe(role);
  return p === "owner" ? "Owner" : p === "member" ? "Member" : "Partner";
}

/**
 * As únicas abas que um `member` alcança.
 *
 * Dashboard é o resultado consolidado; as notificações não são aba, moram no
 * sino. Tudo que revela custo, margem, preço ou estoque fica de fora — é o
 * ponto inteiro do papel.
 */
export const ABAS_DO_MEMBER = ["dashboard"] as const;

/**
 * Este papel enxerga esta aba?
 *
 * Puro de propósito: é a mesma regra que decide a navegação, a proteção da
 * aba ativa e o que as regras do Firestore precisam espelhar. Tendo três
 * cópias da regra, elas divergem — e divergência aqui é vazamento.
 */
export function podeVerAba(papel: Papel, aba: string): boolean {
  // Acesso é do owner e nunca foi delegável.
  if (aba === "acesso") return papel === "owner";
  if (papel === "member") return (ABAS_DO_MEMBER as readonly string[]).includes(aba);
  return true;
}

// ── Tarefas (Kanban) ────────────────────────────────────────────
export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "baixa" | "media" | "alta" | "critica";

/** De onde a tarefa veio — "manual" é o padrão; os outros marcam que ela
 *  nasceu de um alerta convertido (Central de Atenção → Tarefas). */
export type TaskOrigem = "manual" | "ads" | "estoque" | "meta" | "pedido";

/** Rastro simples de eventos — não é um histórico completo, só os marcos
 *  que a Fase 8 pediu: criada, atribuída, movida, concluída. */
export type TaskAtividadeTipo = "criada" | "atribuida" | "movida" | "concluida";
export type TaskAtividade = {
  tipo: TaskAtividadeTipo;
  por: string; // e-mail de quem fez
  em: number; // timestamp
  detalhe?: string; // ex.: "todo → doing", ou o nome de quem recebeu
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority; // sem valor = "media" na leitura (roleLabel-like default)
  origem?: TaskOrigem;
  /** Chave do alerta que virou esta tarefa (ver lib/domain/alerts.ts) — só quando origem != "manual". */
  origemRef?: string;
  // E-mail (+ nome, como snapshot pra não depender de outra leitura) de quem
  // deve executar a tarefa — é o que permite "eu peço pro meu sócio e vice-versa".
  assignedTo?: string;
  assignedToName?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: number;
  updatedAt?: number;
  /** Quem fez a ÚLTIMA alteração — diferente de createdBy, pra colaborador editar sem apagar a autoria original. */
  lastEditedBy?: string;
  dueDate?: string; // yyyy-mm-dd, opcional
  atividade?: TaskAtividade[];
};

/** Vencida = tem prazo, já passou, e ainda não foi concluída. */
export function isTaskAtrasada(t: Task): boolean {
  if (!t.dueDate || t.status === "done") return false;
  return t.dueDate < new Date().toISOString().slice(0, 10);
}

/** Acrescenta um evento ao rastro de atividade, mantendo só os últimos `max` (padrão 20) — não deixa o array crescer sem limite. */
export function appendAtividade(atual: TaskAtividade[] | undefined, evento: TaskAtividade, max = 20): TaskAtividade[] {
  return [...(atual ?? []), evento].slice(-max);
}

// ── Trilha de auditoria ─────────────────────────────────────────
// Diferente de TaskAtividade (que vive dentro de UMA tarefa), isto é um log
// GLOBAL e imutável (append-only, ver firestore.rules) de ações relevantes em
// qualquer parte do app — quem criou/editou/arquivou/excluiu o quê. Só
// registra ações discretas de usuário (clique em "Salvar"/"Arquivar"/
// "Excluir"), não o auto-save por campo do Custos: logar cada tecla digitada
// viraria ruído, não auditoria.
export type AuditAction = "criar" | "editar" | "arquivar" | "reativar" | "excluir";
// "produto" e "movimento" (estoque) entraram depois: mexer em custo médio ou
// lançar/apagar uma movimentação muda o lucro de vendas passadas, então é
// exatamente o tipo de ação que precisa de rastro de quem fez.
export type AuditEntity = "custo" | "meta" | "acesso" | "produto" | "movimento";

export type AuditEvent = {
  id: string;
  acao: AuditAction;
  entidade: AuditEntity;
  entidadeId: string;
  /** Rótulo legível da entidade no momento da ação (nome do custo, mês da meta, e-mail do acesso) — não depende de resolver o id depois, então continua fazendo sentido mesmo se o registro original for excluído. */
  entidadeLabel: string;
  por: string; // e-mail de quem fez a ação
  em: number;  // timestamp
  detalhe?: string;
};