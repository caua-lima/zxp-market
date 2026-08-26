/**
 * Chat de dúvidas do sistema — "como eu faço X?".
 *
 * ─── POR QUE É SEPARADO DO CONSULTOR DE ADS ─────────────────────────────
 *
 * São duas perguntas de naturezas diferentes, e misturá-las pioraria as duas:
 *
 *   · Consultor de Ads (ads-consultor.ts) responde sobre os SEUS NÚMEROS —
 *     "o que faço com este anúncio?". Depende de dado ao vivo e muda todo dia.
 *   · Este aqui responde sobre o SISTEMA — "onde altero o custo de entrada?".
 *     Não depende de dado nenhum, e a resposta é a mesma sempre.
 *
 * Um chat só teria que decidir a cada pergunta em qual dos dois mundos está,
 * e erraria justamente nas perguntas ambíguas ("como vejo o ROAS?"). Dois
 * chats, cada um no seu lugar, nunca têm essa dúvida.
 *
 * ─── POR QUE SEM IA, DE NOVO ────────────────────────────────────────────
 *
 * Aqui o motivo é ainda mais direto que no de Ads: as respostas são sobre
 * como ESTE app funciona. Um modelo de linguagem não conhece as telas daqui
 * e inventaria caminhos que não existem — "vá em Configurações › Estoque",
 * numa tela que não tem isso. Uma base escrita à mão está sempre certa, é
 * instantânea e não custa nada.
 *
 * Manter isto atualizado é trabalho de quem muda a tela — e é o preço certo a
 * pagar por uma resposta que nunca manda o usuário pro lugar errado.
 */

export type Topico = {
  id: string;
  /** Pergunta como o usuário faria. Vira botão de sugestão. */
  pergunta: string;
  /** Resposta em passos ou parágrafo curto. */
  resposta: string;
  /** Palavras que levam a este tópico. Sem acento, minúsculas. */
  termos: string[];
  /** Aba onde isso acontece — pra sugerir o que é relevante em cada tela. */
  aba?: string;
};

export const TOPICOS: Topico[] = [
  {
    id: "editar-entrada",
    pergunta: "Como altero o custo de uma entrada que lancei errado?",
    aba: "estoque",
    termos: ["alterar", "editar", "corrigir", "entrada", "custo", "compra", "errado", "errei", "movimentacao"],
    resposta:
      "Na aba Estoque, clique no produto pra abrir o painel lateral. Em MOVIMENTAÇÕES, cada linha tem o botão "
      + "Editar — dá pra corrigir data, quantidade, custo unitário e observação.\n\n"
      + "Corrigir o custo recalcula o custo médio do produto inteiro sozinho, e com ele a margem dos pedidos. "
      + "Prefira Editar a excluir e relançar: editar mantém o registro de quem lançou e quando.",
  },
  {
    id: "lancar-compra",
    pergunta: "Como lanço uma compra nova?",
    aba: "estoque",
    termos: ["lancar", "nova", "compra", "entrada", "comprei", "adicionar", "cadastrar"],
    resposta:
      "Aba Estoque › abra o produto › botão ＋ Entrada. Informe quantidade e custo unitário.\n\n"
      + "A entrada é misturada ao que você já tem pra formar o custo médio — por isso o custo de cada compra "
      + "importa mesmo depois, e não só na hora.",
  },
  {
    id: "custo-coleta-full",
    pergunta: "Onde informo o custo da coleta do Full?",
    aba: "full",
    termos: ["coleta", "full", "custo", "remessa", "frete", "envio", "taxa"],
    resposta:
      "Aba Full › painel “Custos de coleta do Full”. Lista todas as coletas; preencha quantas quiser e salve de uma vez.\n\n"
      + "O valor sai do Seller Center em Envios › detalhe do envio › Tarifas › Custo da coleta Full (o marcado como "
      + "estimado serve). O ML não devolve isso pela API, por isso é digitado.\n\n"
      + "Coleta sem custo fica de fora da DRE em vez de contar como R$ 0,00 — contar zero inflaria seu lucro.",
  },
  {
    id: "estoque-minimo",
    pergunta: "Quando recebo aviso pra agendar coleta?",
    aba: "estoque",
    termos: ["aviso", "alerta", "notificacao", "minimo", "25", "agendar", "coleta", "repor", "acabando"],
    resposta:
      "Quando o estoque NO FULL de um anúncio chega a 25 unidades, chega um push no celular.\n\n"
      + "O que está em casa não conta pro limite — é justamente ele que permite agendar a coleta. Se tiver "
      + "estoque em casa, o aviso manda agendar; se não tiver, avisa que precisa comprar antes.\n\n"
      + "O aviso vem uma vez por travessia: não repete enquanto continua baixo, e volta a valer depois que a coleta chega.",
  },
  {
    id: "margem-nao-bate",
    pergunta: "Por que minha margem parece errada?",
    aba: "dashboard",
    termos: ["margem", "errada", "lucro", "nao bate", "diferente", "cmv", "custo medio"],
    resposta:
      "As causas mais comuns, em ordem:\n\n"
      + "1. Produto sem custo cadastrado — o CMV entra zerado e a margem infla. O Dashboard avisa quantos "
      + "pedidos estão sem produto vinculado.\n"
      + "2. Custo de entrada digitado errado — corrija em Estoque › produto › Movimentações › Editar.\n"
      + "3. Coleta do Full sem custo informado — o Resultado líquido fica otimista.",
  },
  {
    id: "faturamento-nao-bate",
    pergunta: "Por que o faturamento não bate com o do Mercado Livre?",
    aba: "dashboard",
    termos: ["faturamento", "nao bate", "diferente", "mercado livre", "seller center", "conferencia", "vendas brutas"],
    resposta:
      "O card certo pra comparar é “Faturamento do ML”, não o “Faturamento bruto”.\n\n"
      + "O bruto inclui cancelados de propósito (pra o cancelamento virar linha própria). O “Faturamento do ML” "
      + "soma de volta os pedidos que o ML cancelou só pra recriar na separação de envio — é assim que o painel "
      + "deles conta.\n\n"
      + "O painel “Conferência com o Mercado Livre”, no Dashboard, mostra as quatro métricas lado a lado.",
  },
  {
    id: "meta-diaria",
    pergunta: "Como a meta diária é calculada?",
    aba: "metas",
    termos: ["meta", "diaria", "dia", "calculo", "hoje", "quanto"],
    resposta:
      "É o que falta pra meta VIGENTE dividido pelos dias que restam no mês (hoje incluso).\n\n"
      + "Ela persegue a meta ativa (1, 2 ou 3) — assim que você bate a Meta 1, o alvo passa a ser a Meta 2, e a "
      + "diária sobe junto. Se um dia fica abaixo, o que sobrou se redistribui e a meta dos dias seguintes sobe sozinha.\n\n"
      + "Usa o acumulado até ontem: senão o alvo cairia conforme as vendas de hoje entrassem.",
  },
  {
    id: "vincular-sku",
    pergunta: "O que é “pedido sem produto vinculado”?",
    aba: "estoque",
    termos: ["vincular", "vinculado", "sku", "mlb", "sem produto", "nao vinculado"],
    resposta:
      "É um pedido cujo anúncio (MLB) não está ligado a nenhum produto do seu Estoque. Sem essa ligação não há "
      + "custo pra descontar, então esse pedido não entra no cálculo de lucro — e a margem geral fica otimista.\n\n"
      + "Resolve cadastrando o MLB ou o SKU no produto correspondente, na aba Estoque.",
  },
  {
    id: "ads-consultor",
    pergunta: "Como sei o que fazer com um anúncio de Ads?",
    aba: "ads",
    termos: ["ads", "anuncio", "consultor", "roas", "desligar", "escalar", "campanha"],
    resposta:
      "Na aba Ads existe o Consultor: pergunte em português (“o que fazer com o Menta Stronger?”) e ele responde "
      + "com os números daquele anúncio e o que fazer.\n\n"
      + "Ele cruza margem com dependência do Ads: um anúncio no vermelho com 8% das vendas vindas de Ads pede "
      + "desligar; o mesmo vermelho com 75% pede corrigir preço antes, porque cortar derrubaria o faturamento.",
  },
  {
    id: "notificacoes",
    pergunta: "Como ativo as notificações no celular?",
    termos: ["notificacao", "push", "celular", "avisar", "ativar", "alerta"],
    resposta:
      "No topo do app tem o sino e o botão de ativar notificações. Aceite a permissão que o navegador pedir.\n\n"
      + "No iPhone só funciona se o app estiver instalado na tela de início (Compartilhar › Adicionar à Tela de Início) — "
      + "é limitação do iOS, que não manda push pra site aberto no Safari.\n\n"
      + "Dá pra escolher quais avisos receber no menu de preferências do sino.",
  },
];

/** Sem acento, minúsculo — pra "Coleta" casar com "coleta". */
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
  "isso", "esse", "essa", "ali", "aqui", "sistema", "app",
]);

/**
 * Acha os tópicos que respondem a pergunta, do mais relevante pro menos.
 *
 * Pontua por quantos termos do tópico aparecem no texto. Empate desempata
 * pela aba atual — a mesma palavra ("custo") significa coisas diferentes em
 * Estoque e em Full, e quem está na tela já disse em qual mundo está.
 */
export function buscarTopicos(texto: string, abaAtual?: string): Topico[] {
  const t = normalizar(texto);
  if (!t) return [];

  const palavras = t.split(" ").filter((p) => p.length >= 3 && !VAZIAS.has(p));
  if (palavras.length === 0) return [];

  const pontuados = TOPICOS.map((topico) => {
    let pontos = 0;
    for (const termo of topico.termos) {
      if (t.includes(termo)) pontos += 2;
      else if (palavras.some((p) => termo.startsWith(p) || p.startsWith(termo))) pontos += 1;
    }
    // A tela em que a pessoa está desempata, mas nunca cria relevância do nada.
    if (pontos > 0 && abaAtual && topico.aba === abaAtual) pontos += 1;
    return { topico, pontos };
  }).filter((x) => x.pontos > 0);

  pontuados.sort((a, b) => b.pontos - a.pontos);
  return pontuados.slice(0, 3).map((x) => x.topico);
}

/** Sugestões pra tela atual, quando o usuário ainda não perguntou nada. */
export function sugestoesPara(aba?: string): Topico[] {
  if (!aba) return TOPICOS.slice(0, 3);
  const daAba = TOPICOS.filter((t) => t.aba === aba);
  // Completa com gerais quando a aba tem poucas — melhor três opções que uma.
  return [...daAba, ...TOPICOS.filter((t) => !t.aba)].slice(0, 3);
}
