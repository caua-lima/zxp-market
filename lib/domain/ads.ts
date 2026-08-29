// Helpers puros pra aba Ads — break-even ROAS e recomendação de ação por
// anúncio. Nada aqui recalcula lucro/vendas: recebe números já prontos da
// API de Ads (app/api/ml/ads/route.ts) e só decide como ler/rotular eles.

/**
 * ROAS mínimo pra não perder dinheiro com o ad, derivado da margem ANTES de
 * ads: se o produto já tem lucroAntesAds > 0 pra um volume de vendas, o
 * break-even é vendas ÷ lucroAntesAds (o ponto em que o custo do ad consome
 * exatamente esse lucro). Só é "matematicamente seguro" quando
 * lucroAntesAds > 0 — se o produto já não cobre o próprio custo antes do
 * ads, não existe ROAS que salve, então retorna null (não um número
 * enganoso como Infinity ou 0).
 */
export function calculateBreakEvenRoas(vendas: number, lucroAntesAds: number): number | null {
  if (vendas <= 0 || lucroAntesAds <= 0) return null;
  return vendas / lucroAntesAds;
}

/**
 * ROAS IDEAL — o mínimo pra sobrar a margem que você quer, não só pra empatar.
 *
 * Break-even responde "a partir de quanto eu paro de perder"; este responde
 * "a partir de quanto eu de fato LUCRO o que quero". A diferença entre os dois
 * é a faixa em que o anúncio se paga mas não entrega margem — que é onde a
 * maioria das campanhas vive sem ninguém notar.
 *
 * Dedução (R = receita, C = custo do ad, L0 = lucro ANTES do ad, m = margem
 * alvo em fração):
 *     margem após ads = (L0 − C) / R ≥ m
 *     ⇒ C ≤ L0 − m·R
 *     ⇒ ROAS = R / C ≥ R / (L0 − m·R)
 *
 * Retorna null quando L0 ≤ m·R: nesse caso o produto não gera margem
 * suficiente NEM gastando zero em ads — nenhum ROAS resolve, e devolver um
 * número aqui (0, Infinity) faria a tela sugerir uma meta impossível. Com
 * m = 0 o resultado é exatamente o break-even, por construção.
 */
export function calculateTargetRoas(
  vendas: number,
  lucroAntesAds: number,
  metaMargemPct: number,
): number | null {
  if (vendas <= 0 || lucroAntesAds <= 0) return null;
  const m = Math.max(metaMargemPct, 0) / 100;
  const folga = lucroAntesAds - m * vendas;
  if (folga <= 0) return null;
  return vendas / folga;
}

/**
 * Lucro que sobraria se o anúncio atingisse um ROAS alvo, mantendo a MESMA
 * receita de hoje.
 *
 * A pergunta que isto responde é "vale perseguir esse ROAS?". O ROAS ideal
 * sozinho é uma meta abstrata — R$ 62,75x não diz nada até virar dinheiro.
 *
 * Como o ROAS alvo é atingido cortando investimento (R fixo, C menor):
 *     C_alvo = R / ROAS_alvo
 *     lucro  = L0 − C_alvo
 *
 * Vale dizer o que isto NÃO é: uma previsão. Cortar investimento pela metade
 * costuma derrubar a receita junto, e aí o resultado real fica abaixo daqui.
 * É o teto do que aquele ROAS entregaria — bom pra comparar anúncios entre si,
 * não pra prometer resultado.
 *
 * Devolve null sem receita ou sem ROAS alvo: seria divisão por zero.
 */
export function lucroNoRoas(
  vendas: number,
  lucroAntesAds: number,
  roasAlvo: number | null,
): number | null {
  if (roasAlvo == null || roasAlvo <= 0 || vendas <= 0) return null;
  return lucroAntesAds - vendas / roasAlvo;
}

/**
 * Por que não há ROAS ideal pra este anúncio — o texto que substitui o "—" mudo.
 *
 * Um traço na coluna faz parecer defeito da tela. Na verdade são três
 * situações bem diferentes, e cada uma pede uma ação diferente de quem lê:
 * faltar venda é esperar/investir, o produto não fechar conta é mexer em
 * preço ou custo, e a meta ser inalcançável é rever a meta.
 *
 * A quarta é a mais traiçoeira: produto SEM custo cadastrado. Ela não podia
 * nem chegar aqui, porque o custo ausente virava zero lá atrás e o anúncio
 * aparecia com margem perto de 100% — o melhor da tela, por falta de dado.
 * Agora chega, e a ação é cadastrar o custo, não mexer na campanha.
 */
export function motivoSemRoasIdeal(
  vendas: number,
  lucroAntesAds: number,
  metaMargemPct: number,
  custoConhecido: boolean = true,
): string | null {
  if (!custoConhecido) {
    return "Este anúncio não tem produto vinculado no Estoque, então o custo é desconhecido. "
      + "Cadastre o custo pra este anúncio entrar nas contas de lucro e ROAS.";
  }
  if (vendas > 0 && lucroAntesAds > 0) {
    const m = Math.max(metaMargemPct, 0) / 100;
    if (lucroAntesAds - m * vendas > 0) return null; // tem ROAS ideal
    return `Este produto rende ${((lucroAntesAds / vendas) * 100).toFixed(1)}% antes do ads — abaixo da meta de ${metaMargemPct}%. Nenhum ROAS alcança essa margem: o ajuste é no preço ou no custo, não na campanha.`;
  }
  if (vendas <= 0) {
    return "Sem venda atribuída no período — sem receita não dá pra calcular o ROAS que cobre a meta.";
  }
  return "O produto não cobre o próprio custo antes do ads (lucro antes do ads é zero ou negativo). Não existe ROAS que torne este anúncio lucrativo.";
}

export type AdRecommendation = {
  acao: "pausar" | "reduzir" | "escalar" | "sem-dados";
  label: string;
  tone: "critical" | "warning" | "opportunity" | "info";
};

/**
 * Volume mínimo pra confiar na recomendação — abaixo disso, 1 ou 2 vendas ao
 * acaso (ou nenhuma) fariam ROAS/margem oscilar demais pra virar conselho.
 */
const CLIQUES_MIN = 20;
const INVESTIMENTO_RELEVANTE = 20; // R$ — abaixo disso, "pausar" seria alarme por centavos

export function getAdRecommendation(input: {
  clicks: number;
  vendas: number;
  cost: number;
  lucro: number | null; // null = sem dado (ex.: "direto" sem diretoDisponivel)
  roas: number;
  roasTarget: number;
  breakEvenRoas: number | null;
  margem: number | null;
  metaMargem: number;
  /**
   * Lucro do produto ANTES de descontar o ads. Quando é <= 0 com venda
   * acontecendo, nenhum ROAS salva o anúncio — e essa é uma conclusão, não
   * falta de dado (ver abaixo).
   */
  lucroAntesAds?: number | null;
  /**
   * O produto anunciado tem custo cadastrado. Sem isso, `lucroAntesAds` chega
   * zerado — e zero aqui significaria "no vermelho", que é uma CONCLUSÃO. São
   * coisas opostas: uma manda mexer no preço, a outra manda cadastrar o custo.
   */
  custoConhecido?: boolean;
}): AdRecommendation {
  const { clicks, vendas, cost, lucro, roas, roasTarget, breakEvenRoas, margem, metaMargem } = input;
  const lucroAntesAds = input.lucroAntesAds ?? null;
  const custoConhecido = input.custoConhecido ?? true;

  /**
   * "Sem dados suficientes" só quando é VERDADE.
   *
   * Antes esta era também a resposta padrão do fim da função, e engolia casos
   * em que havia dado de sobra: um anúncio com ROAS 33x e margem −10,4%
   * aparecia como "sem dados", quando a leitura certa é que o PRODUTO está no
   * vermelho antes do ads. Medido na conta: Boldo (−R$ 2,95 antes do ads) e
   * Menta & Cereja (−R$ 0,37) — os dois com ROAS excelente.
   *
   * Rotular conclusão como ausência de dado é pior que não dizer nada: manda
   * a pessoa esperar mais dados quando o que falta é mexer em preço ou custo.
   */
  if (clicks === 0 && vendas === 0) {
    return { acao: "sem-dados", label: "Sem cliques no período", tone: "info" };
  }

  /**
   * Volume pequeno E nenhuma venda: continua sem conclusão, como sempre foi —
   * com 5 cliques, uma venda a mais mudaria tudo. O que muda é o TEXTO, que
   * agora diz o que falta (quantos cliques, quanto já saiu) em vez de um
   * "sem dados" que não ajuda a decidir se vale esperar.
   */
  if (clicks < CLIQUES_MIN && vendas === 0) {
    return { acao: "sem-dados", label: `Sem venda atribuída ainda (${clicks} clique(s), ${fmtReais(cost)})`, tone: "info" };
  }

  /**
   * Custo desconhecido vem ANTES do "no vermelho": sem produto vinculado o
   * lucro chega zerado, e a regra abaixo leria isso como prejuízo e mandaria
   * pausar um anúncio que pode ser o melhor da conta. Falta de cadastro não é
   * diagnóstico de campanha.
   */
  if (!custoConhecido) {
    return {
      acao: "sem-dados",
      label: "Sem custo cadastrado pro produto — vincule no Estoque pra medir o lucro",
      tone: "info",
    };
  }

  /**
   * Produto que não se paga ANTES do ads. Vem antes das regras de ROAS de
   * propósito: aqui o problema não é a campanha, e sugerir ajuste de
   * orçamento mandaria mexer no lugar errado.
   */
  if (vendas > 0 && lucroAntesAds != null && lucroAntesAds <= 0) {
    return {
      acao: "pausar",
      label: "Produto no vermelho antes do Ads — ajuste preço ou custo, não a campanha",
      tone: "critical",
    };
  }

  /**
   * Cliques suficientes e nenhuma venda atribuída. Vem ANTES do "prejuízo
   * confirmado" genérico porque é mais específico e diz o que houve: o
   * dinheiro saiu e o clique não converteu. O genérico diria a mesma coisa
   * com menos informação.
   */
  if (vendas === 0 && cost > 0) {
    return { acao: "reduzir", label: `Investiu ${fmtReais(cost)} sem venda atribuída — revisar`, tone: "warning" };
  }

  // "acao" interna continua "pausar" (usada por quem filtra/agrupa por tipo
  // de ação), mas o TEXTO nunca afirma pausa definitiva — o ML não garante
  // que pausar é reversível sem perder histórico de aprendizado da campanha,
  // e a decisão final é sempre de quem lê a tela, não do sistema.
  if (lucro != null && lucro < 0 && cost >= INVESTIMENTO_RELEVANTE) {
    return { acao: "pausar", label: "Revisar ou reduzir — prejuízo confirmado", tone: "critical" };
  }

  const abaixoDoAlvo = roasTarget > 0 && roas < roasTarget;
  const abaixoDoBreakEven = breakEvenRoas != null && roas < breakEvenRoas;
  if (cost > 0 && abaixoDoAlvo && abaixoDoBreakEven) {
    return { acao: "reduzir", label: "Revisar ou reduzir orçamento", tone: "warning" };
  }

  const margemSaudavel = margem != null && margem >= metaMargem;
  const roasSaudavel = (roasTarget > 0 && roas >= roasTarget) || (breakEvenRoas != null && roas >= breakEvenRoas * 1.2);
  if (margemSaudavel && roasSaudavel && cost > 0) {
    return { acao: "escalar", label: "Escalar com cautela", tone: "opportunity" };
  }

  /**
   * Tem venda e lucro, mas volume pequeno demais pra virar recomendação —
   * uma venda a mais ou a menos mudaria a leitura. Dizer o QUE falta é
   * diferente de dizer que não há dado.
   */
  if (clicks < CLIQUES_MIN) {
    return { acao: "sem-dados", label: `Volume baixo pra concluir (${clicks} clique(s) de ${CLIQUES_MIN})`, tone: "info" };
  }

  return { acao: "sem-dados", label: "Dentro do esperado — nada a ajustar agora", tone: "info" };
}

/** R$ curto pro rótulo da decisão — o formatador completo vive na camada de UI. */
function fmtReais(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
