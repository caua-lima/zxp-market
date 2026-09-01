/**
 * Quanto comprar de cada produto, dado que o fornecedor demora.
 *
 * ─── O QUE ISTO RESPONDE ────────────────────────────────────────────────
 *
 * "Meu fornecedor vai ficar 15 dias fora — quanto preciso pedir?"
 *
 * A conta ingênua é `média diária × 30 − estoque`. Ela erra por omissão: o
 * estoque também é consumido DURANTE os dias em que não chega reposição. Se
 * o fornecedor some por 15 dias e você compra pra cobrir 30, na prática
 * cobre 15 — os outros 15 foram gastos esperando a mercadoria chegar.
 *
 * Por isso a janela a cobrir é a SOMA:
 *
 *     dias a cobrir = prazo do fornecedor + cobertura desejada
 *     necessário    = média diária × dias a cobrir
 *     comprar       = necessário − estoque atual
 *
 * ─── O ALERTA QUE IMPORTA MAIS QUE A QUANTIDADE ─────────────────────────
 *
 * Saber quanto pedir só ajuda se der tempo. O produto que acaba ANTES de o
 * fornecedor voltar não tem solução por compra normal — ou se resolve agora
 * (outro fornecedor, comprar mais caro, subir preço pra segurar a saída), ou
 * o anúncio fica sem estoque e perde posição.
 *
 * Esse caso é separado e vem primeiro, porque é o único em que a decisão
 * muda de natureza — deixar de ser "quanto pedir" e virar "o que fazer".
 */

export type ProdutoReposicao = {
  id: string;
  nome: string;
  /** Tudo que dá pra vender hoje: Full + o que está fora do Full. */
  estoqueTotal: number;
  /** A parte que já está no galpão — sai sem depender do fornecedor. */
  emCasa: number;
  /** Unidades vendidas por dia, no período medido. */
  mediaDiaria: number;
  /** Custo médio, pra estimar o investimento da compra. */
  custoUnitario: number;
  /** Produto desativado não entra no plano. */
  ativo: boolean;
};

export type ItemDoPlano = {
  produtoId: string;
  nome: string;
  mediaDiaria: number;
  estoqueTotal: number;
  emCasa: number;
  /** Dias que o estoque atual ainda dura. `null` quando não houve venda no período. */
  duraDias: number | null;
  /** Quantas unidades precisam existir pra atravessar a janela inteira. */
  necessario: number;
  /** Quanto comprar: o que falta pro necessário. Zero = estoque já cobre. */
  comprar: number;
  /** `comprar` × custo unitário. */
  investimento: number;
  /**
   * O estoque acaba ANTES de o fornecedor voltar. Comprar depois não
   * resolve — quando a mercadoria chegar, o anúncio já ficou sem estoque.
   */
  rompeAntesDoPrazo: boolean;
  /** Sem venda no período: não dá pra projetar, e chutar seria pior. */
  semHistorico: boolean;
};

export type PlanoReposicao = {
  /** Só quem precisa de compra, do mais urgente pro menos. */
  itens: ItemDoPlano[];
  /** Produtos que rompem antes do fornecedor voltar — decisão diferente. */
  urgentes: ItemDoPlano[];
  /** Tem venda mas o estoque já cobre a janela: nada a fazer. */
  suficientes: number;
  /** Sem venda no período — ficam de fora da conta, mas são contados. */
  semHistorico: number;
  totalUnidades: number;
  totalInvestimento: number;
  /** A janela usada, pra tela poder explicar o número. */
  diasACobrir: number;
};

/** Dias que um estoque dura no ritmo atual. `null` sem ritmo conhecido. */
export function duracaoDoEstoque(estoque: number, mediaDiaria: number): number | null {
  if (!Number.isFinite(mediaDiaria) || mediaDiaria <= 0) return null;
  return Math.floor(Math.max(estoque, 0) / mediaDiaria);
}

/**
 * Unidades que precisam existir pra atravessar a janela.
 *
 * Arredonda pra CIMA: meia unidade de cobertura não existe, e faltar é mais
 * caro que sobrar — sobra vira estoque, falta vira anúncio parado.
 */
export function necessarioParaJanela(mediaDiaria: number, diasACobrir: number): number {
  if (!Number.isFinite(mediaDiaria) || mediaDiaria <= 0) return 0;
  if (!Number.isFinite(diasACobrir) || diasACobrir <= 0) return 0;
  return Math.ceil(mediaDiaria * diasACobrir);
}

/**
 * Monta o plano de compra.
 *
 * @param prazoFornecedorDias  dias até a mercadoria chegar (fornecedor fora,
 *   produção, transporte). É o tempo em que você vende sem repor.
 * @param coberturaDias  quanto o estoque deve durar DEPOIS de chegar.
 */
export function montarPlanoReposicao(
  produtos: ProdutoReposicao[],
  prazoFornecedorDias: number,
  coberturaDias: number,
): PlanoReposicao {
  const prazo = Math.max(0, Math.floor(prazoFornecedorDias) || 0);
  const cobertura = Math.max(0, Math.floor(coberturaDias) || 0);
  const diasACobrir = prazo + cobertura;

  const itens: ItemDoPlano[] = [];
  let suficientes = 0;
  let semHistorico = 0;

  for (const p of produtos) {
    if (!p.ativo) continue;

    const media = Number.isFinite(p.mediaDiaria) && p.mediaDiaria > 0 ? p.mediaDiaria : 0;
    const estoque = Math.max(Number(p.estoqueTotal) || 0, 0);

    if (media <= 0) {
      semHistorico++;
      continue;
    }

    const necessario = necessarioParaJanela(media, diasACobrir);
    const comprar = Math.max(0, necessario - estoque);
    const duraDias = duracaoDoEstoque(estoque, media);

    /**
     * Rompe antes do prazo = o estoque não atravessa nem a espera. Vale
     * mesmo quando `comprar` é zero por outro motivo, então é avaliado
     * sempre — é a informação que não pode se perder num filtro.
     */
    const rompeAntesDoPrazo = duraDias != null && duraDias < prazo;

    if (comprar <= 0 && !rompeAntesDoPrazo) {
      suficientes++;
      continue;
    }

    itens.push({
      produtoId: p.id,
      nome: p.nome || p.id,
      mediaDiaria: media,
      estoqueTotal: estoque,
      emCasa: Math.max(Number(p.emCasa) || 0, 0),
      duraDias,
      necessario,
      comprar,
      investimento: comprar * (Number(p.custoUnitario) || 0),
      rompeAntesDoPrazo,
      semHistorico: false,
    });
  }

  /**
   * Ordem: quem rompe antes do prazo primeiro (a decisão é outra e é hoje),
   * depois quem dura menos. Empate pelo nome, pra a lista não dançar entre
   * duas leituras da mesma tela.
   */
  itens.sort((a, b) => {
    if (a.rompeAntesDoPrazo !== b.rompeAntesDoPrazo) return a.rompeAntesDoPrazo ? -1 : 1;
    const da = a.duraDias ?? Number.POSITIVE_INFINITY;
    const db = b.duraDias ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.nome.localeCompare(b.nome);
  });

  return {
    itens,
    urgentes: itens.filter((i) => i.rompeAntesDoPrazo),
    suficientes,
    semHistorico,
    totalUnidades: itens.reduce((s, i) => s + i.comprar, 0),
    totalInvestimento: itens.reduce((s, i) => s + i.investimento, 0),
    diasACobrir,
  };
}
