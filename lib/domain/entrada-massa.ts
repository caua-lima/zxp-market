import { estoqueForaDoFull } from "./estoque";

/**
 * Entrada de compra em VÁRIOS produtos de uma vez.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * A compra real quase nunca é de um produto só: chega uma nota com dez itens
 * e cada um precisava de um modal, um cálculo e um salvamento. Dez idas ao
 * banco, dez chances de digitar a data diferente, e nenhuma forma de conferir
 * o total da nota antes de gravar.
 *
 * ─── POR QUE O CÁLCULO MORA AQUI, E NÃO NA TELA ─────────────────────────
 *
 * O custo médio novo é um BLEND: a compra entra contra o estoque que já
 * existe. Essa fórmula já vivia dentro do modal de movimentação, em JSX. Se a
 * entrada em massa reimplementasse o mesmo cálculo, passariam a existir duas
 * definições de custo médio — que é, segundo o próprio histórico desta base,
 * a origem de quase todo número errado que apareceu aqui.
 *
 * Então a fórmula saiu da tela e virou função pura, testável, e as DUAS telas
 * passam a chamar a mesma.
 */

/** O que se sabe do produto no momento da entrada. */
export type ProdutoParaEntrada = {
  id: string;
  nome: string;
  /** Custo médio vigente hoje. */
  custoMedio: number;
  /** Unidades no Full. */
  full: number;
  /** Unidades no galpão. */
  casa: number;
  /** Unidades do anúncio próprio (não-Full). */
  proprio: number;
  /** O produto tem anúncio Full. */
  ehFull: boolean;
};

/** Uma linha digitada pelo usuário. */
export type LinhaEntrada = {
  produtoId: string;
  /** Vazio = linha ignorada; é assim que se pula produto sem apagar a linha. */
  quantidade: number | null;
  custoUnitario: number | null;
};

export type LinhaCalculada = {
  produtoId: string;
  nome: string;
  quantidade: number;
  custoUnitario: number;
  /** quantidade × custo unitário — o que esta linha custou. */
  total: number;
  custoMedioAtual: number;
  /** Custo médio DEPOIS desta entrada. */
  custoMedioNovo: number;
  /** Estoque considerado no blend (Full + fora do Full). */
  estoqueAntes: number;
  /** O custo médio sobe com esta compra — vale destacar, é o que corrói margem. */
  encarece: boolean;
};

export type ResultadoEntradaMassa = {
  linhas: LinhaCalculada[];
  /** Soma de todas as linhas válidas — o valor da nota, pra conferir antes de gravar. */
  totalGeral: number;
  unidadesTotais: number;
  /** Impede o salvamento; cada uma nomeia a linha. */
  erros: string[];
};

/**
 * Custo médio depois de uma compra.
 *
 * Média ponderada entre o que já existe e o que está entrando. Sem estoque
 * anterior, o custo da compra vira o próprio custo médio — não há o que
 * ponderar.
 *
 * É a MESMA fórmula que o modal de movimentação usa (ver MovimentoModal em
 * EstoqueTab); ela mora aqui pra não existirem duas.
 */
export function custoMedioAposEntrada(
  estoqueAtual: number,
  custoMedioAtual: number,
  quantidade: number,
  custoUnitario: number,
): number {
  if (quantidade <= 0) return custoMedioAtual;
  const denominador = estoqueAtual + quantidade;
  if (denominador <= 0) return custoMedioAtual;
  return (estoqueAtual * custoMedioAtual + quantidade * custoUnitario) / denominador;
}

/** O estoque que entra no blend: Full + o que está fora dele. */
export function estoqueParaBlend(p: ProdutoParaEntrada): number {
  return Math.max(p.full, 0) + estoqueForaDoFull(p.casa, p.proprio, p.ehFull);
}

/**
 * Calcula a prévia da entrada em massa.
 *
 * Linha sem quantidade é IGNORADA em silêncio, de propósito: a tela lista
 * todos os produtos e o normal é preencher só alguns. Erro é só o que está
 * preenchido pela metade — aí sim é engano, e precisa aparecer.
 */
export function calcularEntradaMassa(
  produtos: ProdutoParaEntrada[],
  linhas: LinhaEntrada[],
): ResultadoEntradaMassa {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const calculadas: LinhaCalculada[] = [];
  const erros: string[] = [];

  for (const l of linhas) {
    const p = porId.get(l.produtoId);
    const temQtd = l.quantidade != null && l.quantidade !== 0;
    const temCusto = l.custoUnitario != null && l.custoUnitario !== 0;

    // Nada preenchido: o usuário simplesmente não comprou este item.
    if (!temQtd && !temCusto) continue;

    if (!p) { erros.push(`Produto não encontrado (${l.produtoId}).`); continue; }
    const nome = p.nome || p.id;

    if (!temQtd) { erros.push(`${nome}: falta a quantidade.`); continue; }
    if (!temCusto) { erros.push(`${nome}: falta o custo unitário.`); continue; }

    const qtd = Number(l.quantidade);
    const custo = Number(l.custoUnitario);
    if (qtd < 0) { erros.push(`${nome}: entrada não aceita quantidade negativa — use Ajuste pra dar baixa.`); continue; }
    if (custo < 0) { erros.push(`${nome}: custo unitário não pode ser negativo.`); continue; }

    const estoqueAntes = estoqueParaBlend(p);
    const custoMedioNovo = custoMedioAposEntrada(estoqueAntes, p.custoMedio, qtd, custo);

    calculadas.push({
      produtoId: p.id,
      nome,
      quantidade: qtd,
      custoUnitario: custo,
      total: qtd * custo,
      custoMedioAtual: p.custoMedio,
      custoMedioNovo,
      estoqueAntes,
      // Só é "encarecimento" se havia custo antes; produto novo não encarece.
      encarece: p.custoMedio > 0 && custoMedioNovo > p.custoMedio + 0.0001,
    });
  }

  /**
   * O mesmo produto duas vezes somaria errado: cada linha blendaria contra o
   * estoque de ANTES, ignorando a linha anterior. Barrar é mais honesto que
   * calcular um número que não corresponde a nada.
   */
  const contagem = new Map<string, number>();
  for (const c of calculadas) contagem.set(c.produtoId, (contagem.get(c.produtoId) ?? 0) + 1);
  for (const [id, n] of contagem) {
    if (n > 1) erros.push(`${porId.get(id)?.nome ?? id}: aparece em ${n} linhas — junte numa só.`);
  }

  return {
    linhas: calculadas,
    totalGeral: calculadas.reduce((s, c) => s + c.total, 0),
    unidadesTotais: calculadas.reduce((s, c) => s + c.quantidade, 0),
    erros,
  };
}
