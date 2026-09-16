/**
 * O que está errado com cada produto, e o que fazer a respeito.
 *
 * ─── O PROBLEMA QUE ISTO RESOLVE ─────────────────────────────────────────
 *
 * A aba de Estoque mostrava tudo que sabia sobre cada produto — estoque em
 * casa, Full, cobertura, custo, MLBs, preço — e deixava a conclusão pra
 * pessoa. Com quarenta produtos, "qual deles precisa de mim hoje?" virava um
 * exercício de ler quarenta linhas e cruzar seis colunas de cabeça.
 *
 * Aqui cada produto ganha SINAIS (o que há de errado) e uma PRÓXIMA AÇÃO (o
 * que fazer primeiro). A ação é uma só de propósito: uma lista que diz três
 * coisas por linha não é uma lista de tarefas, é a mesma tabela com mais
 * texto.
 */

export type SinalDoProduto =
  /** Acabou, ou acaba antes de qualquer reposição chegar. */
  | "ruptura"
  /** Dura pouco — perto de ruptura, ainda dá tempo. */
  | "cobertura_baixa"
  /** Sem custo médio: o CMV dele entra como ZERO e infla o lucro. */
  | "sem_custo"
  /** Nenhum anúncio vinculado: o app não sabe o que este produto vende. */
  | "sem_vinculo"
  /** Os números não fecham entre si — unidade contada duas vezes. */
  | "inconsistencia"
  /** Tem remessa enviada pro Full cuja baixa não foi lançada. */
  | "remessa_pendente";

export type ProdutoNaLista = {
  id: string;
  nome: string;
  /** Total com que se pode contar: disponível + o que volta a vender. */
  estoqueTotal: number;
  /** Fora do Full — no seu galpão. */
  emCasa: number;
  /** Disponível no Full. */
  noFull: number;
  ehFull: boolean;
  mediaDiaria: number;
  custoUnitario: number;
  ativo: boolean;
  /** Quantos anúncios estão vinculados a este produto. */
  anuncios: number;
  /** Unidades contadas duas vezes (remessa sem baixa lançada). */
  duplicadas: number;
};

/**
 * Quantos dias o estoque dura.
 *
 * `null` quando não há ritmo de venda conhecido — e null NÃO é infinito: um
 * produto que nunca vendeu não "dura pra sempre", é um produto sobre o qual
 * não se sabe nada. Tratar os dois igual coloca o produto sem histórico no
 * fim da fila de urgência, que é onde ele deve estar, mas pelo motivo certo.
 */
export function duracaoEmDias(estoque: number, mediaDiaria: number): number | null {
  if (!Number.isFinite(mediaDiaria) || mediaDiaria <= 0) return null;
  return Math.max(estoque, 0) / mediaDiaria;
}

/**
 * Abaixo de quantos dias a cobertura é "baixa".
 *
 * 10 dias é um julgamento, e ele é declarado aqui em vez de embutido numa
 * condição no meio de um componente. O raciocínio: o prazo típico entre
 * decidir comprar e a unidade estar vendável no Full — pedido ao fornecedor,
 * recebimento, coleta, conferência no centro — não fecha em menos de uma
 * semana. Dez dias dá margem pra reagir; cinco já é atraso.
 */
export const DIAS_COBERTURA_BAIXA = 10;

export function sinaisDoProduto(p: ProdutoNaLista): SinalDoProduto[] {
  const sinais: SinalDoProduto[] = [];
  const dura = duracaoEmDias(p.estoqueTotal, p.mediaDiaria);

  if (p.estoqueTotal <= 0) sinais.push("ruptura");
  else if (dura !== null && dura < 1) sinais.push("ruptura");
  else if (dura !== null && dura < DIAS_COBERTURA_BAIXA) sinais.push("cobertura_baixa");

  if (!(p.custoUnitario > 0)) sinais.push("sem_custo");
  if (p.anuncios <= 0) sinais.push("sem_vinculo");
  if (p.duplicadas > 0) sinais.push("inconsistencia", "remessa_pendente");

  return sinais;
}

export type Acao =
  | "comprar"
  | "enviar_full"
  | "vincular"
  | "cadastrar_custo"
  | "conferir"
  | "nada";

export type ProximaAcao = {
  acao: Acao;
  /** 0 = nada a fazer; quanto maior, mais urgente. Ordena a vista de ação. */
  urgencia: number;
  rotulo: string;
  /** Por que esta e não outra. */
  porque: string;
};

/**
 * A próxima ação, UMA só, por ordem de urgência.
 *
 * ─── A ORDEM, E POR QUE ELA É ESTA ───────────────────────────────────────
 *
 * Ruptura vem primeiro porque é a única que custa DINHEIRO POR HORA: anúncio
 * sem estoque no Full perde posição, e posição não se recompra — reabastecer
 * devolve o estoque e não devolve o lugar na busca.
 *
 * E ruptura COM estoque em casa é mais urgente que sem: ela se resolve hoje,
 * com uma coleta, sem gastar nada. A pessoa precisa ver essa primeiro porque é
 * a que ela consegue resolver agora.
 *
 * Cadastro de custo e vínculo vêm depois. Eles estragam os NÚMEROS — e número
 * errado é grave —, mas não estão perdendo venda enquanto se espera.
 *
 * `conferir` é a menos urgente das reais: a inconsistência atrapalha a
 * leitura, e não a operação.
 */
export function proximaAcao(p: ProdutoNaLista): ProximaAcao {
  const sinais = new Set(sinaisDoProduto(p));

  // Produto inativo não tem ação nenhuma: ninguém vai comprar estoque pra um
  // produto que não está à venda, e mostrá-lo na fila de ação empurra pra
  // baixo o que importa.
  if (!p.ativo) {
    return { acao: "nada", urgencia: 0, rotulo: "Inativo", porque: "Produto marcado como inativo." };
  }

  const podeDespachar = p.ehFull && p.emCasa > 0;

  if (sinais.has("ruptura")) {
    if (podeDespachar) {
      return {
        acao: "enviar_full",
        urgencia: 100,
        rotulo: "Enviar ao Full",
        porque: `Zerado no Full com ${p.emCasa} un no galpão. Resolve hoje, sem comprar nada — e cada hora parado tira posição do anúncio.`,
      };
    }
    return {
      acao: "comprar",
      urgencia: 90,
      rotulo: "Comprar",
      porque: "Sem estoque em lugar nenhum. Enquanto não chega, o anúncio perde posição — e posição não se recompra.",
    };
  }

  if (sinais.has("cobertura_baixa")) {
    const dias = duracaoEmDias(p.estoqueTotal, p.mediaDiaria);
    const quanto = dias === null ? "" : ` Dura ~${Math.floor(dias)} dia(s).`;
    if (podeDespachar) {
      return {
        acao: "enviar_full",
        urgencia: 70,
        rotulo: "Enviar ao Full",
        porque: `Vai zerar no Full, e há ${p.emCasa} un no galpão.${quanto}`,
      };
    }
    return {
      acao: "comprar",
      urgencia: 60,
      rotulo: "Comprar",
      porque: `Acaba antes de uma reposição chegar.${quanto}`,
    };
  }

  if (sinais.has("sem_vinculo")) {
    return {
      acao: "vincular",
      urgencia: 40,
      rotulo: "Vincular anúncio",
      porque: "Sem anúncio vinculado, o app não sabe quanto este produto vende nem quanto tem no ML.",
    };
  }

  if (sinais.has("sem_custo")) {
    return {
      acao: "cadastrar_custo",
      urgencia: 30,
      rotulo: "Cadastrar custo",
      porque: "Sem custo, o CMV deste produto entra como ZERO e o lucro dele aparece inteiro.",
    };
  }

  if (sinais.has("inconsistencia")) {
    return {
      acao: "conferir",
      urgencia: 20,
      rotulo: "Conferir",
      porque: `${p.duplicadas} un contadas duas vezes: já no Full e ainda no livro do galpão. Lance a baixa da remessa.`,
    };
  }

  return { acao: "nada", urgencia: 0, rotulo: "—", porque: "Nada pendente neste produto." };
}

/** Precisa de ação? É o que separa a primeira vista das outras. */
export function precisaDeAcao(p: ProdutoNaLista): boolean {
  return proximaAcao(p).urgencia > 0;
}

export type FiltroEstoque = {
  busca: string;
  /** Sinais exigidos. Vazio = todos os produtos. */
  sinais: SinalDoProduto[];
  /** "full" | "proprio" | null (ambos) */
  logistica: "full" | "proprio" | null;
  incluirInativos: boolean;
};

export const FILTRO_ESTOQUE_VAZIO: FiltroEstoque = {
  busca: "", sinais: [], logistica: null, incluirInativos: false,
};

function chave(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Aplica busca e filtros.
 *
 * Os sinais combinam por OU, e não por E: quem marca "ruptura" e "sem custo"
 * quer ver os dois problemas na mesma lista, não o produto raro que tem os
 * dois ao mesmo tempo. É o contrário da busca por texto, onde duas palavras
 * são E — e a diferença é intencional: marcar duas caixas é ampliar, digitar
 * duas palavras é estreitar.
 */
export function filtrarProdutos(lista: readonly ProdutoNaLista[], f: FiltroEstoque): ProdutoNaLista[] {
  const termo = chave(f.busca).trim();
  const pedidos = new Set(f.sinais);

  return lista.filter((p) => {
    if (!f.incluirInativos && !p.ativo) return false;
    if (f.logistica === "full" && !p.ehFull) return false;
    if (f.logistica === "proprio" && p.ehFull) return false;

    if (pedidos.size) {
      const tem = sinaisDoProduto(p);
      if (!tem.some((s) => pedidos.has(s))) return false;
    }

    if (!termo) return true;
    const alvo = chave(`${p.nome} ${p.id}`);
    return termo.split(/\s+/).every((w) => alvo.includes(w));
  });
}

/** Quantos produtos carregam cada sinal — pro contador de cada filtro. */
export function contarSinais(lista: readonly ProdutoNaLista[]): Record<SinalDoProduto, number> {
  const c: Record<SinalDoProduto, number> = {
    ruptura: 0, cobertura_baixa: 0, sem_custo: 0,
    sem_vinculo: 0, inconsistencia: 0, remessa_pendente: 0,
  };
  for (const p of lista) {
    if (!p.ativo) continue;
    for (const s of sinaisDoProduto(p)) c[s] += 1;
  }
  return c;
}

export type ResumoDoEstoque = {
  ruptura: number;
  coberturaBaixa: number;
  /** Quanto dinheiro está parado em estoque, ao custo médio. */
  capitalEmEstoque: number;
  /** Produtos com remessa cuja baixa não foi lançada. */
  remessasPendentes: number;
  /**
   * Produtos sem custo cadastrado — o capital acima está SUBESTIMADO por
   * eles. Sem este número, "R$ 32.000 em estoque" parece um fato fechado
   * quando pode faltar metade.
   */
  semCusto: number;
};

export function resumoDoEstoque(lista: readonly ProdutoNaLista[]): ResumoDoEstoque {
  const r: ResumoDoEstoque = {
    ruptura: 0, coberturaBaixa: 0, capitalEmEstoque: 0, remessasPendentes: 0, semCusto: 0,
  };

  for (const p of lista) {
    if (!p.ativo) continue;
    const sinais = new Set(sinaisDoProduto(p));
    if (sinais.has("ruptura")) r.ruptura += 1;
    if (sinais.has("cobertura_baixa")) r.coberturaBaixa += 1;
    if (sinais.has("remessa_pendente")) r.remessasPendentes += 1;
    if (sinais.has("sem_custo")) r.semCusto += 1;
    r.capitalEmEstoque += Math.max(p.estoqueTotal, 0) * Math.max(p.custoUnitario, 0);
  }

  return r;
}

/** Ordena a fila de ação: mais urgente primeiro, nome como desempate. */
export function ordenarPorUrgencia(lista: readonly ProdutoNaLista[]): ProdutoNaLista[] {
  return [...lista].sort((a, b) => {
    const ua = proximaAcao(a).urgencia;
    const ub = proximaAcao(b).urgencia;
    if (ua !== ub) return ub - ua;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

export const ROTULO_SINAL: Record<SinalDoProduto, string> = {
  ruptura: "Ruptura",
  cobertura_baixa: "Cobertura baixa",
  sem_custo: "Sem custo",
  sem_vinculo: "Sem vínculo",
  inconsistencia: "Inconsistência",
  remessa_pendente: "Remessa pendente",
};
