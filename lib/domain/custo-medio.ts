import type { CustoFaixa, EstoqueMovimento } from "@/lib/domain/types";
import { CUSTO_FAIXA_SENTINELA } from "@/lib/domain/types";

/**
 * O custo médio recalculado a partir do LIVRO, sempre.
 *
 * ─── O BUG QUE ISTO CORRIGE ─────────────────────────────────────────────
 *
 * `updateMovimento` documentava, em português claro:
 *
 *   "Não precisa recalcular o custo médio à mão: recomputeProduto varre
 *    TODAS as movimentações do produto de novo, então corrigir uma entrada
 *    antiga conserta a média sozinho."
 *
 * Falso. `recomputeProduto` recebia `custoMedio` como `undefined`, e o corpo
 * dela começava com:
 *
 *   if (custoMedio != null && Number.isFinite(custoMedio)) { ...custo... }
 *
 * Com `undefined`, o bloco inteiro do custo era PULADO. Ela varria as
 * movimentações, sim — mas só pra somar QUANTIDADE. O custo médio ficava onde
 * estava.
 *
 * Reproduzido na auditoria: entrada corrigida de R$ 10 pra R$ 20, custo médio
 * parado em R$ 10. Excluir uma entrada deixava a média como se ela ainda
 * existisse. E como o custo médio vira CMV em todo pedido do produto, o erro
 * não fica no estoque: sai na margem, na DRE e no lucro por anúncio.
 *
 * ─── POR QUE NÃO DÁ PRA CONTAR SÓ O LIVRO ───────────────────────────────
 *
 * A tentação é somar as entradas e dividir. Não funciona, por uma razão que
 * precisa ficar escrita: **venda não é movimentação**. O livro registra
 * entrada, saída pro Full, saldo inicial e ajuste — e nada mais. As unidades
 * que saem vendidas somem do estoque sem deixar linha nenhuma aqui.
 *
 * Então a quantidade derivada do livro NÃO é o estoque que existia quando
 * cada entrada foi feita: ela é sempre maior. Usá-la como denominador do
 * blend dá peso demais às compras antigas e deixa a média grudada no passado.
 *
 * Por isso cada movimento guarda o `estoqueAntes` — quanto havia de fato no
 * instante em que ele foi lançado, somando Full e o que está fora dele. É esse
 * número que entra na mistura, e é ele que torna o recálculo fiel.
 *
 * ─── A POLÍTICA ─────────────────────────────────────────────────────────
 *
 * Média móvel ponderada, reexecutada do zero a cada mudança. Reexecutar é o
 * que torna correção e exclusão corretas por construção: não sobra estado
 * acumulado pra ficar defasado.
 *
 *   saldo_inicial  custeia as unidades que já estão no Full. Mistura contra o
 *                  estoque que está FORA do Full (o `estoqueAntes` gravado) —
 *                  sem nada fora, o custo informado vira a própria média. É a
 *                  mesma regra que a tela já descrevia; antes ele
 *                  SOBRESCREVIA a média, o que errava quando já havia estoque
 *                  em casa com custo.
 *
 *   entrada        mistura contra o estoque que havia:
 *                    novo = (estoqueAntes × médiaCorrente + q × custoUnit)
 *                           / (estoqueAntes + q)
 *                  Sem estoque anterior, a média passa a ser o custo da
 *                  entrada. Entrada SEM custo informado não mexe na média —
 *                  não se sabe por quanto entrou, e chutar zero derrubaria o
 *                  CMV de todo o estoque.
 *
 *   saida_full     é TRANSFERÊNCIA, não venda: as unidades continuam nossas,
 *                  só mudam de lugar. Sai pela média, e saída pela média não
 *                  move a média.
 *
 *   ajuste         quantidade com sinal. Positivo COM custo mistura como
 *                  entrada; positivo SEM custo entra pela média vigente.
 *                  Negativo sai pela média. Nenhum dos dois sem custo move a
 *                  média.
 *
 * Note que a média corrente usada na mistura é a que o replay acumulou, NÃO o
 * `custoMedioAntes` que o movimento gravou: depois de corrigir um movimento
 * antigo, o valor gravado nos posteriores está velho, e é justamente isso que
 * precisa ser refeito.
 *
 * ─── ORDEM ──────────────────────────────────────────────────────────────
 *
 * Por data, e dentro do mesmo dia por `createdAt` e depois por `id`. O
 * desempate importa: sem ele, dois lançamentos do mesmo dia podiam ser
 * aplicados em ordens diferentes a cada recálculo e produzir médias diferentes
 * pro MESMO livro — um número que muda sozinho ao recarregar a tela.
 */

export type EstadoCusto = {
  /** Estoque no galpão, segundo o livro. Mesma conta de sempre. */
  qtdLocal: number;
  /** Custo médio corrente. */
  custoMedio: number;
  /** As faixas de vigência, uma por data em que a média mudou. */
  faixas: CustoFaixa[];
  /**
   * Quantos movimentos entraram no blend sem `estoqueAntes` gravado. São os
   * anteriores a este campo existir: neles o denominador é aproximado pelo
   * acumulado do livro, que ignora as vendas e por isso é grande demais.
   * Exposto pra a tela poder dizer que a média daquele produto é aproximada
   * em vez de apresentá-la como exata.
   */
  movimentosSemEstoqueAntes: number;
};

/**
 * Ordena o livro de forma determinística.
 *
 * Exportada porque a ordem é parte da política, não um detalhe: quem quiser
 * conferir "por que essa média" precisa ver o livro na mesma ordem.
 */
export function ordenarMovimentos(movs: EstoqueMovimento[]): EstoqueMovimento[] {
  return [...(movs ?? [])].sort((a, b) => {
    const da = String(a?.data ?? "").slice(0, 10);
    const db = String(b?.data ?? "").slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    const ca = Number(a?.createdAt ?? 0);
    const cb = Number(b?.createdAt ?? 0);
    if (ca !== cb) return ca - cb;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round4(n: number): number {
  return Math.round((num(n) + Number.EPSILON) * 10000) / 10000;
}

/** A mistura ponderada, num lugar só — é ela que define o que "média" quer dizer. */
export function misturar(
  estoqueAntes: number,
  mediaAntes: number,
  quantidade: number,
  custoUnit: number,
): number {
  const base = Math.max(num(estoqueAntes), 0);
  const q = num(quantidade);
  if (q <= 0) return num(mediaAntes);
  if (base <= 0) return num(custoUnit);
  return (base * num(mediaAntes) + q * num(custoUnit)) / (base + q);
}

/**
 * Reconstrói estoque local, custo médio e faixas a partir do livro.
 *
 * @param custoInicial custo conhecido antes de qualquer movimentação — o
 *   `custo` manual do cadastro. Vira a faixa sentinela, pra um pedido anterior
 *   à primeira movimentação sempre encontrar alguma faixa aplicável.
 */
export function reconstruirCusto(
  movs: EstoqueMovimento[],
  custoInicial = 0,
): EstadoCusto {
  const ordenados = ordenarMovimentos(movs);

  let qtdLocal = 0;
  let custoMedio = num(custoInicial);
  let semEstoqueAntes = 0;

  /**
   * Aproximação usada só quando o movimento não gravou `estoqueAntes`. É o
   * acumulado do próprio livro — grande demais, porque venda não aparece aqui.
   * Melhor que zero (que faria toda entrada redefinir a média do nada), e
   * contado em `movimentosSemEstoqueAntes` pra não passar por exato.
   */
  let acumuladoDoLivro = 0;

  const faixas: CustoFaixa[] = [{ desde: CUSTO_FAIXA_SENTINELA, custo: round4(custoMedio) }];

  const registrar = (dia: unknown) => {
    const d = String(dia ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const valor = round4(custoMedio);
    const idx = faixas.findIndex((f) => f.desde === d);
    // Vários movimentos no mesmo dia colapsam numa faixa só: o que vale pro
    // dia é a média DEPOIS de todos eles. Estados intermediários criariam
    // faixas que nenhuma venda jamais consulta.
    if (idx >= 0) faixas[idx] = { desde: d, custo: valor };
    else faixas.push({ desde: d, custo: valor });
  };

  const baseDoBlend = (m: EstoqueMovimento): number => {
    const gravado = (m as { estoqueAntes?: unknown }).estoqueAntes;
    if (gravado != null && Number.isFinite(Number(gravado))) return Math.max(Number(gravado), 0);
    semEstoqueAntes += 1;
    return Math.max(acumuladoDoLivro, 0);
  };

  for (const m of ordenados) {
    const q = num(m?.quantidade);
    const custoUnit = m?.custoUnit == null ? null : num(m.custoUnit);

    if (m?.tipo === "saldo_inicial") {
      /**
       * Custeia as unidades que já estão no Full, misturando contra o que
       * está FORA dele — que é o `estoqueAntes` gravado neste movimento.
       *
       * A quantidade não entra em `qtdLocal` porque saldo inicial descreve
       * estoque que já está fora do galpão — mesma regra que o cálculo de
       * qtdLocal sempre usou. Mas entra no acumulado: são unidades nossas e
       * contam na mistura seguinte.
       */
      const entrando = Math.abs(q);
      if (custoUnit != null && custoUnit > 0 && entrando > 0) {
        custoMedio = misturar(baseDoBlend(m), custoMedio, entrando, custoUnit);
        registrar(m.data);
      }
      acumuladoDoLivro += entrando;
      continue;
    }

    if (m?.tipo === "entrada") {
      const entrando = Math.abs(q);
      if (entrando <= 0) continue;
      if (custoUnit != null && custoUnit > 0) {
        custoMedio = misturar(baseDoBlend(m), custoMedio, entrando, custoUnit);
        registrar(m.data);
      }
      qtdLocal += entrando;
      acumuladoDoLivro += entrando;
      continue;
    }

    if (m?.tipo === "saida_full") {
      // Transferência: as unidades continuam nossas, só mudam de lugar. Sai do
      // galpão, mas não sai do total — e saída pela média não move a média.
      qtdLocal -= Math.abs(q);
      continue;
    }

    // ajuste: quantidade com sinal.
    if (q > 0 && custoUnit != null && custoUnit > 0) {
      custoMedio = misturar(baseDoBlend(m), custoMedio, q, custoUnit);
      registrar(m.data);
    }
    qtdLocal += q;
    acumuladoDoLivro += q;
  }

  return {
    qtdLocal,
    custoMedio: round4(custoMedio),
    faixas,
    movimentosSemEstoqueAntes: semEstoqueAntes,
  };
}

/**
 * Quais faixas MUDARAM entre o estado gravado e o reconstruído.
 *
 * Existe por causa de "não reescreva períodos fechados silenciosamente":
 * corrigir uma entrada de meses atrás muda o custo que valia naquela época e,
 * com ele, a margem de vendas já apuradas. Às vezes é exatamente o que se
 * quer — mas quem corrigiu precisa saber que aconteceu.
 */
export function faixasAlteradas(
  antes: CustoFaixa[] | undefined,
  depois: CustoFaixa[],
): { desde: string; de: number; para: number }[] {
  const anterior = new Map((antes ?? []).map((f) => [f.desde, f.custo]));
  const mudancas: { desde: string; de: number; para: number }[] = [];

  for (const f of depois) {
    const antigo = anterior.get(f.desde);
    if (antigo == null) {
      if (f.desde !== CUSTO_FAIXA_SENTINELA) mudancas.push({ desde: f.desde, de: 0, para: f.custo });
      continue;
    }
    if (round4(antigo) !== round4(f.custo)) {
      mudancas.push({ desde: f.desde, de: antigo, para: f.custo });
    }
  }

  // Faixas que sumiram (o movimento que as criou foi excluído) também contam.
  const agora = new Set(depois.map((f) => f.desde));
  for (const [desde, custo] of anterior) {
    if (!agora.has(desde)) mudancas.push({ desde, de: custo, para: 0 });
  }

  return mudancas.sort((a, b) => a.desde.localeCompare(b.desde));
}
