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

import { melhores, normalizar as normalizarTexto } from "./busca-texto";

/** Reexporta pra quem já importava daqui — a implementação mora no motor. */
export const normalizar = normalizarTexto;

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
  /**
   * Ids de tópicos que costumam vir na sequência.
   *
   * Quem pergunta "como informo o custo da coleta" quase sempre pergunta
   * depois "por que meu resultado está otimista" — são a mesma dúvida em dois
   * momentos. Oferecer o próximo passo evita a segunda pergunta.
   */
  relacionados?: string[];
};

export const TOPICOS: Topico[] = [
  {
    id: "editar-entrada",
    relacionados: ["lancar-compra", "margem-nao-bate"],
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
    relacionados: ["editar-entrada", "vincular-sku"],
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
    relacionados: ["dre", "envio-full"],
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
    relacionados: ["envio-full", "notificacoes"],
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
    relacionados: ["vincular-sku", "editar-entrada", "custo-coleta-full"],
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
    relacionados: ["devolucao"],
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
    relacionados: ["metas-configurar"],
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
    relacionados: ["margem-nao-bate", "lancar-compra"],
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
    relacionados: ["margem-nao-bate"],
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
    relacionados: ["instalar-celular", "estoque-minimo"],
    pergunta: "Como ativo as notificações no celular?",
    // "não chega" é como a pessoa relata o problema — vale mais que a palavra
    // solta "notificação", que também aparece no tópico de estoque mínimo.
    termos: [
      "nao chega", "nao chegam", "nao recebo", "notificacao", "push",
      "celular", "avisar", "ativar", "permissao",
    ],
    resposta:
      "No topo do app tem o sino e o botão de ativar notificações. Aceite a permissão que o navegador pedir.\n\n"
      + "No iPhone só funciona se o app estiver instalado na tela de início (Compartilhar › Adicionar à Tela de Início) — "
      + "é limitação do iOS, que não manda push pra site aberto no Safari.\n\n"
      + "Dá pra escolher quais avisos receber no menu de preferências do sino.",
  },
  {
    id: "conectar-ml",
    pergunta: "Como conecto minha conta do Mercado Livre?",
    aba: "dashboard",
    termos: ["conectar", "conexao", "vincular conta", "autorizar", "mercado livre", "login ml", "desconectou"],
    resposta:
      "No topo do app tem o botão de conexão com o Mercado Livre. Ele leva pro site do ML, você autoriza, e volta pronto.\n\n"
      + "Só o dono da operação pode conectar — a conta do ML é da loja inteira, e trocá-la muda a origem dos números de todo mundo do time.\n\n"
      + "Se aparecer que desconectou, é quase sempre o token expirado: reconecte pelo mesmo botão. Os dados já sincronizados não se perdem.",
    relacionados: ["dados-desatualizados"],
  },
  {
    id: "dados-desatualizados",
    pergunta: "Os números estão desatualizados. Como forço a atualização?",
    aba: "dashboard",
    termos: ["atualizar", "desatualizado", "sincronizar", "sync", "antigo", "nao atualiza", "forcar"],
    resposta:
      "O botão “Atualizar ML” no topo do Dashboard busca tudo de novo, ignorando o cache.\n\n"
      + "O app guarda a resposta por alguns minutos pra não estourar o limite de chamadas do Mercado Livre — por isso um número pode demorar a mudar. O botão pula esse cache.\n\n"
      + "Vendas novas entram sozinhas pelo webhook, em segundos. Frete e repasse só fecham depois que o ML processa o envio, então esses demoram mais.",
    relacionados: ["conectar-ml"],
  },
  {
    id: "envio-full",
    pergunta: "Como registro um envio pro Full?",
    aba: "full",
    termos: ["envio", "enviar", "remessa", "mandar", "full", "coleta", "baixa"],
    resposta:
      "A aba Full lista as remessas que o ML recebeu. Quando uma chega, dê a baixa ali — isso tira as unidades do seu estoque em casa e passa pro Full.\n\n"
      + "O app não cria a remessa; ele lê o que o Mercado Livre já registrou. Você agenda a coleta no Seller Center normalmente, e ela aparece aqui depois.",
    relacionados: ["custo-coleta-full", "estoque-minimo"],
  },
  {
    id: "dre",
    pergunta: "O que a aba DRE mostra?",
    aba: "dre",
    termos: ["dre", "resultado", "demonstrativo", "lucro do mes", "custos operacionais", "contabil"],
    resposta:
      "A DRE é o resultado do período com TUDO descontado: custo do produto, frete, taxas do ML, imposto, publicidade e os custos operacionais que você cadastrou em Custos.\n\n"
      + "É a visão que responde “sobrou quanto no fim do mês”, diferente do Dashboard, que responde “como estão as vendas”.\n\n"
      + "Se o Resultado líquido parecer otimista, quase sempre falta informar o custo de alguma coleta do Full.",
    relacionados: ["custo-coleta-full", "custos-operacionais"],
  },
  {
    id: "custos-operacionais",
    pergunta: "Como cadastro custos fixos, tipo contabilidade?",
    aba: "custos",
    termos: ["custo fixo", "operacional", "mensal", "contabilidade", "despesa", "cadastrar custo", "recorrente"],
    resposta:
      "Aba Custos › adicione o custo com nome, valor e frequência (diário, mensal, anual ou avulso).\n\n"
      + "“Onde desconta” decide se ele entra só na DRE ou também no lucro do dia. Custo de estrutura (contabilidade, aluguel) costuma ficar só na DRE.\n\n"
      + "Dá pra arquivar um custo que acabou, em vez de excluir — assim os meses passados continuam corretos.",
    relacionados: ["dre"],
  },
  {
    id: "preco",
    pergunta: "Como sei se meu preço está certo?",
    aba: "preco",
    termos: ["preco", "precificar", "simular", "quanto cobrar", "aumentar preco", "margem alvo"],
    resposta:
      "A aba Preço simula: você informa o preço e ela mostra o que sobra depois de custo, frete, comissão e imposto.\n\n"
      + "Serve pros dois lados — testar um preço novo antes de mexer no anúncio, e entender por que um produto atual não fecha.\n\n"
      + "Lembre que a comissão do ML muda por faixa de preço, então um aumento pequeno às vezes rende mais do que parece.",
    relacionados: ["margem-nao-bate"],
  },
  {
    id: "colaborador",
    pergunta: "Como dou acesso pra outra pessoa?",
    aba: "acesso",
    termos: ["colaborador", "acesso", "convidar", "equipe", "time", "outra pessoa", "permissao", "socio"],
    resposta:
      "Aba Acesso › adicione o e-mail da pessoa e escolha o papel.\n\n"
      + "Colaborador é somente-leitura por padrão. Você libera edição por aba — dá pra deixar alguém mexer só em Estoque, por exemplo, sem acesso a Custos.\n\n"
      + "Toda alteração fica registrada com quem fez e quando, na trilha de auditoria.",
    relacionados: [],
  },
  {
    id: "tarefas",
    pergunta: "Pra que serve a aba Tarefas?",
    aba: "tarefas",
    termos: ["tarefa", "kanban", "lembrete", "pendencia", "to do", "organizar"],
    resposta:
      "É um quadro simples pra o que precisa ser feito na operação — repor estoque, responder pergunta, revisar anúncio.\n\n"
      + "Owner e colaborador escrevem igual: um atribui tarefa pro outro. Tarefa com prazo vencido vira aviso no Dashboard.",
    relacionados: [],
  },
  {
    id: "metas-configurar",
    pergunta: "Como configuro minhas metas do mês?",
    aba: "metas",
    // Formas que as pessoas de fato digitam. Conjugação de verbo em português
    // é irregular demais pra um stemmer automático não criar casamento falso —
    // listar as variantes reais é mais previsível e não erra.
    termos: [
      "metas do mes", "configurar meta", "configuro meta", "cadastrar meta",
      "definir meta", "criar meta", "meta 1", "meta 2", "meta 3", "objetivo",
    ],
    resposta:
      "Aba Metas › defina até três metas de faturamento pro mês.\n\n"
      + "Elas funcionam como degraus: quando você bate a Meta 1, o alvo passa a ser a Meta 2 automaticamente, e a meta diária se recalcula sozinha.\n\n"
      + "Use a Meta 1 como o mínimo que paga a operação, e as outras como esticada — assim o painel sempre mostra um alvo que ainda faz sentido perseguir.",
    relacionados: ["meta-diaria"],
  },
  {
    id: "reputacao",
    pergunta: "Como acompanho minha reputação no ML?",
    aba: "desempenho",
    termos: ["reputacao", "mercado lider", "termometro", "cancelamento", "reclamacao", "atraso", "medalha"],
    resposta:
      "Aba Desempenho › o painel espelha o do Seller Center: cancelamentos, reclamações e atrasos, com o limite de cada um.\n\n"
      + "Também mostra quanto falta pra MercadoLíder, com a conta dos últimos 60 dias — vendas, faturamento e as métricas que o ML exige.\n\n"
      + "Quando você sobe de nível, chega uma notificação.",
    relacionados: ["notificacoes"],
  },
  {
    id: "devolucao",
    pergunta: "Como as devoluções entram na conta?",
    aba: "pedidos",
    termos: ["devolucao", "devolvido", "estorno", "reembolso", "cancelado", "retorno produto"],
    resposta:
      "Devolução concluída sai do faturamento líquido e do lucro — o produto voltou, a venda não aconteceu.\n\n"
      + "Cancelamento é diferente: o estoque nem saiu. Os dois aparecem separados no Dashboard justamente porque exigem ações diferentes.\n\n"
      + "O “Faturamento bruto” inclui os dois de propósito, pra você enxergar o tamanho da perda.",
    relacionados: ["faturamento-nao-bate"],
  },
  {
    id: "exportar",
    pergunta: "Consigo exportar os dados?",
    termos: ["exportar", "csv", "planilha", "excel", "baixar", "download", "relatorio"],
    resposta:
      "A aba Ads exporta a tabela de anúncios em CSV, com todas as colunas visíveis e os filtros aplicados.\n\n"
      + "Nas outras telas ainda não há exportação. Se precisar de alguma específica, dá pra adicionar.",
    relacionados: [],
  },
  {
    id: "instalar-celular",
    pergunta: "Como instalo o app no celular?",
    termos: ["instalar", "celular", "app", "icone", "tela inicial", "pwa", "iphone", "android"],
    resposta:
      "É um site que funciona como app. No iPhone: Safari › Compartilhar › Adicionar à Tela de Início. No Android: menu do Chrome › Instalar aplicativo.\n\n"
      + "No iPhone isso não é opcional se você quer notificação: o iOS só manda push pra site instalado na tela de início.",
    relacionados: ["notificacoes"],
  },
  {
    id: "taxas-ml",
    pergunta: "Como funcionam as taxas do Mercado Livre?",
    aba: "preco",
    relacionados: ["preco", "margem-nao-bate"],
    // "taxas do mercado livre" precisa estar aqui como expressão: sem ela, a
    // pergunta caía no tópico de faturamento, que tem "mercado livre" e vence
    // por peso de termo composto.
    termos: [
      "taxas do mercado livre", "taxa do ml", "taxa", "taxas", "comissao",
      "tarifa", "quanto o ml cobra", "classico", "premium", "custo fixo",
    ],
    resposta:
      "São três cobranças diferentes, e confundi-las é o que faz a conta não fechar:\n\n"
      + "1. COMISSÃO — percentual sobre o valor, varia por categoria e tipo de anúncio. "
      + "Clássico fica na faixa de 10% a 14%; Premium, 15% a 19%, e em troca oferece parcelamento "
      + "sem juros e mais exposição.\n\n"
      + "2. CUSTO OPERACIONAL — cobrado em produto abaixo de R$ 79. Desde março de 2026 deixou de ser "
      + "valor fixo e passou a variar por peso, dimensão e preço. Acima de R$ 79 não existe.\n\n"
      + "3. FRETE — desde junho de 2025 o frete grátis vale a partir de R$ 19. Acima de R$ 79 ele "
      + "deixa de ser opcional. O ML subsidia parte conforme sua reputação: verde escuro paga bem "
      + "menos que amarelo.\n\n"
      + "O app usa a taxa REAL que veio no pedido, não uma tabela — então o que aparece aqui já é o "
      + "que o ML cobrou de fato naquela venda.",
  },
  {
    id: "margem-fina-produto-barato",
    pergunta: "Por que meus produtos baratos deixam tão pouco?",
    aba: "preco",
    relacionados: ["taxas-ml", "preco", "margem-nao-bate"],
    termos: [
      "produto barato", "ticket baixo", "margem fina", "pouco lucro", "nao compensa",
      "quase nao sobra", "margem baixa", "kit",
    ],
    resposta:
      "Porque boa parte do custo do ML não acompanha o preço.\n\n"
      + "A comissão é percentual, mas frete e custo operacional são quase fixos por unidade. "
      + "R$ 2 de frete num produto de R$ 19 é 10% do preço; no mesmo produto a R$ 79, seria 2,5%. "
      + "O produto barato paga proporcionalmente muito mais.\n\n"
      + "Três saídas, em ordem de eficácia:\n"
      + "· VENDER EM KIT — dilui frete e custo operacional por unidade. É a que mais muda o resultado.\n"
      + "· SUBIR O PREÇO — o ganho é inteiro seu, enquanto cortar custo esbarra em taxa que não desce.\n"
      + "· REVISAR O CUSTO na origem — só compensa quando há volume pra negociar.\n\n"
      + "Use a aba Preço pra simular antes de mexer no anúncio.",
  },
  {
    id: "custo-medio",
    pergunta: "Como o custo médio é calculado?",
    aba: "estoque",
    relacionados: ["editar-entrada", "lancar-compra", "margem-nao-bate"],
    termos: [
      "custo medio", "media", "como calcula", "por que mudou", "custo do produto",
      "cmv", "ponderado",
    ],
    resposta:
      "É média ponderada de todas as entradas: cada compra entra pela quantidade e pelo preço que "
      + "você pagou, e o custo médio é o total gasto dividido pelo total de unidades.\n\n"
      + "Consequência importante: uma compra nova com preço diferente MUDA o custo médio de todo o "
      + "estoque, não só das unidades novas. Se você comprou mais caro, a margem dos produtos que já "
      + "estavam lá também cai — e isso é o certo, porque repor vai custar o preço novo.\n\n"
      + "O custo usado em cada pedido é o que valia NA DATA da venda. Corrigir uma entrada antiga "
      + "recalcula tudo dali pra frente sozinho.",
  },
  {
    id: "cancelado-vs-devolvido",
    pergunta: "Qual a diferença entre cancelado e devolvido?",
    aba: "pedidos",
    relacionados: ["devolucao", "faturamento-nao-bate"],
    termos: [
      "cancelado", "devolvido", "diferenca", "cancelamento", "estorno",
      "nao contou", "sumiu do lucro",
    ],
    resposta:
      "CANCELADO: a venda não chegou a acontecer — o estoque nem saiu. Não gera custo nem lucro.\n\n"
      + "DEVOLVIDO: a venda aconteceu e foi revertida. O produto volta pro estoque, e o resultado é "
      + "zero a zero: nem receita nem custo ficam.\n\n"
      + "Os dois aparecem no Faturamento bruto de propósito, pra você ver o tamanho da perda, mas "
      + "saem do faturamento líquido e do cálculo de margem. Por isso o bruto nunca serve de base "
      + "pra margem — ele inclui venda que não existiu.",
  },
  {
    id: "separacao-envio",
    pergunta: "Por que um pedido virou vários?",
    aba: "pedidos",
    relacionados: ["faturamento-nao-bate", "cancelado-vs-devolvido"],
    termos: [
      "virou varios", "dividiu", "separacao", "separou", "pacote", "pack",
      "mesmo pedido", "duplicado", "repetido",
    ],
    resposta:
      "Quando o Mercado Livre separa o envio na agência, ele CANCELA o pedido original e cria "
      + "pedidos novos no lugar. É uma venda só que vira várias linhas.\n\n"
      + "O app detecta isso e não conta o original como venda perdida — senão o cancelamento e o "
      + "faturamento apareceriam inflados ao mesmo tempo.\n\n"
      + "Também é por isso que o frete é rateado por ENVIO e não por pedido: vários pedidos podem "
      + "compartilhar um envio só, e somar o frete de cada um contaria o mesmo custo várias vezes.",
  },
  {
    id: "imposto",
    pergunta: "Como configuro o imposto dos produtos?",
    aba: "estoque",
    relacionados: ["custo-medio", "preco"],
    termos: [
      "imposto", "aliquota", "tributo", "simples", "porcentagem imposto",
      "configurar imposto", "nota fiscal",
    ],
    resposta:
      "O imposto é por produto, em percentual sobre o valor da venda, e fica no cadastro do produto "
      + "na aba Estoque.\n\n"
      + "Ele entra no cálculo de lucro de cada pedido usando a alíquota que valia NA DATA da venda. "
      + "Mudar a alíquota hoje não reescreve o lucro de meses fechados — o que já passou fica com a "
      + "alíquota da época, que é o comportamento contábil correto.\n\n"
      + "Se você não sabe qual usar, confirme com seu contador: varia por regime e por produto.",
  },
];

/**
 * Acha os tópicos que respondem a pergunta.
 *
 * A pontuação e a tolerância a erro de digitação vivem em busca-texto.ts,
 * compartilhadas com o consultor de Ads. Aqui fica só o que é específico
 * desta base: o desempate pela aba em que a pessoa está.
 */
export function buscarTopicos(texto: string, abaAtual?: string): Topico[] {
  const achados = melhores(texto, TOPICOS, 3);
  if (!abaAtual || achados.length < 2) return achados;

  /**
   * A mesma palavra quer dizer coisas diferentes em telas diferentes:
   * "custo" no Full é a coleta, no Estoque é a entrada. Quem está na tela já
   * disse em qual mundo está — então o tópico daquela aba sobe.
   *
   * Só reordena o que a busca JÁ considerou relevante: a aba nunca cria
   * relevância do nada, senão estar no Full faria qualquer pergunta virar
   * pergunta sobre coleta.
   */
  const daAba = achados.filter((t) => t.aba === abaAtual);
  const resto = achados.filter((t) => t.aba !== abaAtual);
  return [...daAba, ...resto];
}

/** Os tópicos ligados a este, pra oferecer o próximo passo. */
export function relacionadosDe(topico: Topico): Topico[] {
  return (topico.relacionados ?? [])
    .map((id) => TOPICOS.find((t) => t.id === id))
    .filter((t): t is Topico => !!t);
}

/** Sugestões pra tela atual, quando o usuário ainda não perguntou nada. */
export function sugestoesPara(aba?: string): Topico[] {
  if (!aba) return TOPICOS.slice(0, 3);
  const daAba = TOPICOS.filter((t) => t.aba === aba);
  // Completa com gerais quando a aba tem poucas — melhor três opções que uma.
  return [...daAba, ...TOPICOS.filter((t) => !t.aba)].slice(0, 3);
}
