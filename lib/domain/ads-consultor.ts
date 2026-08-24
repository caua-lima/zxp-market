/**
 * O consultor de Ads: junta DEPENDÊNCIA e RENTABILIDADE numa decisão só.
 *
 * ─── POR QUE NÃO BASTA O getAdRecommendation QUE JÁ EXISTE ──────────────
 *
 * `getAdRecommendation` (ads.ts) decide olhando ROAS, margem e break-even —
 * tudo do ponto de vista da CAMPANHA. Falta a pergunta que mais muda a
 * decisão na prática: quanto da venda daquele produto depende do Ads?
 *
 * Dois anúncios com margem −2% pedem ações OPOSTAS:
 *
 *   · 8% das vendas vêm do Ads  → desligar. Perde-se quase nada de
 *     faturamento e o prejuízo some. A venda é orgânica.
 *   · 75% das vendas vêm do Ads → desligar derruba 3/4 do faturamento
 *     daquele produto. Aqui o certo é corrigir preço/custo/ROAS, não cortar.
 *
 * Sem a dependência, os dois recebiam o mesmo "pausar" — e num deles isso
 * seria um erro caro. É essa combinação que este módulo resolve.
 *
 * ─── PURO DE PROPÓSITO ──────────────────────────────────────────────────
 *
 * Nada de rede, nada de IA. A decisão sobre dinheiro tem que ser
 * determinística, testável e explicável: o vendedor precisa saber POR QUE,
 * e o mesmo dado tem que dar sempre a mesma resposta. Um modelo de
 * linguagem inventaria número — aqui todo valor citado vem do cálculo.
 */

/**
 * Abaixo disto, o Ads é complemento: desligar não derruba o faturamento do
 * produto de forma relevante.
 *
 * 30% é o corte que o próprio operador usa na prática, e tem lógica:
 * abaixo de um terço, a venda se sustenta sozinha. Não é uma constante
 * universal — é o ponto onde o risco de cortar deixa de ser assustador.
 */
export const DEPENDENCIA_BAIXA_PCT = 30;

/** Acima disto, cortar o Ads é uma decisão de faturamento, não só de custo. */
export const DEPENDENCIA_ALTA_PCT = 60;

export type AcaoAds =
  | "desligar"        // o Ads custa e não sustenta a venda
  | "corrigir-produto" // o produto não fecha nem sem Ads: preço/custo
  | "ajustar-roas"    // vale manter, mas o ROAS atual não paga
  | "manter"          // está saudável
  | "escalar"         // lucrativo e o Ads sustenta a venda
  | "sem-dados";      // volume insuficiente pra concluir

export type VeredictoAds = {
  acao: AcaoAds;
  /** Frase curta — o que fazer. */
  titulo: string;
  /** O porquê, citando os números que sustentam a decisão. */
  motivo: string;
  tone: "pos" | "warn" | "critical" | "info";
  /** Quanto se perde de faturamento ao desligar (só quando faz sentido estimar). */
  riscoAoDesligar: number | null;
};

export type DadosAnuncio = {
  titulo: string;
  /** Receita do período (a mesma base usada em `margem`). */
  vendas: number;
  /** Investimento em Ads no período. */
  custo: number;
  /** Lucro líquido já descontando o Ads. null = sem dado pra concluir. */
  lucro: number | null;
  /** Margem líquida % (lucro ÷ vendas). null = sem dado. */
  margem: number | null;
  roas: number;
  /** % da venda TOTAL do produto que o ML atribui ao Ads. */
  pctAds: number | null;
  /** Lucro do produto ANTES do Ads. <= 0 = o problema não é a campanha. */
  lucroAntesAds: number | null;
  cliques: number;
  /** Meta de margem do operador — o que ele considera saudável. */
  metaMargem: number;
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
const x = (v: number) => `${v.toFixed(2).replace(".", ",")}x`;

/**
 * Volume mínimo pra concluir qualquer coisa. Com 3 cliques e nenhuma venda,
 * uma única conversão mudaria todo o quadro — dizer "desligue" ali é chute.
 */
const CLIQUES_MIN = 15;

export function analisarAnuncio(d: DadosAnuncio): VeredictoAds {
  const temVenda = d.vendas > 0;
  const investiu = d.custo > 0;

  // ── Sem base pra concluir ──
  if (!investiu && !temVenda) {
    return {
      acao: "sem-dados",
      titulo: "Sem atividade no período",
      motivo: "Nenhum investimento e nenhuma venda registrada — não há o que analisar.",
      tone: "info",
      riscoAoDesligar: null,
    };
  }
  if (d.cliques < CLIQUES_MIN && !temVenda) {
    return {
      acao: "sem-dados",
      titulo: "Ainda cedo pra decidir",
      motivo:
        `Só ${d.cliques} clique(s) e nenhuma venda atribuída, com ${brl(d.custo)} investidos. `
        + `Com esse volume, uma venda a mais mudaria a conclusão — vale esperar mais dados.`,
      tone: "info",
      riscoAoDesligar: null,
    };
  }

  /**
   * O produto não fecha NEM SEM o Ads. Vem antes de tudo: aqui mexer na
   * campanha é mexer no lugar errado, por melhor que o ROAS esteja.
   */
  if (temVenda && d.lucroAntesAds != null && d.lucroAntesAds <= 0) {
    return {
      acao: "corrigir-produto",
      titulo: "O problema não é o Ads — é o preço ou o custo",
      motivo:
        `Este produto dá ${brl(d.lucroAntesAds)} ANTES de descontar a publicidade. `
        + `Nenhum ROAS conserta isso: mesmo com o Ads de graça o resultado seria negativo. `
        + `Ajuste preço, custo ou frete antes de mexer na campanha.`,
      tone: "critical",
      riscoAoDesligar: null,
    };
  }

  // Sem margem apurada não dá pra falar de rentabilidade com honestidade.
  if (d.lucro == null || d.margem == null) {
    return {
      acao: "sem-dados",
      titulo: "Falta vincular o produto pra calcular a margem",
      motivo:
        `Houve ${brl(d.custo)} de investimento, mas não consigo apurar o lucro deste anúncio `
        + `— provavelmente o MLB não está vinculado a um produto no Estoque, então não há custo pra descontar.`,
      tone: "info",
      riscoAoDesligar: null,
    };
  }

  const dep = d.pctAds;
  const depBaixa = dep != null && dep < DEPENDENCIA_BAIXA_PCT;
  const depAlta = dep != null && dep >= DEPENDENCIA_ALTA_PCT;
  const lucrando = d.lucro > 0;
  const margemBoa = d.margem >= d.metaMargem;

  // Faturamento em risco = a fatia que o Ads sustenta.
  const risco = dep != null ? (d.vendas * Math.min(dep, 100)) / 100 : null;
  const depTxt = dep != null ? pct(dep) : "indefinida";

  /**
   * ── O caso que motivou este módulo ──
   * Pouca dependência e no vermelho: o Ads não está sustentando a venda, e
   * ainda consome o lucro. Desligar devolve margem e custa pouco volume.
   */
  if (depBaixa && !lucrando) {
    return {
      acao: "desligar",
      titulo: "Desligar este anúncio",
      motivo:
        `Só ${depTxt} das vendas deste produto vêm do Ads, e mesmo assim ele fecha em ${brl(d.lucro)} `
        + `(margem ${pct(d.margem)}). A venda é majoritariamente orgânica: desligando, você perde `
        + `perto de ${risco != null ? brl(risco) : "pouco"} de faturamento e recupera os ${brl(d.custo)} `
        + `que estão saindo em publicidade.`,
      tone: "critical",
      riscoAoDesligar: risco,
    };
  }

  /**
   * Pouca dependência mas lucrando com margem saudável — o outro caso que
   * você citou. O Ads é um complemento que se paga; não há por que cortar.
   */
  if (depBaixa && lucrando && margemBoa) {
    return {
      acao: "manter",
      titulo: "Manter como está",
      motivo:
        `Mesmo com o Ads representando só ${depTxt} das vendas, o anúncio fecha positivo: `
        + `${brl(d.lucro)} de lucro, margem ${pct(d.margem)} — acima da sua meta de ${pct(d.metaMargem)}. `
        + `Está se pagando; não há motivo pra mexer.`,
      tone: "pos",
      riscoAoDesligar: risco,
    };
  }

  // Pouca dependência, lucrando, mas margem abaixo da meta: dá pra apertar.
  if (depBaixa && lucrando && !margemBoa) {
    return {
      acao: "ajustar-roas",
      titulo: "Lucra, mas abaixo da sua meta",
      motivo:
        `O anúncio dá ${brl(d.lucro)} (margem ${pct(d.margem)}), abaixo da meta de ${pct(d.metaMargem)}. `
        + `Como só ${depTxt} das vendas dependem do Ads, dá pra subir o ROAS alvo ou reduzir o investimento `
        + `sem risco grande de perder volume.`,
      tone: "warn",
      riscoAoDesligar: risco,
    };
  }

  /**
   * Dependência alta e no vermelho — o caso onde desligar é tentador e
   * perigoso. O aviso tem que ser explícito sobre o tamanho do buraco.
   */
  if (!lucrando && depAlta) {
    return {
      acao: "ajustar-roas",
      titulo: "Corrigir antes de desligar — o Ads sustenta a venda",
      motivo:
        `Está em ${brl(d.lucro)} (margem ${pct(d.margem)}) com ROAS ${x(d.roas)}, mas ${depTxt} das vendas `
        + `deste produto vêm do Ads. Desligar agora tiraria cerca de ${risco != null ? brl(risco) : "boa parte"} `
        + `de faturamento. Suba o ROAS alvo ou corrija preço/custo primeiro, e só corte se não fechar.`,
      tone: "critical",
      riscoAoDesligar: risco,
    };
  }

  // Dependência intermediária (30–60%) e no vermelho.
  if (!lucrando) {
    return {
      acao: "ajustar-roas",
      titulo: "Ajustar o ROAS alvo",
      motivo:
        `Fecha em ${brl(d.lucro)} (margem ${pct(d.margem)}) com ROAS ${x(d.roas)}. `
        + `Com ${depTxt} das vendas vindo do Ads, cortar tudo derrubaria ${risco != null ? brl(risco) : "parte"} `
        + `de faturamento — o caminho é subir o ROAS alvo e reduzir o desperdício, não desligar.`,
      tone: "warn",
      riscoAoDesligar: risco,
    };
  }

  // Lucrando com dependência relevante e margem boa: é o que merece verba.
  if (lucrando && margemBoa) {
    return {
      acao: "escalar",
      titulo: "Escalar — está pagando e sustentando venda",
      motivo:
        `${brl(d.lucro)} de lucro, margem ${pct(d.margem)} (meta ${pct(d.metaMargem)}), ROAS ${x(d.roas)}, `
        + `e ${depTxt} das vendas vêm do Ads. É lucrativo E o Ads está trazendo volume de verdade — `
        + `é aqui que aumentar o orçamento faz mais sentido.`,
      tone: "pos",
      riscoAoDesligar: risco,
    };
  }

  return {
    acao: "ajustar-roas",
    titulo: "Lucra, mas abaixo da meta",
    motivo:
      `${brl(d.lucro)} de lucro com margem ${pct(d.margem)}, abaixo da meta de ${pct(d.metaMargem)}. `
      + `Com ${depTxt} de dependência do Ads, subir o ROAS alvo tende a recuperar margem sem perder muita venda.`,
    tone: "warn",
    riscoAoDesligar: risco,
  };
}

/**
 * Ordena por urgência: o que está queimando dinheiro aparece primeiro.
 * Dentro da mesma ação, o maior prejuízo primeiro — é onde mexer rende mais.
 */
const PESO: Record<AcaoAds, number> = {
  desligar: 0,
  "corrigir-produto": 1,
  "ajustar-roas": 2,
  escalar: 3,
  manter: 4,
  "sem-dados": 5,
};

export function ordenarPorUrgencia<T extends { veredicto: VeredictoAds; lucro: number | null }>(
  itens: T[],
): T[] {
  return [...itens].sort((a, b) => {
    const p = PESO[a.veredicto.acao] - PESO[b.veredicto.acao];
    if (p !== 0) return p;
    return (a.lucro ?? 0) - (b.lucro ?? 0);
  });
}
