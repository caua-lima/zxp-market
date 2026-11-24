import type { CustoFaixa, EstoqueMovimento } from "@/lib/domain/types";
import { chaveDoGrupo, type ProdutoComGrupo } from "@/lib/domain/grupo-produto";
import { reconstruirCusto } from "@/lib/domain/custo-medio";

/**
 * UM SABOR, UM CUSTO MÉDIO (pedido do dono, 23/11/2026).
 *
 * O produto do Full e o cadastro "… Agências" do mesmo sabor são a MESMA
 * mercadoria em dois anúncios. Cada um tinha o seu livro e, portanto, a sua
 * média: a compra do Trot's de 22/11 entrou só nas Agências, e o Menta Limão
 * ficou R$ 12,94 no Full e R$ 13,05 nas Agências. A margem do Full saía com
 * um custo que não existe mais.
 *
 * Agora o custo é do GRUPO: os dois livros são lidos juntos, numa ordem só, e
 * a média que sai dali vale pros dois cadastros. A quantidade em casa
 * (`qtdLocal`) continua de cada um — só o custo é compartilhado.
 *
 * Transferência ENTRE os membros não entra na conta: é a mesma unidade
 * mudando de cadastro, e no livro juntado ela sairia de um e entraria no
 * outro ao custo do momento — ruído, nunca compra.
 */

export type ProdutoDoCusto = ProdutoComGrupo & { custo?: string | number };

/**
 * Quem divide o custo com `produto`: os ativos do mesmo grupo, desde que o
 * grupo seja o par de sempre (no máximo um por canal). Grupo esquisito — dois
 * do Full, ou produto sem canal — não junta nada: cada um segue sozinho, como
 * era antes, em vez de misturar custos que talvez não sejam do mesmo produto.
 *
 * Devolve sempre o próprio produto primeiro.
 */
export function membrosDoCusto<P extends ProdutoDoCusto>(produto: P, produtos: readonly P[]): P[] {
  const chave = chaveDoGrupo(produto);
  if (chave.startsWith("produto:")) return [produto];
  const outros = produtos.filter((p) => p.id !== produto.id && p.ativo !== false && chaveDoGrupo(p) === chave);
  if (!outros.length) return [produto];
  const todos = [produto, ...outros];
  const canais = todos.map((p) => p.canal);
  if (canais.some((c) => c !== "full" && c !== "agencias")) return [produto];
  if (new Set(canais).size !== canais.length) return [produto];
  return todos;
}

/**
 * O custo antes de qualquer movimentação: o `custo` manual do cadastro do
 * Full (o de Agências nasceu copiando o dele). Sem Full, o do primeiro.
 */
export function custoInicialDoGrupo(membros: readonly ProdutoDoCusto[]): number {
  const base = membros.find((m) => m.canal === "full") ?? membros[0];
  return Number(String(base?.custo ?? "").replace(",", ".")) || 0;
}

/** Os livros juntados, sem as pernas de transferência entre os próprios membros. */
export function livroDoGrupo(movsPorMembro: ReadonlyMap<string, readonly EstoqueMovimento[]>): EstoqueMovimento[] {
  const ids = new Set(movsPorMembro.keys());
  const out: EstoqueMovimento[] = [];
  for (const movs of movsPorMembro.values()) {
    for (const m of movs) {
      if (m.transferenciaCom && ids.has(m.transferenciaCom)) continue;
      out.push(m);
    }
  }
  return out;
}

/**
 * Custo médio e faixas do grupo, e o `qtdLocal` de cada membro (do próprio
 * livro, transferências incluídas — elas mudam ONDE está a unidade).
 */
export function reconstruirCustoDoGrupo(
  movsPorMembro: ReadonlyMap<string, readonly EstoqueMovimento[]>,
  custoInicial = 0,
): { custoMedio: number; faixas: CustoFaixa[]; qtdLocal: Map<string, number> } {
  const { custoMedio, faixas } = reconstruirCusto(livroDoGrupo(movsPorMembro), custoInicial);
  const qtdLocal = new Map<string, number>();
  for (const [id, movs] of movsPorMembro) qtdLocal.set(id, reconstruirCusto([...movs], custoInicial).qtdLocal);
  return { custoMedio, faixas, qtdLocal };
}
