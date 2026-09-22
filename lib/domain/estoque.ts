import { mediaDiariaAjustada } from "@/lib/domain/reposicao";

// Helpers puros de cobertura/reposição de estoque — Fase 5. Não mexem no
// livro de movimentações nem no custo médio ponderado (isso continua
// intacto em lib/firebase/data.ts); só decidem como LER o que já existe:
// estoque disponível (já calculado) e vendas de um período (já buscadas via
// /api/ml/estoque-forecast).

/**
 * Cobertura em dias = estoque disponível ÷ média de vendas por dia.
 * `null` (não 0, não Infinity) quando não há giro suficiente pra confiar
 * numa previsão — sem venda no período, qualquer número aqui seria
 * inventado, não calculado.
 */
/**
 * Quantos dias o estoque cobre, no ritmo medido.
 *
 * @param diasAtivos dias em que o produto esteve DE FATO à venda na janela.
 *
 * ─── POR QUE ESTE PARÂMETRO PRECISOU EXISTIR ────────────────────────────
 *
 * A rota /api/ml/estoque-forecast já calculava `diasAtivos`, e a aba Estoque
 * já o usava (via mediaDiariaAjustada). Mas o Dashboard fazia:
 *
 *   setEstoqueForecast({ vendas: j.vendas ?? {}, dias: j.dias ?? 30 })
 *
 * — lia `vendas` e `dias` e DESCARTAVA `diasAtivos`. Então "Produtos em
 * risco", na tela inicial, dividia as vendas pela janela CHEIA enquanto a aba
 * Estoque dividia pelos dias em que o anúncio esteve no ar.
 *
 * Dividir pela janela cheia dá um ritmo MENOR, logo uma cobertura MAIOR: o
 * painel que existe pra alertar era o que subestimava o risco. Um produto
 * pausado metade do mês vende o dobro por dia ativo do que a divisão simples
 * sugere.
 */
export function calculateStockCoverage(
  estoqueDisponivel: number,
  vendasNoPeriodo: number,
  diasNoPeriodo: number,
  diasAtivos?: number | null,
): number | null {
  if (diasNoPeriodo <= 0 || vendasNoPeriodo <= 0) return null;
  const mediaDiaria = mediaDiariaAjustada(vendasNoPeriodo, diasNoPeriodo, diasAtivos);
  if (mediaDiaria <= 0) return null;
  return estoqueDisponivel / mediaDiaria;
}

export type CoverageStatus = "critico" | "repor" | "saudavel" | "encalhado" | "sem-giro";

/**
 * Classifica a cobertura em faixas de decisão. `sem-giro` é diferente de
 * `encalhado`: sem-giro = não temos como calcular (produto novo, sem venda
 * no período); encalhado = temos estoque parado E confirmamos que não há
 * giro (vendasNoPeriodo === 0 mas tem estoque > 0).
 */
export function getCoverageStatus(
  coberturaDias: number | null,
  estoqueDisponivel: number,
  vendasNoPeriodo: number,
): CoverageStatus {
  /**
   * Zerado com giro CONFIRMADO no período é ruptura AGORA, não "sem giro
   * suficiente". `coberturaDias` chega `null` aqui porque dividir pelo
   * estoque zero não dá um número de dias — mas a pergunta que importa (tem
   * estoque? houve venda recente?) já está respondida. Achado S16 da
   * auditoria SaaS, visto ao vivo: um produto zerado com vendas recentes
   * mostrava "Comprar" no painel de Reposição e "Sem giro suficiente" no de
   * Previsão — os dois lendo o mesmo dado, dizendo coisas opostas.
   */
  if (estoqueDisponivel <= 0 && vendasNoPeriodo > 0) return "critico";
  if (coberturaDias == null) {
    return estoqueDisponivel > 0 && vendasNoPeriodo === 0 ? "encalhado" : "sem-giro";
  }
  if (estoqueDisponivel <= 0) return "critico";
  if (coberturaDias < 7) return "critico";
  if (coberturaDias < 15) return "repor";
  return "saudavel";
}

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  critico: "Crítico",
  repor: "Repor",
  saudavel: "Saudável",
  encalhado: "Encalhado",
  "sem-giro": "Sem giro suficiente",
};

// ── Consolidação de estoque entre anúncios ───────────────────────
//
// Um produto costuma ter VÁRIOS anúncios (MLB) apontando pro mesmo estoque
// físico. Contar cada anúncio como se fosse um pool separado infla o total —
// já aconteceu duas vezes aqui, por dois caminhos diferentes, e é o motivo
// desta parte ser pura e testada em vez de solta no componente.
//
// As duas armadilhas, ambas reportadas com número na mão:
//
// 1. DOIS ANÚNCIOS FULL, UM ESTOQUE SÓ. O Mercado Livre permite mais de um
//    anúncio compartilhando o MESMO pool no centro de distribuição — os dois
//    respondem `available_quantity` com o valor do pool inteiro, não com uma
//    fatia. Somar dava exatamente o dobro: 148 un reais viravam 296 no painel;
//    93 viravam 186. O que separa um pool do outro é o `inventory_id`, então é
//    por ele que se deduplica (e não pelo MLB, que é o anúncio, não o estoque).
//
// 2. "EM CASA" E "AGÊNCIA" SÃO O MESMO ESTOQUE. O anúncio próprio (fora do
//    Full) vende do que está no galpão — o que ele mostra como disponível é
//    uma FATIA do que o livro de movimentações já contabiliza, não um estoque
//    adicional. Somar contava a mesma unidade duas vezes.
//
// 3. DOIS ANÚNCIOS PRÓPRIOS, UM GALPÃO SÓ. Fora do Full não existe
//    `inventory_id` pra deduplicar: o anúncio não reserva estoque, ele só
//    DECLARA quantas unidades aceita vender do monte que está em casa. É
//    prática normal anunciar as mesmas 18 unidades em dois anúncios (18 e 18)
//    em vez de partir 9 e 9 e perder venda nos dois. Somar dava 36 unidades
//    que nunca existiram.
//    Por isso o próprio entra pelo MAIOR declarado, não pela soma: com 18 e
//    18, o galpão tem 18; com 18 e 10, tem pelo menos 18. É o piso confiável
//    do monte físico, e errar pra baixo aqui é muito melhor que prometer
//    estoque inexistente.
//
// A regra que sai disso: cada pool físico entra no total UMA vez.

export type AnuncioEstoque = {
  /** Disponível que o anúncio reporta. */
  available: number;
  /** `shipping.logistic_type` do ML — "fulfillment" é Full. */
  logistic: string;
  /**
   * Pool de estoque no Full. Dois anúncios com o mesmo `inventoryId`
   * dividem as MESMAS unidades. Ausente/vazio = sem como saber, e aí cada
   * anúncio conta por si (não deduplica no escuro).
   */
  inventoryId?: string;
};

export type EstoqueConsolidado = {
  /** Unidades no Full, cada pool contado uma vez. */
  full: number;
  /** Disponível somado dos anúncios FORA do Full. */
  proprio: number;
  ehFull: boolean;
  /** O ML já respondeu sobre pelo menos um anúncio. */
  temDado: boolean;
  /** true quando 2+ anúncios Full dividiam um pool — serve pra explicar o número na tela. */
  fullCompartilhado: boolean;
  /**
   * true quando 2+ anúncios FORA do Full declaram estoque — eles vendem do
   * mesmo galpão, então o total usa o maior em vez da soma. Serve pra tela
   * explicar por que 18+18 aparece como 18.
   */
  proprioCompartilhado: boolean;
};

export function ehFullLogistic(logistic: string): boolean {
  return logistic === "fulfillment";
}

export function consolidarEstoqueAnuncios(anuncios: AnuncioEstoque[]): EstoqueConsolidado {
  let full = 0;
  let proprio = 0;
  let ehFull = false;
  let temDado = false;
  let fullCompartilhado = false;
  let anunciosProprios = 0;
  const poolsContados = new Set<string>();

  for (const a of anuncios) {
    temDado = true;
    if (!ehFullLogistic(a.logistic)) {
      /**
       * MAIOR, não soma: os anúncios próprios vendem do mesmo galpão e cada um
       * só declara quanto aceita vender dele (ver armadilha 3 acima).
       */
      anunciosProprios += 1;
      proprio = Math.max(proprio, a.available);
      continue;
    }
    ehFull = true;
    const pool = String(a.inventoryId ?? "").trim();
    if (pool) {
      // Mesmo pool já somado: este anúncio é outra vitrine do mesmo estoque.
      if (poolsContados.has(pool)) { fullCompartilhado = true; continue; }
      poolsContados.add(pool);
    }
    full += a.available;
  }

  return { full, proprio, ehFull, temDado, fullCompartilhado, proprioCompartilhado: anunciosProprios > 1 };
}

/**
 * Estoque físico FORA do Full, contado uma vez só.
 *
 * COM Full: o livro (`casa`) é a fonte — ele registra entrada e saída pro
 * Full. O anúncio próprio expõe parte desse mesmo galpão, então NÃO soma.
 *
 * SEM Full: o livro não serve, porque venda não é movimentação registrada —
 * ele só sobe e nunca desce sozinho. Aí o número do anúncio, que o ML
 * atualiza a cada venda, é o único que reflete o saldo real.
 */
export function estoqueForaDoFull(casa: number, proprio: number, ehFull: boolean): number {
  return ehFull ? Math.max(casa, 0) : proprio;
}

/**
 * Sugestão de quantidade a comprar pra cobrir `diasAlvo` de venda, dado o
 * que já está disponível. Transparente por design: quem chama pode mostrar
 * a mesma conta (mediaDiaria × diasAlvo − disponível) e o usuário pode
 * editar a sugestão manualmente — isso não é feito aqui, é decisão de UI.
 */
export function calculateReorderSuggestion(
  estoqueDisponivel: number,
  vendasNoPeriodo: number,
  diasNoPeriodo: number,
  diasAlvo: number,
): number {
  if (diasNoPeriodo <= 0 || vendasNoPeriodo <= 0 || diasAlvo <= 0) return 0;
  const mediaDiaria = vendasNoPeriodo / diasNoPeriodo;
  return Math.max(0, Math.ceil(mediaDiaria * diasAlvo) - estoqueDisponivel);
}
