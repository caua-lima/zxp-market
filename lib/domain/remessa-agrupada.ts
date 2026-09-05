import { movIdRemessa } from "./remessas";

/**
 * As baixas do Full agrupadas por REMESSA, como o painel do Mercado Livre.
 *
 * ─── POR QUE AGRUPAR ────────────────────────────────────────────────────
 *
 * Uma remessa vira uma linha por produto no histórico. Um envio com quatro
 * produtos aparece como quatro lançamentos soltos, todos com a mesma data e
 * a mesma observação repetida — e conferir contra o painel do ML, que mostra
 * "#75664648 · 260 un · processamento finalizado", exige somar de cabeça.
 *
 * Agrupado, a conferência vira comparação direta: um envio de cada lado, com
 * o mesmo total.
 *
 * ─── A CHAVE VEM DO ID, NÃO DO TEXTO ────────────────────────────────────
 *
 * O `obs` traz "Remessa Full #75664648 · ...", mas texto livre muda: quem
 * edita a observação quebraria o agrupamento sem perceber. O ID é
 * `full-{remessa}-{produto}` por construção (ver movIdRemessa), então ele é
 * a fonte estável — e um id que não siga o padrão simplesmente não pertence
 * a remessa nenhuma.
 */

/** Movimento no formato mínimo que o agrupamento precisa. */
export type MovimentoParaAgrupar = {
  id: string;
  productId: string;
  tipo: string;
  quantidade: number;
  data: string;
  obs?: string;
  createdAt?: number;
};

export type ProdutoDaRemessa = {
  movimentoId: string;
  produtoId: string;
  nome: string;
  /** Unidades baixadas, sempre positivo — o sinal é do tipo, não do número. */
  unidades: number;
};

export type RemessaAgrupada = {
  /** Número do envio no ML. */
  remessa: string;
  /** Data da baixa — a mais antiga do grupo, que é quando a remessa entrou. */
  data: string;
  /** Soma das unidades de todos os produtos do envio. */
  totalUnidades: number;
  produtos: ProdutoDaRemessa[];
  /** Foi lançada pela baixa automática (removida) — aparece no histórico antigo. */
  automatica: boolean;
};

/**
 * Extrai o número da remessa de um id `full-{remessa}-{produto}`.
 *
 * Devolve `null` pra qualquer id fora do padrão — movimento avulso, entrada
 * de compra, ajuste. Confirma reconstruindo o id: assim um produto cujo
 * próprio id contenha hífen não bagunça a separação.
 */
export function remessaDoMovimento(id: string, productId: string): string | null {
  const s = String(id ?? "");
  if (!s.startsWith("full-")) return null;
  const semPrefixo = s.slice("full-".length);
  const sufixo = `-${productId}`;
  if (!productId || !semPrefixo.endsWith(sufixo)) return null;
  const remessa = semPrefixo.slice(0, semPrefixo.length - sufixo.length);
  if (!remessa) return null;
  // Reconstrói: se não bater exatamente, o id não é do formato esperado.
  return movIdRemessa(remessa, productId) === s ? remessa : null;
}

/**
 * Agrupa as baixas de Full por remessa.
 *
 * Movimentos que não pertencem a nenhuma remessa saem em `avulsos`, e não
 * são descartados: eles continuam precisando de conferência e correção, só
 * não têm envio a que se comparar.
 */
export function agruparBaixasPorRemessa(
  movimentos: MovimentoParaAgrupar[],
  nomePorProduto: ReadonlyMap<string, string>,
): { remessas: RemessaAgrupada[]; avulsos: MovimentoParaAgrupar[] } {
  const porRemessa = new Map<string, RemessaAgrupada>();
  const avulsos: MovimentoParaAgrupar[] = [];

  for (const m of movimentos) {
    if (m.tipo !== "saida_full") { avulsos.push(m); continue; }

    const remessa = remessaDoMovimento(m.id, m.productId);
    if (!remessa) { avulsos.push(m); continue; }

    const grupo = porRemessa.get(remessa) ?? {
      remessa,
      data: m.data ?? "",
      totalUnidades: 0,
      produtos: [],
      automatica: false,
    };

    grupo.produtos.push({
      movimentoId: m.id,
      produtoId: m.productId,
      nome: nomePorProduto.get(m.productId) ?? m.productId,
      // Baixa é saída: o valor guardado é positivo e o sinal vem do tipo.
      unidades: Math.abs(Number(m.quantidade) || 0),
    });
    grupo.totalUnidades += Math.abs(Number(m.quantidade) || 0);
    // A data do grupo é a MAIS ANTIGA: é quando a remessa começou a ser
    // lançada. Correções posteriores não devem mover o envio na linha do tempo.
    if (m.data && (!grupo.data || m.data < grupo.data)) grupo.data = m.data;
    if (String(m.obs ?? "").toLowerCase().includes("automática")) grupo.automatica = true;

    porRemessa.set(remessa, grupo);
  }

  for (const g of porRemessa.values()) {
    g.produtos.sort((a, b) => b.unidades - a.unidades || a.nome.localeCompare(b.nome));
  }

  const remessas = [...porRemessa.values()].sort(
    (a, b) => (b.data ?? "").localeCompare(a.data ?? "") || a.remessa.localeCompare(b.remessa),
  );

  return { remessas, avulsos };
}
