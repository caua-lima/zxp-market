/**
 * O vocabulário do dinheiro: o que cada número É, e o quanto dele já fechou.
 *
 * ─── O PROBLEMA ──────────────────────────────────────────────────────────
 *
 * O app tinha sete coisas diferentes chamadas quase do mesmo jeito:
 *
 *   · RECEITA              — o que o comprador pagou (bruta) e o que sobrou
 *                            depois de cancelado/devolvido (líquida).
 *   · RESULTADO OPERACIONAL— o que a OPERAÇÃO deixou: receita menos taxa,
 *                            frete, CMV, imposto, Ads e despesa operacional.
 *   · RESULTADO DA EMPRESA — o operacional menos o que é da EMPRESA e não da
 *                            venda: pró-labore, contador, coleta pro Full.
 *   · REPASSE ESTIMADO     — nossa conta do que o ML deveria mandar.
 *   · RECEBIDO             — o que o Mercado Pago de fato liberou.
 *   · PROJEÇÃO             — número calculado sobre período que não terminou.
 *   · PENDÊNCIA            — o que falta pra qualquer um dos de cima fechar.
 *
 * Misturar dois desses é como quase todo número errado nesta base começou.
 *
 * ─── O QUE ISTO NÃO FAZ ──────────────────────────────────────────────────
 *
 * Não inventa classificação contábil. "Retirada do sócio" não vira despesa
 * aqui nem em lugar nenhum: o app não modela conta de sócio, e chutar um
 * lançamento contábil pra ela produziria uma DRE que um contador teria que
 * desfazer. O que existe é o que o app consegue afirmar — o resto é
 * pendência declarada, não linha inventada.
 */

/** Uma coisa que falta pra um número poder ser chamado de fechado. */
export type Pendencia = {
  /** Id estável — testes e CSV se apoiam nele, o texto pode mudar. */
  chave: string;
  /** Uma linha, legível por quem não abriu o código. */
  titulo: string;
  /** O que falta e, sobretudo, PARA QUE LADO o número erra por isso. */
  detalhe: string;
  /**
   * A direção do erro. É o campo mais útil da estrutura: saber que o
   * resultado está OTIMISTA é acionável; saber que "há uma pendência" não é.
   */
  efeito: "otimista" | "pessimista" | "indefinido";
};

/**
 * O quanto do período já pode ser afirmado.
 *
 *   conciliado — tudo que compõe o número está apurado e confere.
 *   parcial    — parte está apurada; o número é PISO ou TETO, não fechamento.
 *   estimado   — calculado com premissas; nenhuma conferência contra dinheiro.
 */
export type EstadoApuracao = "conciliado" | "parcial" | "estimado";

/**
 * Fração do período coberta pela conferência com o dinheiro real.
 *
 * `null` quando não há denominador — e `null` não é zero: "nenhum pedido no
 * período" e "não sei quantos pedidos houve" levam a frases diferentes.
 */
export function coberturaDaConferencia(conferidos: number, total: number): number | null {
  if (!Number.isFinite(conferidos) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(Math.max(conferidos, 0), total) / total;
}

/**
 * A partir de que cobertura a conferência pode falar pelo período inteiro.
 *
 * 90% é um julgamento, e é declarado aqui em vez de embutido numa condição
 * dentro de um componente: abaixo disso, dizer "bate" seria extrapolar de
 * uma amostra para o todo — que é exatamente o que o painel fazia quando
 * comparava 3 pedidos de 464 e concluía que "a margem está confiável".
 */
export const COBERTURA_MINIMA = 0.9;

/**
 * Tolerância da diferença entre nossa conta e o líquido do MP.
 *
 * O maior entre R$ 5 e 1% do líquido: em período pequeno, 1% é centavos e
 * qualquer arredondamento estouraria; em período grande, R$ 5 fixo seria
 * apertado demais pro acúmulo de arredondamento pedido a pedido.
 */
export function toleranciaDaConferencia(real: number): number {
  return Math.max(5, Math.abs(real) * 0.01);
}

export type ConferenciaMP = {
  /** Pedidos com repasse já liberado pelo Mercado Pago. */
  conferidos: number;
  /** Pedidos do período — o denominador. */
  total: number;
  /** Nossa conta do repasse: total − taxa ML − frete. */
  estimado: number;
  /** O que o MP de fato liberou (net_received_amount). */
  recebido: number;
};

export type LeituraDaConferencia = {
  estado: EstadoApuracao;
  cobertura: number | null;
  /** estimado − recebido. Positivo = o ML reteve mais do que a gente conta. */
  diferenca: number;
  /** Diferença média por pedido conferido — o que dá pra projetar no resto. */
  diferencaPorPedido: number;
  /** A diferença cabe no ruído de arredondamento? */
  dentroDaTolerancia: boolean;
  /**
   * Se, E SOMENTE SE, dá pra afirmar que a margem confere no período todo.
   * Exige tolerância E cobertura — as duas, nunca uma só.
   */
  podeAfirmarQueBate: boolean;
  pendencias: Pendencia[];
};

/**
 * Lê a conferência sem extrapolar da amostra pro período.
 *
 * A cobertura baixa vira PENDÊNCIA declarada, não silêncio: quem olha
 * precisa saber que o "bate" que não apareceu não significa "não bate",
 * significa "ainda não dá pra dizer".
 */
export function lerConferencia(c: ConferenciaMP): LeituraDaConferencia {
  const cobertura = coberturaDaConferencia(c.conferidos, c.total);
  const diferenca = c.estimado - c.recebido;
  const diferencaPorPedido = c.conferidos > 0 ? diferenca / c.conferidos : 0;
  const dentroDaTolerancia = Math.abs(diferenca) < toleranciaDaConferencia(c.recebido);
  const cobre = cobertura !== null && cobertura >= COBERTURA_MINIMA;

  const pendencias: Pendencia[] = [];

  if (c.conferidos === 0) {
    pendencias.push({
      chave: "conferencia-sem-dados",
      titulo: "Nenhum repasse do Mercado Pago apurado no período",
      detalhe:
        "O líquido liberado só aparece depois que o ML processa o pagamento. " +
        "Sem nenhum pedido conferido, o resultado é inteiramente estimado: " +
        "nada foi checado contra dinheiro que entrou na conta.",
      efeito: "indefinido",
    });
  } else if (!cobre) {
    const pct = cobertura === null ? "?" : (cobertura * 100).toFixed(0);
    pendencias.push({
      chave: "conferencia-parcial",
      titulo: `Só ${c.conferidos} de ${c.total} pedidos têm repasse liberado (${pct}%)`,
      detalhe:
        "A conferência vale pra esses pedidos e mais nenhum. A diferença " +
        "medida neles não pode ser lida como a diferença do período — pedidos " +
        "recentes ainda não liberados podem se comportar de outro jeito.",
      efeito: "indefinido",
    });
  }

  if (c.conferidos > 0 && !dentroDaTolerancia) {
    pendencias.push({
      chave: "conferencia-divergente",
      titulo: "Nossa conta do repasse não bate com o líquido do Mercado Pago",
      detalhe:
        diferenca > 0
          ? "O ML reteve MAIS do que a gente desconta. Há custo de venda que o " +
            "app não conhece, e todo lucro calculado está otimista nessa medida."
          : "Chegou MAIS do que a gente previa. Alguma dedução está sendo " +
            "contada duas vezes, e o lucro calculado está pessimista.",
      efeito: diferenca > 0 ? "otimista" : "pessimista",
    });
  }

  const estado: EstadoApuracao =
    c.conferidos === 0 ? "estimado"
      : cobre && dentroDaTolerancia ? "conciliado"
        : "parcial";

  return {
    estado,
    cobertura,
    diferenca,
    diferencaPorPedido,
    dentroDaTolerancia,
    podeAfirmarQueBate: cobre && dentroDaTolerancia && c.conferidos > 0,
    pendencias,
  };
}

/** Pendências da coleta pro Full — o custo de levar estoque até o centro. */
export function pendenciasDaColetaFull(f: {
  foraDaJanela: boolean;
  parcial: boolean;
  remessas: number;
  pendentes: number;
}): Pendencia[] {
  if (f.foraDaJanela) {
    return [{
      chave: "coleta-fora-da-janela",
      titulo: "Custo das coletas pro Full não pôde ser buscado neste período",
      detalhe:
        "O ML só devolve operações de estoque numa janela recente. Pro período " +
        "pedido não há como consultar, então a linha aparece como indisponível " +
        "— e o resultado sai otimista pelo valor que essas coletas custaram.",
      efeito: "otimista",
    }];
  }
  if (f.parcial) {
    return [{
      chave: "coleta-parcial",
      titulo: `${f.pendentes} de ${f.remessas} coletas pro Full ainda sem custo`,
      detalhe:
        "O total das coletas é o que já veio — é PISO, não o valor fechado. " +
        "Cada coleta sem custo faz o resultado sair otimista.",
      efeito: "otimista",
    }];
  }
  return [];
}

/**
 * Pendência de produto sem custo cadastrado.
 *
 * Um SKU sem custo entra no CMV como ZERO — o lucro daquela venda aparece
 * inteiro. É a pendência que mais infla resultado nesta base, e por isso o
 * efeito é "otimista" sem ambiguidade.
 */
export function pendenciaDeCadastro(semCusto: number): Pendencia[] {
  if (semCusto <= 0) return [];
  return [{
    chave: "produto-sem-custo",
    titulo: `${semCusto} produto(s) vendidos sem custo cadastrado`,
    detalhe:
      "Sem custo, o CMV desses itens entra como zero e o lucro deles aparece " +
      "inteiro. O resultado está otimista até o cadastro ser completado.",
    efeito: "otimista",
  }];
}

/**
 * Pendência de período ainda em curso.
 *
 * Um mês pela metade não é um mês ruim: é meio mês. Chamar o número de
 * "resultado do mês" quando faltam 12 dias é o erro mais fácil de cometer
 * numa tela que mostra o mês corrente por padrão.
 */
export function pendenciaDeProjecao(fim: string, hoje: string): Pendencia[] {
  if (fim <= hoje) return [];
  return [{
    chave: "periodo-em-curso",
    titulo: "O período ainda não terminou",
    detalhe:
      `O período vai até ${fim} e hoje é ${hoje}. Os valores são do que já ` +
      "aconteceu — são PARCIAIS do período, não uma projeção do total dele. " +
      "Comparar com um mês inteiro compara coisas de tamanhos diferentes.",
    efeito: "pessimista",
  }];
}

/**
 * O estado geral, a partir de tudo que está pendente.
 *
 * Regra simples e deliberada: **qualquer** pendência tira o "conciliado". Não
 * existe "conciliado com ressalva" — é exatamente a frase que faz alguém ler
 * um número parcial como fechado.
 */
export function estadoGeral(pendencias: readonly Pendencia[], conferencia: EstadoApuracao): EstadoApuracao {
  if (pendencias.length === 0) return conferencia;
  if (conferencia === "estimado") return "estimado";
  return "parcial";
}

/** Como o estado se chama na tela. Curto, e sem eufemismo. */
export function rotuloDoEstado(e: EstadoApuracao): string {
  if (e === "conciliado") return "Conciliado";
  if (e === "parcial") return "Parcial — falta informação";
  return "Estimado — sem conferência";
}

/** A frase que explica o rótulo. Uma só, direta. */
export function explicarEstado(e: EstadoApuracao): string {
  if (e === "conciliado") {
    return "Todos os componentes deste período estão apurados e conferem com o dinheiro liberado.";
  }
  if (e === "parcial") {
    return "Parte do período já está apurada. O número mostrado ainda vai mudar — veja as pendências abaixo.";
  }
  return "Nenhum valor deste período foi conferido contra o dinheiro que entrou. É cálculo, não fechamento.";
}

/** Cor semântica do estado, nos tokens do tema. */
export function corDoEstado(e: EstadoApuracao): string {
  if (e === "conciliado") return "var(--green)";
  if (e === "parcial") return "var(--gold)";
  return "var(--muted)";
}

export type ContextoDeExportacao = {
  /** Início e fim do período apurado, ISO. */
  de: string;
  ate: string;
  /** Momento em que os números foram lidos, ISO completo. */
  apuradoEm: string;
  /** Filtros aplicados na tela, já legíveis. Vazio = nenhum. */
  filtros: string[];
  estado: EstadoApuracao;
  pendencias: readonly Pendencia[];
};

const br = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : iso);

/**
 * O cabeçalho que TODA exportação leva antes da primeira linha de número.
 *
 * ─── POR QUE ISTO EXISTE ─────────────────────────────────────────────────
 *
 * Uma planilha sai do app e vira anexo de e-mail, e daí em diante ela não
 * tem mais contexto nenhum: quem abre não sabe de que período é, se tinha
 * filtro, de quando são os números, nem que faltava informação quando foram
 * tirados. O arquivo vira "o resultado", e um resultado parcial lido como
 * fechado é pior do que nenhum arquivo.
 *
 * Por isso o cabeçalho não é opcional e não é rodapé: vem ANTES dos números,
 * onde não dá pra rolar por cima sem ver.
 *
 * Devolve linhas de células — quem chama decide o separador e o escape.
 */
export function cabecalhoDeExportacao(ctx: ContextoDeExportacao): string[][] {
  const linhas: string[][] = [
    ["Período", `${br(ctx.de)} a ${br(ctx.ate)}`],
    ["Apurado em", ctx.apuradoEm],
    ["Filtros", ctx.filtros.length ? ctx.filtros.join(" · ") : "nenhum"],
    ["Estado", rotuloDoEstado(ctx.estado)],
    ["", explicarEstado(ctx.estado)],
  ];

  if (ctx.pendencias.length) {
    linhas.push([""]);
    linhas.push(["Pendências de informação", String(ctx.pendencias.length)]);
    for (const p of ctx.pendencias) {
      linhas.push([p.titulo, p.detalhe, `efeito no resultado: ${p.efeito}`]);
    }
  }

  linhas.push([""]);
  return linhas;
}

/**
 * O nome que a linha final pode ter, dado o estado.
 *
 * "Resultado líquido" soa a número fechado. Quando falta informação, o mesmo
 * número precisa de outro nome — não de uma nota de rodapé em cinza que
 * ninguém lê ao lado de um título que afirma fechamento.
 */
export function rotuloDoResultado(e: EstadoApuracao): string {
  if (e === "conciliado") return "Resultado da empresa";
  if (e === "parcial") return "Resultado da empresa (parcial)";
  return "Resultado da empresa (estimado)";
}
