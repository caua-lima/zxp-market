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
  /** Conceitos que costumam vir na sequência — ver relacionadosDe. */
  relacionados?: string[];
};

import { melhores, normalizar as normalizarTexto } from "./busca-texto";

/** Reexporta pra quem já importava daqui — a implementação mora no motor. */
export const normalizar = normalizarTexto;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const x = (v: number) => `${v.toFixed(2).replace(".", ",")}x`;
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

export const TOPICOS_ADS: TopicoAds[] = [
  {
    id: "roas",
    relacionados: ["break-even", "roas-ideal"],
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
    relacionados: ["roas-ideal", "roas-alto-prejuizo"],
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
    relacionados: ["break-even", "orcamento"],
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
    relacionados: ["roas", "dependencia"],
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
    relacionados: ["roas-diferente-ml"],
    pergunta: "Qual a diferença entre venda direta e atribuída?",
    termos: [
      "venda assistida", "venda indireta", "direta", "assistida", "indireta",
      "atribuida", "atribuicao", "clique",
    ],
    resposta:
      "DIRETA: o comprador clicou no anúncio pago e comprou AQUELE produto. Rastro claro.\n\n"
      + "ASSISTIDA (o ML chama de indireta): ele clicou no seu anúncio, não comprou aquele item, mas "
      + "dentro da janela de 14 dias comprou OUTRO produto seu. O ML credita essa venda à publicidade.\n\n"
      + "O painel do Mercado Ads soma as duas em \"vendas atribuídas\", o que deixa o ROAS mais bonito. "
      + "Este app mostra as duas separadas e usa a DIRETA como padrão, porque é a conservadora: se você "
      + "for errar, é melhor errar achando que ganhou menos.\n\n"
      + "A assistida não é mentira — parte dela é real. Mas ela também credita ao anúncio venda que "
      + "aconteceria de qualquer jeito.",
  },
  {
    id: "roas-alto-prejuizo",
    relacionados: ["break-even", "dependencia"],
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
    relacionados: ["roas-alto-prejuizo", "quando-escalar"],
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
    relacionados: ["quando-escalar", "roas-ideal"],
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
    relacionados: ["orcamento", "roas-ideal"],
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
    relacionados: ["dependencia"],
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
    // "nao aparece" saiu daqui: era ambíguo com o tópico do anúncio que não
    // recebe impressão, e os dois empatavam — o desempate virava a ordem do
    // array. Aqui o que não aparece é a MARGEM, e os termos dizem isso.
    termos: [
      "sem margem", "margem nao aparece", "sem dado", "vinculado", "vinculo",
      "faltando custo", "nao calcula",
    ],
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
  {
    id: "roas-objetivo",
    relacionados: ["aprendizado", "estrategias-campanha", "break-even"],
    pergunta: "Como funciona o ROAS objetivo da campanha?",
    termos: [
      "roas objetivo", "roas alvo", "objetivo", "configurar roas", "mudar roas",
      "subir roas", "baixar roas", "leilao", "algoritmo",
    ],
    resposta:
      "O ROAS objetivo substituiu o ACOS objetivo em outubro de 2025. É o retorno que você diz esperar "
      + "de cada real investido, e o algoritmo do ML usa isso como acelerador no leilão.\n\n"
      + "ROAS objetivo BAIXO = agressivo. O ML dá mais lances, você aparece mais e gasta mais. "
      + "Se o anúncio não converte bem, isso vira clique caro sem venda.\n\n"
      + "ROAS objetivo ALTO = conservador. O ML só disputa as buscas em que acredita converter, "
      + "você aparece menos e cada venda sai mais lucrativa.\n\n"
      + "Faixas de referência do mercado: abaixo de 5x prioriza volume; 5x a 10x equilibra; "
      + "acima de 10x prioriza rentabilidade. Mas o número que importa é o SEU break-even — "
      + "qualquer alvo abaixo dele só acelera prejuízo, por mais 'agressivo' que pareça certo.",
    contextualizar: (c) =>
      c.roasIdealMedio != null
        ? `Pelos seus custos, o alvo que entrega a margem de ${pct(c.metaMargem)} é ${x(c.roasIdealMedio)} em média.`
        : null,
  },
  {
    id: "aprendizado",
    relacionados: ["roas-objetivo", "orcamento"],
    pergunta: "Mexi na campanha e piorou. É normal?",
    termos: [
      "aprendizado", "piorou", "mexi", "alterei", "mudei", "reiniciar", "instavel",
      "oscilou", "caiu depois", "quanto tempo", "esperar",
    ],
    resposta:
      "Sim, e é esperado. Toda alteração de ROAS objetivo ou orçamento REINICIA a otimização, e o "
      + "algoritmo leva de 3 a 5 dias reaprendendo. Nesse período os números oscilam e não valem "
      + "como avaliação.\n\n"
      + "O erro mais caro em Ads é mexer de novo no meio do aprendizado: você nunca chega a ver o "
      + "resultado de mudança nenhuma, e cada ajuste zera o anterior. Vira um ciclo em que a campanha "
      + "está sempre reaprendendo e nunca performando.\n\n"
      + "Regra prática: mudou, espera 5 dias completos antes de julgar. Se precisar mexer antes, é "
      + "porque o gasto está fora de controle — aí reduza orçamento, que é reversível, em vez de "
      + "mexer no alvo.",
  },
  {
    id: "estrategias-campanha",
    relacionados: ["roas-objetivo", "quando-escalar"],
    pergunta: "Qual estratégia de campanha devo usar?",
    termos: [
      "estrategia", "tipo de campanha", "visibilidade", "crescimento", "rentabilidade",
      "qual campanha", "criar campanha",
    ],
    resposta:
      "O Product Ads tem três estratégias, e cada uma serve a um momento do produto:\n\n"
      + "· VISIBILIDADE — produto novo ou categoria muito disputada, quando o problema é ninguém "
      + "te ver. ROAS objetivo mais baixo (referência 4x a 6,7x). Aceita margem menor pra ganhar posição.\n\n"
      + "· CRESCIMENTO — produto de rotação média que já vende, mas pode vender mais. É o meio-termo.\n\n"
      + "· RENTABILIDADE — produto que JÁ vende bem e já aparece nas primeiras posições orgânicas. "
      + "ROAS objetivo alto (referência 10x a 20x), porque aqui o anúncio não precisa criar a venda, "
      + "só defender a posição.\n\n"
      + "O erro comum é usar Visibilidade em produto que já vende: você paga caro por clique que "
      + "viria de graça no orgânico.",
  },
  {
    id: "janela-atribuicao",
    relacionados: ["direta-assistida", "roas-diferente-ml"],
    pergunta: "Vendi hoje mas o Ads não mostrou. Por quê?",
    // "nao aparece" saiu: colidia com o tópico do anúncio sem impressão, e os
    // dois empatavam em 4 pontos — o desempate virava a ordem do array. Aqui o
    // que demora a aparecer é a VENDA no relatório, não o anúncio na busca.
    termos: [
      "janela", "atribuicao", "14 dias", "nao mostrou", "nao contou",
      "demora aparecer", "atrasado", "conta depois", "mudou depois",
    ],
    resposta:
      "O Mercado Ads atribui a venda ao DIA DO CLIQUE, não ao dia da compra, e a janela de atribuição "
      + "é de 14 dias.\n\n"
      + "Consequência prática: uma venda de hoje pode ser creditada a um clique de cinco dias atrás, e "
      + "o número de ontem pode mudar depois que você já olhou. Isso não é erro do painel nem deste "
      + "app — é como a atribuição funciona.\n\n"
      + "Por isso período curto engana: um único dia tem clique cuja venda ainda não aconteceu e venda "
      + "cujo clique foi antes da janela. Avalie campanha em 14 dias ou mais, nunca em 24 horas.",
  },
  {
    id: "aparece-pouco",
    relacionados: ["roas-objetivo", "orcamento", "ctr-cpc"],
    pergunta: "Meu anúncio quase não aparece. O que fazer?",
    termos: [
      "nao aparece", "anuncio nao aparece", "pouca impressao", "poucas impressoes",
      "sem impressao", "invisivel", "nao roda", "nao gasta", "sobra orcamento",
    ],
    resposta:
      "Impressão baixa quase sempre é uma destas quatro, nesta ordem de frequência:\n\n"
      + "1. ROAS objetivo alto demais — você pediu retorno que o ML não acha viável, então ele para "
      + "de disputar. É a causa mais comum e a menos óbvia.\n"
      + "2. Orçamento diário baixo — acaba cedo e o anúncio some no resto do dia.\n"
      + "3. Anúncio perdendo o leilão — preço, reputação ou prazo pior que o do concorrente.\n"
      + "4. Campanha pausada ou anúncio sem estoque.\n\n"
      + "Sinal claro de que é a nº 1: orçamento sobrando no fim do dia. Se você reservou verba e ela "
      + "não foi gasta, o problema não é dinheiro — é o alvo.",
  },
  {
    id: "produto-barato",
    relacionados: ["break-even", "roas-alto-prejuizo"],
    pergunta: "Por que produto barato quase não deixa margem?",
    termos: [
      "produto barato", "ticket baixo", "margem fina", "pouco lucro", "19 reais",
      "produto de baixo valor", "nao compensa", "custo fixo",
    ],
    resposta:
      "Porque no Mercado Livre boa parte do custo NÃO é proporcional ao preço.\n\n"
      + "A comissão é percentual (10–14% no Clássico, 15–19% no Premium), mas o frete e o custo "
      + "operacional são quase fixos por unidade. Num produto de R$ 19, dois reais de frete já são "
      + "10% do preço; no mesmo produto vendido a R$ 79, seriam 2,5%.\n\n"
      + "Some a isso o frete grátis, que desde junho de 2025 vale a partir de R$ 19 — a faixa em que "
      + "muito produto barato está — e o subsídio do ML depende da sua reputação.\n\n"
      + "É por isso que aumentar o preço costuma render mais que cortar custo em item barato: o ganho "
      + "de preço é inteiro seu, enquanto o corte de custo esbarra em taxa que não desce. E é por isso "
      + "que vender em KIT muda o jogo — dilui o custo fixo por unidade.",
  },
  {
    id: "canibalizar-organico",
    relacionados: ["dependencia", "acos-tacos"],
    pergunta: "O Ads está roubando venda que eu teria de graça?",
    termos: [
      "canibaliz", "organico", "roubando", "teria vendido", "de graca", "sem anuncio",
      "vale a pena anunciar", "ja vendo bem",
    ],
    resposta:
      "É o risco real de anunciar produto que já está bem posicionado no orgânico: parte do clique "
      + "pago viria de graça, e você passa a pagar por venda que já era sua.\n\n"
      + "O sintoma é TACOS subindo com ACOS estável. A campanha continua parecendo boa (ACOS bom), "
      + "mas o peso do anúncio na receita total cresce — sinal de que o pago está substituindo o "
      + "orgânico em vez de somar.\n\n"
      + "O teste honesto: pause o anúncio por 7 a 14 dias e olhe a venda TOTAL do produto, não a "
      + "atribuída. Se cair pouco, o Ads estava canibalizando. Se cair muito, ele estava sustentando "
      + "mesmo. É o único jeito de saber, porque nenhum relatório separa isso pra você.",
  },
];

/**
 * Acha os conceitos que respondem a pergunta.
 *
 * A pontuação, os pesos e a tolerância a erro de digitação vivem em
 * busca-texto.ts, compartilhadas com o chat de dúvidas. Antes eram duas
 * cópias quase iguais — e a correção de peso pra termo composto foi feita só
 * aqui, deixando o outro chat errando o mesmo caso.
 */
export function buscarConceitos(texto: string): TopicoAds[] {
  return melhores(texto, TOPICOS_ADS, 2);
}

/** As perguntas mais úteis pra quem abre o consultor sem saber o que perguntar. */
/** Os conceitos ligados a este, pra oferecer o próximo passo. */
export function relacionadosDe(topico: TopicoAds): TopicoAds[] {
  return (topico.relacionados ?? [])
    .map((id) => TOPICOS_ADS.find((t) => t.id === id))
    .filter((t): t is TopicoAds => !!t);
}

export function conceitosSugeridos(): TopicoAds[] {
  const ids = ["break-even", "roas-ideal", "dependencia"];
  return ids
    .map((id) => TOPICOS_ADS.find((t) => t.id === id))
    .filter((t): t is TopicoAds => !!t);
}
