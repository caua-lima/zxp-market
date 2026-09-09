/**
 * A DRE virada em APRESENTAÇÃO — o que se manda pro sócio.
 *
 * ─── POR QUE NÃO É A MESMA COISA QUE A TABELA ───────────────────────────
 *
 * A tela de DRE responde "quanto deu cada linha". Quem não operou o mês faz
 * outra pergunta primeiro: "foi bom ou ruim, e por quê?". Uma tabela de 15
 * linhas responde a primeira e esconde a segunda — quem lê tem que fazer as
 * contas de cabeça pra descobrir onde o dinheiro ficou.
 *
 * Este módulo faz essas contas. Duas saídas:
 *
 *   · a CASCATA — de cada real de receita, quanto cada custo levou embora e
 *     quanto sobrou. É a figura que explica o mês inteiro num olhar.
 *   · a LEITURA — as frases que um sócio esperaria ouvir numa reunião:
 *     o maior custo, o que mudou desde o mês passado, a margem.
 *
 * Puro de propósito: é o número que vai num PDF assinado pelos dois sócios.
 * Precisa ser testável sem subir tela nenhuma.
 */

export type DespesaNomeada = { nome: string; valor: number };

export type DadosDre = {
  pedidos: number;
  receitaBruta: number;
  canceladas: number;
  receitaLiquida: number;
  taxasML: number;
  frete: number;
  receitaOperacional: number;
  cmv: number;
  lucroBruto: number;
  imposto: number;
  ads: number;
  despesasOperacionais: number;
  resultadoOperacional: number;
  despesasEmpresa: DespesaNomeada[];
  coletaFull: number;
  resultadoLiquido: number;
};

export type BlocoCascata = {
  id: string;
  rotulo: string;
  /** Sempre positivo. O `tipo` diz se soma ou subtrai. */
  valor: number;
  tipo: "abertura" | "saida" | "fechamento";
  /** Quanto havia antes deste bloco — a base da barra flutuante. */
  antes: number;
  /** Quanto restou depois dele — o topo da barra. */
  depois: number;
  /** Peso sobre a receita líquida, em %. É o que se compara entre meses. */
  pctDaReceita: number;
};

const centavo = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A cascata da receita líquida até o resultado líquido.
 *
 * ─── POR QUE COMEÇA NA LÍQUIDA, E NÃO NA BRUTA ──────────────────────────
 *
 * Cancelamento e devolução não são custo: são venda que não aconteceu.
 * Colocá-los como a primeira barra faria parecer que a operação "gastou" com
 * isso, e o sócio leria um custo onde há uma não-receita. A bruta aparece na
 * apresentação como contexto, fora da cascata.
 */
export function montarCascata(d: DadosDre): BlocoCascata[] {
  const receita = centavo(d.receitaLiquida);
  const saidas: { id: string; rotulo: string; valor: number }[] = [
    { id: "taxas", rotulo: "Taxas do Mercado Livre", valor: d.taxasML },
    { id: "frete", rotulo: "Frete", valor: d.frete },
    { id: "cmv", rotulo: "Custo da mercadoria", valor: d.cmv },
    { id: "imposto", rotulo: "Impostos sobre vendas", valor: d.imposto },
    { id: "ads", rotulo: "Marketing (ADS)", valor: d.ads },
    { id: "operacionais", rotulo: "Despesas operacionais", valor: d.despesasOperacionais },
    {
      id: "empresa",
      rotulo: "Despesas da empresa",
      valor: (d.despesasEmpresa ?? []).reduce((s, x) => s + (Number(x.valor) || 0), 0),
    },
    { id: "coleta", rotulo: "Coleta pro Full", valor: d.coletaFull },
  ];

  const blocos: BlocoCascata[] = [{
    id: "receita",
    rotulo: "Receita líquida",
    valor: receita,
    tipo: "abertura",
    antes: 0,
    depois: receita,
    pctDaReceita: 100,
  }];

  let acumulado = receita;
  for (const s of saidas) {
    const valor = centavo(Math.max(0, Number(s.valor) || 0));
    // Custo zerado não vira barra: uma barra de altura zero só ocupa espaço e
    // sugere que a linha existe e não custou nada, o que raramente é o caso —
    // quase sempre é dado que não veio.
    if (valor === 0) continue;
    const antes = acumulado;
    acumulado = centavo(acumulado - valor);
    blocos.push({
      id: s.id,
      rotulo: s.rotulo,
      valor,
      tipo: "saida",
      antes,
      depois: acumulado,
      pctDaReceita: receita ? (valor / receita) * 100 : 0,
    });
  }

  const resultado = centavo(d.resultadoLiquido);
  blocos.push({
    id: "resultado",
    rotulo: "Resultado líquido",
    valor: resultado,
    tipo: "fechamento",
    antes: 0,
    depois: resultado,
    pctDaReceita: receita ? (resultado / receita) * 100 : 0,
  });

  return blocos;
}

/**
 * O quanto a cascata NÃO fecha, em reais.
 *
 * Receita menos todas as saídas deveria dar exatamente o resultado líquido.
 * Se não der, há linha faltando ou contada duas vezes — e a apresentação
 * precisa dizer isso em vez de desenhar uma figura bonita e errada. Este é o
 * mesmo cuidado que já existe no resto da base: número que não fecha é
 * mostrado como não fechando.
 */
export function residuoDaCascata(blocos: BlocoCascata[]): number {
  const abertura = blocos.find((b) => b.tipo === "abertura")?.valor ?? 0;
  const saidas = blocos.filter((b) => b.tipo === "saida").reduce((s, b) => s + b.valor, 0);
  const fechamento = blocos.find((b) => b.tipo === "fechamento")?.valor ?? 0;
  return centavo(abertura - saidas - fechamento);
}

export type Destaque = {
  id: string;
  titulo: string;
  texto: string;
  tom: "bom" | "ruim" | "neutro";
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const pct = (n: number, casas = 1) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/**
 * As frases que um sócio esperaria ouvir numa reunião de fechamento.
 *
 * ─── POR QUE FRASE, E NÃO MAIS UM NÚMERO ────────────────────────────────
 *
 * "Margem líquida 7,2%" não diz se é bom. "7,2% — de cada R$ 100 vendidos,
 * R$ 7,20 sobraram" diz, e a comparação com o mês anterior diz a direção.
 * A apresentação existe pra quem NÃO acompanhou o mês dia a dia.
 *
 * @param anterior mês anterior, quando houver. Sem ele as frases de direção
 *   simplesmente não aparecem — inventar uma comparação seria pior.
 */
export function lerODoMes(d: DadosDre, anterior?: DadosDre | null): Destaque[] {
  const out: Destaque[] = [];
  const receita = d.receitaLiquida;
  const margemLiq = receita ? (d.resultadoLiquido / receita) * 100 : 0;

  // 1. O resultado, em linguagem de sócio.
  out.push({
    id: "resultado",
    titulo: d.resultadoLiquido >= 0 ? "O mês fechou no azul" : "O mês fechou no vermelho",
    texto: d.resultadoLiquido >= 0
      ? `Sobraram ${brl(d.resultadoLiquido)} depois de tudo — de cada R$ 100 vendidos, `
        + `${brl(margemLiq).replace("R$", "").trim()} ficaram na empresa.`
      : `Faltaram ${brl(Math.abs(d.resultadoLiquido))} pra operação se pagar. `
        + `A cada R$ 100 vendidos, ${brl(Math.abs(margemLiq)).replace("R$", "").trim()} saíram do caixa.`,
    tom: d.resultadoLiquido >= 0 ? "bom" : "ruim",
  });

  // 2. Onde o dinheiro foi: o maior custo isolado.
  const cascata = montarCascata(d).filter((b) => b.tipo === "saida");
  const maior = cascata.reduce<BlocoCascata | null>((a, b) => (!a || b.valor > a.valor ? b : a), null);
  if (maior) {
    out.push({
      id: "maior-custo",
      titulo: `${maior.rotulo} é o maior custo`,
      texto: `Levou ${brl(maior.valor)}, ou ${pct(maior.pctDaReceita)} da receita líquida. `
        + `É a linha que mais move o resultado — cada ponto percentual dela vale `
        + `${brl(receita / 100)} no fim do mês.`,
      tom: "neutro",
    });
  }

  // 3. Ticket médio: o número que liga preço a volume.
  if (d.pedidos > 0) {
    const ticket = receita / d.pedidos;
    const ticketAnterior = anterior && anterior.pedidos > 0
      ? anterior.receitaLiquida / anterior.pedidos
      : null;
    const variacao = ticketAnterior ? ((ticket - ticketAnterior) / ticketAnterior) * 100 : null;
    out.push({
      id: "ticket",
      titulo: `Ticket médio de ${brl(ticket)}`,
      texto: `${d.pedidos.toLocaleString("pt-BR")} pedidos no período.`
        + (variacao == null
          ? ""
          : ` ${variacao >= 0 ? "Subiu" : "Caiu"} ${pct(Math.abs(variacao))} contra o período anterior `
            + `(${brl(ticketAnterior!)}).`),
      tom: variacao == null ? "neutro" : variacao >= 0 ? "bom" : "ruim",
    });
  }

  // 4. A direção do resultado — só existe com um mês anterior pra comparar.
  if (anterior) {
    const antes = anterior.resultadoLiquido;
    const delta = d.resultadoLiquido - antes;
    const margemAntes = anterior.receitaLiquida
      ? (antes / anterior.receitaLiquida) * 100
      : 0;
    const deltaMargem = margemLiq - margemAntes;
    out.push({
      id: "direcao",
      titulo: delta >= 0 ? "Melhor que o período anterior" : "Pior que o período anterior",
      texto: `Resultado de ${brl(antes)} para ${brl(d.resultadoLiquido)} `
        + `(${delta >= 0 ? "+" : ""}${brl(delta)}). `
        + `A margem ${deltaMargem >= 0 ? "subiu" : "caiu"} `
        + `${pct(Math.abs(deltaMargem))}, de ${pct(margemAntes)} para ${pct(margemLiq)}.`,
      tom: delta >= 0 ? "bom" : "ruim",
    });

    /**
     * 5. O custo que mais mudou EM PESO, não em reais.
     *
     * Um mês que vende o dobro gasta o dobro em tudo, e uma lista de "subiu
     * X reais" só repetiria o crescimento. O que informa é a linha que passou
     * a comer uma fatia diferente da receita — essa mudou de verdade.
     */
    const pesoAtual = new Map(montarCascata(d).filter((b) => b.tipo === "saida").map((b) => [b.id, b]));
    const pesoAntes = new Map(montarCascata(anterior).filter((b) => b.tipo === "saida").map((b) => [b.id, b]));
    let pior: { bloco: BlocoCascata; delta: number } | null = null;
    for (const [id, bloco] of pesoAtual) {
      const ref = pesoAntes.get(id);
      if (!ref) continue;
      const delta = bloco.pctDaReceita - ref.pctDaReceita;
      if (!pior || Math.abs(delta) > Math.abs(pior.delta)) pior = { bloco, delta };
    }
    // Meio ponto percentual é ruído de arredondamento e de borda de período;
    // abaixo disso não há mudança a relatar.
    if (pior && Math.abs(pior.delta) >= 0.5) {
      const subiu = pior.delta > 0;
      out.push({
        id: "mudou",
        titulo: `${pior.bloco.rotulo} ${subiu ? "pesou mais" : "pesou menos"}`,
        texto: `Passou de ${pct(pior.bloco.pctDaReceita - pior.delta)} para `
          + `${pct(pior.bloco.pctDaReceita)} da receita `
          + `(${subiu ? "+" : ""}${pct(pior.delta)}). `
          + (subiu
            ? `Nos números deste mês, isso vale ${brl((Math.abs(pior.delta) / 100) * receita)} a menos no bolso.`
            : `Nos números deste mês, isso vale ${brl((Math.abs(pior.delta) / 100) * receita)} a mais no bolso.`),
        tom: subiu ? "ruim" : "bom",
      });
    }
  }

  return out;
}
