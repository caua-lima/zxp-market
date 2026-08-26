/**
 * O que o consultor SABE sobre publicidade no Mercado Livre.
 *
 * ─── O QUE ISTO ACRESCENTA ──────────────────────────────────────────────
 *
 * `ads-consultor.ts` decide o que fazer com UM anúncio, olhando os números
 * dele. Isto responde a outra classe de pergunta: "o que é ROAS ideal?",
 * "por que meu ROAS está ótimo e mesmo assim dá prejuízo?", "quanto devo
 * colocar de orçamento?". Conceito, não diagnóstico.
 *
 * Sem isso, o consultor sabia julgar mas não sabia explicar — e quem não
 * entende a régua não confia no veredicto.
 *
 * ─── A PARTE QUE FAZ DIFERENÇA: O CONCEITO VEM COM O SEU NÚMERO ─────────
 *
 * Explicar "ROAS ideal é o que sobra a margem alvo" é teoria de blog. O que
 * muda decisão é "no seu caso, com meta de 10%, o ROAS ideal médio dos seus
 * anúncios é 6,2x — e 4 deles estão abaixo".
 *
 * Por isso cada tópico pode declarar `contextualizar`: uma função pura que
 * recebe os SEUS agregados e devolve a frase específica. O texto fixo nunca
 * cita número; todo número vem de cálculo. É a mesma regra do resto do app —
 * conceito é escrito à mão, número é medido.
 */

export type ContextoAds = {
  /** Anúncios com investimento no período. */
  comInvestimento: number;
  investidoTotal: number;
  /** Receita atribuída ao clique direto. */
  vendaDiretaTotal: number;
  /** Receita total dos produtos anunciados (inclui orgânica). */
  vendaTotal: number;
  /** Meta de margem configurada pelo operador, em %. */
  metaMargem: number;
  /** Quantos anúncios estão abaixo do próprio break-even. */
  abaixoDoBreakEven: number;
  /** Quantos estão abaixo do ROAS ideal (margem alvo). */
  abaixoDoIdeal: number;
  /** Anúncios que dão prejuízo mesmo antes de descontar o Ads. */
  negativosAntesDoAds: number;
  /** Média do ROAS ideal entre os anúncios que têm um. null = nenhum. */
  roasIdealMedio: number | null;
  /** Anúncios sem produto vinculado — sem custo, sem margem apurável. */
  semVinculo: number;
};

export type TopicoAds = {
  id: string;
  pergunta: string;
  resposta: string;
  termos: string[];
  /** Frase com os números reais do operador. null = não se aplica agora. */
  contextualizar?: (c: ContextoAds) => string | null;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const x = (v: number) => `${v.toFixed(2).replace(".", ",")}x`;
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

export const TOPICOS_ADS: TopicoAds[] = [
  {
    id: "roas",
    pergunta: "O que é ROAS?",
    termos: ["roas", "retorno", "significa", "conceito"],
    resposta:
      "ROAS = receita ÷ investimento. Um ROAS de 5x quer dizer que cada R$ 1 em anúncio trouxe R$ 5 de venda.\n\n"
      + "Cuidado com a leitura mais comum e mais errada: ROAS acima de 1x NÃO significa lucro. "
      + "1x quer dizer que o anúncio devolveu exatamente o que custou — e você ainda não pagou o produto, "
      + "o frete, a comissão do ML nem o imposto. O número que separa lucro de prejuízo é o break-even.",
    contextualizar: (c) =>
      c.investidoTotal > 0
        ? `No período: ${brl(c.investidoTotal)} investidos e ${brl(c.vendaDiretaTotal)} de venda direta — `
          + `ROAS direto de ${x(c.vendaDiretaTotal / c.investidoTotal)}.`
        : null,
  },
  {
    id: "break-even",
    pergunta: "O que é ROAS de equilíbrio (break-even)?",
    termos: ["break", "even", "equilibrio", "empatar", "minimo", "nao perder", "prejuizo"],
    resposta:
      "É o ROAS mínimo pra o anúncio não dar prejuízo. Fórmula: receita ÷ lucro antes do Ads.\n\n"
      + "Exemplo: um produto que vende a R$ 100 e deixa R$ 20 depois de custo, frete, comissão e imposto "
      + "tem break-even de 100 ÷ 20 = 5x. Abaixo de 5x, cada real investido sai do seu lucro.\n\n"
      + "É por isso que não existe um ROAS bom universal: produto de margem gorda se paga com 3x, "
      + "produto de margem fina precisa de 10x. O break-even é seu, e muda por produto.",
    contextualizar: (c) =>
      c.abaixoDoBreakEven > 0
        ? `Agora: ${c.abaixoDoBreakEven} anúncio(s) estão abaixo do próprio break-even — perdendo dinheiro em publicidade.`
        : c.comInvestimento > 0
          ? "Agora: nenhum anúncio seu está abaixo do break-even."
          : null,
  },
  {
    id: "roas-ideal",
    pergunta: "O que é ROAS ideal e como escolher o meu?",
    termos: ["roas ideal", "roas alvo", "ideal", "alvo", "meta", "target", "escolher", "definir"],
    resposta:
      "Break-even é onde você para de perder. ROAS ideal é onde você de fato ganha o que quer.\n\n"
      + "Fórmula: receita ÷ (lucro antes do Ads − margem alvo × receita). Ou seja: além de cobrir os custos, "
      + "ainda sobra a margem que você definiu como saudável.\n\n"
      + "A faixa entre o break-even e o ideal é onde mora a maioria das campanhas: o anúncio se paga, "
      + "parece saudável, mas não entrega margem. É a zona mais perigosa porque não dói o suficiente "
      + "pra você notar.\n\n"
      + "Como escolher a margem alvo: use a que sustenta seu negócio depois dos custos fixos, não a que "
      + "parece bonita. Se você não sabe, comece com a margem média histórica dos produtos que dão lucro.",
    contextualizar: (c) => {
      const partes: string[] = [];
      if (c.roasIdealMedio != null) {
        partes.push(`Com sua meta de ${pct(c.metaMargem)}, o ROAS ideal médio dos seus anúncios é ${x(c.roasIdealMedio)}.`);
      }
      if (c.abaixoDoIdeal > 0) partes.push(`${c.abaixoDoIdeal} anúncio(s) estão abaixo dele.`);
      return partes.length ? partes.join(" ") : null;
    },
  },
  {
    id: "acos-tacos",
    pergunta: "Qual a diferença entre ACOS e TACOS?",
    termos: ["acos", "tacos", "diferenca", "percentual", "custo publicidade"],
    resposta:
      "ACOS = investimento ÷ receita ATRIBUÍDA ao anúncio. É o inverso do ROAS: ROAS 5x = ACOS 20%.\n\n"
      + "TACOS = investimento ÷ faturamento TOTAL, incluindo a venda orgânica. É a métrica que responde "
      + "\"quanto da minha receita inteira eu paguei de publicidade\".\n\n"
      + "Use ACOS pra julgar a campanha e TACOS pra julgar o negócio. TACOS subindo com ACOS estável "
      + "quer dizer que sua venda orgânica está encolhendo — você está ficando dependente do anúncio "
      + "sem perceber, porque a campanha em si continua parecendo boa.",
  },
  {
    id: "direta-assistida",
    pergunta: "Qual a diferença entre venda direta e atribuída?",
    termos: ["direta", "assistida", "atribuida", "atribuicao", "diferenca", "clique"],
    resposta:
      "DIRETA: o comprador clicou no anúncio pago e comprou. Rastro claro.\n\n"
      + "ASSISTIDA: ele viu o anúncio, não clicou (ou clicou e comprou depois por outro caminho) e a "
      + "compra aconteceu dentro da janela de atribuição do ML.\n\n"
      + "O painel do Mercado Ads soma as duas em \"vendas atribuídas\", o que deixa o ROAS mais bonito. "
      + "Este app mostra as duas separadas e usa a DIRETA como padrão, porque é a conservadora: se você "
      + "for errar, é melhor errar achando que ganhou menos.\n\n"
      + "A assistida não é mentira — parte dela é real. Mas ela também credita ao anúncio venda que "
      + "aconteceria de qualquer jeito.",
  },
  {
    id: "roas-alto-prejuizo",
    pergunta: "Meu ROAS está ótimo mas dá prejuízo. Por quê?",
    termos: ["alto", "otimo", "bom", "mesmo assim", "prejuizo", "porque", "estranho", "nao faz sentido"],
    resposta:
      "Quase sempre o problema não é a campanha — é o produto.\n\n"
      + "Se o produto já dá prejuízo ANTES de descontar a publicidade (preço baixo demais, custo alto, "
      + "frete pesado, comissão), nenhum ROAS conserta. Um ROAS de 40x num produto que perde R$ 3 por "
      + "venda só faz você perder R$ 3 mais vezes.\n\n"
      + "Nesse caso a ação é preço ou custo, não orçamento. Baixar o investimento reduz o prejuízo, mas "
      + "não resolve: o buraco continua a cada venda orgânica.",
    contextualizar: (c) =>
      c.negativosAntesDoAds > 0
        ? `É o caso de ${c.negativosAntesDoAds} anúncio(s) seus agora — eles perdem dinheiro mesmo com o Ads de graça.`
        : null,
  },
  {
    id: "dependencia",
    pergunta: "Devo desligar um anúncio que está no vermelho?",
    termos: ["desligar", "pausar", "cortar", "vermelho", "devo", "dependencia"],
    resposta:
      "Depende de quanto da venda daquele produto vem do Ads — e essa é a pergunta que quase ninguém faz.\n\n"
      + "· Pouca dependência (abaixo de ~30%) e no vermelho → DESLIGUE. A venda é orgânica; você perde "
      + "pouco volume e recupera o que estava saindo em anúncio.\n\n"
      + "· Muita dependência (acima de ~60%) e no vermelho → NÃO desligue de primeira. Cortar derruba a "
      + "maior parte do faturamento daquele produto. Corrija preço/custo ou suba o ROAS alvo, e só corte "
      + "se não fechar.\n\n"
      + "Mesma margem negativa, decisões opostas. É por isso que \"pausar tudo que está no vermelho\" "
      + "é um conselho ruim.",
  },
  {
    id: "orcamento",
    pergunta: "Quanto devo colocar de orçamento diário?",
    termos: ["orcamento", "budget", "diario", "quanto", "investir", "colocar", "aumentar", "escalar"],
    resposta:
      "Orçamento não se escolhe por intuição nem por \"quanto posso perder\" — se escolhe pelo que o "
      + "anúncio devolve.\n\n"
      + "Regra prática: só aumente orçamento em anúncio que já está ACIMA do ROAS ideal e com margem "
      + "acima da sua meta. Aumentar verba em anúncio abaixo do break-even é acelerar o prejuízo.\n\n"
      + "Suba aos poucos (30–50% por vez) e espere alguns dias: o ML precisa de tempo pra reajustar a "
      + "entrega, e o ROAS quase sempre cai um pouco quando o volume sobe — você passa a comprar "
      + "cliques menos qualificados.\n\n"
      + "Se o ROAS cair abaixo do ideal depois do aumento, volte ao patamar anterior. Achou o teto.",
  },
  {
    id: "quando-escalar",
    pergunta: "Quando vale a pena escalar um anúncio?",
    termos: ["escalar", "aumentar", "crescer", "vale a pena", "quando", "investir mais"],
    resposta:
      "Três condições ao mesmo tempo:\n\n"
      + "1. Margem acima da sua meta (não só positiva).\n"
      + "2. ROAS acima do ideal, não só do break-even.\n"
      + "3. Dependência do Ads relevante — se só 5% da venda vem de anúncio, escalar mexe pouco no total.\n\n"
      + "Faltando qualquer uma, o dinheiro rende mais em outro lugar. E confira o estoque antes: escalar "
      + "anúncio de produto que vai furar em três dias gera venda que você não entrega.",
  },
  {
    id: "ctr-cpc",
    pergunta: "O que são CTR, CPC e conversão?",
    termos: ["ctr", "cpc", "conversao", "clique", "impressao", "metricas", "funil"],
    resposta:
      "São as etapas do funil, e cada uma aponta pra um problema diferente:\n\n"
      + "· CTR (cliques ÷ impressões): quantos que VIRAM clicaram. CTR baixo = o anúncio não chama — "
      + "foto, título ou preço fora do páreo.\n\n"
      + "· CPC (investido ÷ cliques): quanto você paga por visita. CPC alto = concorrência disputando "
      + "a mesma palavra.\n\n"
      + "· Conversão (vendas ÷ cliques): quantos que entraram compraram. Conversão baixa com CTR bom é "
      + "o pior sinal — você paga a visita e perde na página: preço, reputação, prazo, ou descrição.\n\n"
      + "Ordem de investigação: conversão primeiro (é a mais cara), depois CTR, depois CPC.",
  },
  {
    id: "roas-diferente-ml",
    pergunta: "Por que o ROAS daqui é diferente do painel do Mercado Livre?",
    termos: ["diferente", "painel", "mercado livre", "nao bate", "divergencia", "comparar"],
    resposta:
      "Porque medem coisas diferentes, e as duas estão certas:\n\n"
      + "· O painel do ML usa a receita ATRIBUÍDA (direta + assistida), que é maior — então o ROAS dele "
      + "sai mais alto.\n\n"
      + "· Este app usa por padrão a venda DIRETA, que é a conservadora.\n\n"
      + "A tabela mostra os dois lado a lado justamente pra você comparar sem achar que algo quebrou. "
      + "Pra decidir verba, prefira o direto; pra conferir com o ML, use o atribuído.",
  },
  {
    id: "sem-vinculo",
    pergunta: "Por que alguns anúncios aparecem sem margem?",
    termos: ["sem margem", "sem dado", "vinculado", "vinculo", "nao aparece", "faltando"],
    resposta:
      "Porque o anúncio não está ligado a um produto do seu Estoque. Sem essa ligação não há custo pra "
      + "descontar, e sem custo não existe margem — só faturamento.\n\n"
      + "O consultor prefere dizer \"não sei\" a inventar: um anúncio sem custo cadastrado pareceria ter "
      + "100% de margem, e você escalaria justamente o que talvez esteja perdendo dinheiro.\n\n"
      + "Resolve cadastrando o MLB ou o SKU no produto correspondente, na aba Estoque.",
    contextualizar: (c) =>
      c.semVinculo > 0
        ? `Agora: ${c.semVinculo} anúncio(s) sem produto vinculado — eles ficam de fora do cálculo de lucro.`
        : null,
  },
];

/** Sem acento, minúsculo — pra "ROAS" casar com "roas". */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VAZIAS = new Set([
  "o", "a", "os", "as", "de", "do", "da", "e", "em", "no", "na", "um", "uma",
  "que", "qual", "como", "onde", "quando", "por", "para", "pra", "com", "eu",
  "meu", "minha", "me", "se", "faco", "fazer", "posso", "quero", "tem", "ter",
  "isso", "esse", "essa", "sao", "esta", "estao", "ads", "anuncio", "anuncios",
]);

/**
 * Acha os conceitos que respondem a pergunta, do mais relevante pro menos.
 *
 * Casamento de termo inteiro vale mais que prefixo: "roas" na pergunta aponta
 * pro tópico de ROAS com força total, enquanto "ro" não deveria apontar pra
 * lugar nenhum.
 */
export function buscarConceitos(texto: string): TopicoAds[] {
  const t = normalizar(texto);
  if (!t) return [];

  const palavras = t.split(" ").filter((p) => p.length >= 3 && !VAZIAS.has(p));
  if (palavras.length === 0) return [];

  const pontuados = TOPICOS_ADS.map((topico) => {
    let pontos = 0;
    for (const termo of topico.termos) {
      if (t.includes(termo)) {
        /**
         * Termo de duas palavras vale mais que de uma: "roas ideal" é sinal
         * muito mais específico que "roas" solto. Sem esse peso, "qual o roas
         * ideal?" empatava e caía no tópico genérico de ROAS, respondendo a
         * pergunta errada com confiança.
         */
        pontos += termo.includes(" ") ? 4 : 2;
      } else if (palavras.some((p) => termo.startsWith(p) && p.length >= 4)) {
        pontos += 1;
      }
    }
    return { topico, pontos };
  }).filter((x) => x.pontos > 0);

  pontuados.sort((a, b) => b.pontos - a.pontos);
  return pontuados.slice(0, 2).map((x) => x.topico);
}

/** As perguntas mais úteis pra quem abre o consultor sem saber o que perguntar. */
export function conceitosSugeridos(): TopicoAds[] {
  const ids = ["break-even", "roas-ideal", "dependencia"];
  return ids
    .map((id) => TOPICOS_ADS.find((t) => t.id === id))
    .filter((t): t is TopicoAds => !!t);
}
