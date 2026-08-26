/**
 * Entende a pergunta do vendedor sobre Ads — sem IA, sem chave, sem custo.
 *
 * ─── POR QUE NÃO USAR UM MODELO DE LINGUAGEM ────────────────────────────
 *
 * O pedido era "que seja gratuito". Existem opções de LLM com camada grátis
 * (Gemini Flash, Groq), mas descartá-las aqui não é economia — é a escolha
 * tecnicamente melhor pra ESTE caso:
 *
 * 1. O NÚMERO NÃO PODE SER INVENTADO. É decisão de dinheiro. Um LLM que
 *    escreve "seu ROAS está em 4,2x" quando o real é 2,1x causa prejuízo,
 *    e erra exatamente assim, com confiança. Aqui todo valor citado sai do
 *    cálculo (ads-consultor.ts), nunca de geração de texto.
 * 2. NÃO DEPENDE DE NADA. Sem chave de API, sem cota diária, sem rate
 *    limit, sem cair quando o provedor cai. Responde instantâneo, offline.
 * 3. O DADO NÃO SAI DAQUI. Faturamento, margem e custo por produto são o
 *    núcleo da operação; mandar isso pra um terceiro pra formatar frase é
 *    risco sem contrapartida.
 * 4. O DOMÍNIO É FECHADO. As perguntas úteis sobre Ads são poucas e
 *    conhecidas: "o que faço com X", "me traga os dados de X", "o que está
 *    ruim". Não é conversa aberta — é consulta. Casamento de padrão resolve.
 *
 * O que um LLM traria de verdade é tolerância a frases fora do previsto. Isso
 * é coberto aqui com normalização (acento, caixa) e busca por palavras soltas,
 * que cobre o jeito real de digitar: "menta stronger", "MENTA", "o que fazer
 * com a menta?".
 */

import { buscarConceitos } from "./ads-conhecimento";

export type Intencao =
  | "analisar"        // "o que faço com o menta stronger?"
  | "info"            // "me traga os dados do menta stronger"
  | "listar-ruins"    // "o que está dando prejuízo?"
  | "listar-bons"     // "o que está indo bem?"
  | "resumo"          // "como está o ads no geral?"
  | "conceito"        // "o que é ROAS ideal?" — pergunta de conhecimento
  | "ajuda"           // não entendi / primeira vez
  | "nao-encontrado"; // entendi a intenção, mas não achei o produto

export type Leitura = {
  intencao: Intencao;
  /** Índices dos anúncios que casaram com o texto. Vazio quando não se aplica. */
  alvos: number[];
  /** O trecho que interpretamos como nome do produto — pra tela poder ecoar. */
  termo: string;
};

/** Sem acento, minúsculo, sem pontuação — pra "Menta" casar com "menta". */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palavras que não ajudam a identificar o produto. Sem isto, "o que faço com
 * o menta" tentaria casar "que", "faço", "com" com os títulos e daria match
 * em qualquer coisa.
 */
const VAZIAS = new Set([
  "o", "a", "os", "as", "de", "do", "da", "dos", "das", "e", "ou", "que", "qual",
  "quais", "com", "para", "pra", "por", "no", "na", "nos", "nas", "um", "uma",
  "me", "meu", "minha", "eu", "voce", "ele", "ela", "isso", "esse", "essa",
  "este", "esta", "aquele", "aquela", "seu", "sua", "ads", "anuncio", "anuncios",
  "campanha", "campanhas", "produto", "produtos", "fazer", "faco", "faz", "devo",
  "deveria", "melhor", "sobre", "traga", "trazer", "mostra", "mostrar", "mostre",
  "lista", "listar", "liste", "dados", "info", "informacoes", "informacao",
  "como", "esta", "estao", "ta", "tao", "e", "sao", "no", "em", "dar", "da",
  "quanto", "quantos", "tudo", "todos", "todas", "geral", "vendas", "venda",
]);

/**
 * Marcas de pergunta CONCEITUAL — quem quer entender uma régua, não ver uma
 * lista. "mas" entra porque contrasta ("ótimo MAS dá prejuízo"), que é a cara
 * de quem está confuso com o próprio número.
 */
const RE_CONCEITUAL = /(por que|porque|pq |o que e |o que sao |o que significa|significa|diferenca entre|qual a diferenca|quando vale|quando devo|vale a pena|quanto devo|quanto colocar|como funciona|como escolher|como definir|\bmas\b|^devo )/;

const RE_RUINS = /(prejuiz|perdend|ruim|ruins|pior|piores|negativ|vermelh|queimand|desligar|pausar|cortar)/;
const RE_BONS = /(bom|bons|melhor(?!\s+a\s+se)|melhores|lucrand|lucrativ|positiv|escalar|indo bem|vale a pena)/;
const RE_RESUMO = /(resumo|geral|panorama|visao geral|como esta o ads|situacao|balanco|total)/;
const RE_INFO = /(dado|dados|info|informacao|informacoes|numero|numeros|metrica|metricas|traga|traz|mostra|liste|listar|lista)/;
const RE_ANALISE = /(o que|oque|devo|deveria|recomend|sugest|sugere|melhor a se fazer|vale a pena|faco|fazer|analis|avalia|opinia)/;

/**
 * Casa o texto com os títulos dos anúncios.
 *
 * Exige que TODAS as palavras significativas apareçam no título — "menta
 * stronger" não casa com um "Menta & Cereja" só por causa de "menta". Isso
 * evita a pior falha possível aqui: responder com confiança sobre o produto
 * errado.
 */
export function casarAnuncios(texto: string, titulos: string[]): number[] {
  const palavras = normalizar(texto)
    .split(" ")
    .filter((p) => p.length >= 3 && !VAZIAS.has(p));
  if (palavras.length === 0) return [];

  const alvos: number[] = [];
  titulos.forEach((titulo, i) => {
    const t = normalizar(titulo);
    if (palavras.every((p) => t.includes(p))) alvos.push(i);
  });

  /**
   * Nada casou com todas as palavras: tenta a mais longa sozinha. Cobre
   * "stronger 50" quando o título é "Stronger 50un" — mas só quando a
   * palavra é específica o bastante (5+ letras) pra não casar com meio
   * catálogo.
   */
  if (alvos.length === 0) {
    const maior = [...palavras].sort((a, b) => b.length - a.length)[0];
    if (maior && maior.length >= 5) {
      titulos.forEach((titulo, i) => {
        if (normalizar(titulo).includes(maior)) alvos.push(i);
      });
    }
  }
  return alvos;
}

export function interpretarPergunta(texto: string, titulos: string[]): Leitura {
  const t = normalizar(texto);
  if (!t) return { intencao: "ajuda", alvos: [], termo: "" };

  /**
   * PERGUNTA DE ENTENDIMENTO vem antes da varredura.
   *
   * "o que está dando prejuízo?" é varredura. "meu ROAS está ótimo mas dá
   * prejuízo, por quê?" é conceito — e as duas contêm a palavra "prejuízo".
   * Sem esta checagem, a segunda recebia uma LISTA de anúncios ruins quando o
   * que se pediu foi uma explicação.
   *
   * O que separa é a marca de entendimento ("por quê", "o que é", "quando
   * vale", "quanto devo"). Só desvia quando existe conceito que responda —
   * senão a varredura continua sendo a melhor resposta.
   */
  if (RE_CONCEITUAL.test(t) && buscarConceitos(texto).length > 0) {
    return { intencao: "conceito", alvos: [], termo: "" };
  }

  // Coletivas: "o que está dando prejuízo" tem "o que", mas não é sobre um
  // anúncio específico — é uma varredura.
  if (RE_RUINS.test(t)) return { intencao: "listar-ruins", alvos: [], termo: "" };
  if (RE_BONS.test(t)) return { intencao: "listar-bons", alvos: [], termo: "" };
  if (RE_RESUMO.test(t)) return { intencao: "resumo", alvos: [], termo: "" };

  const alvos = casarAnuncios(texto, titulos);
  const termo = normalizar(texto)
    .split(" ")
    .filter((p) => p.length >= 3 && !VAZIAS.has(p))
    .join(" ");

  if (alvos.length === 0) {
    /**
     * Nenhum anúncio casou. Antes de desistir, tenta responder como CONCEITO
     * ("o que é ROAS ideal?") — ver ads-conhecimento.ts.
     *
     * Vem depois do casamento por produto de propósito: "o que faço com o
     * Menta Stronger" tem a palavra "faço", que também aparece em perguntas
     * conceituais. Produto é mais específico, então ganha.
     */
    if (buscarConceitos(texto).length > 0) {
      return { intencao: "conceito", alvos: [], termo };
    }
    // Sabemos que ele quer algo de um produto, mas não achamos qual.
    if (RE_ANALISE.test(t) || RE_INFO.test(t)) {
      return { intencao: "nao-encontrado", alvos: [], termo };
    }
    return { intencao: "ajuda", alvos: [], termo };
  }

  // "me traga os dados" pede números; "o que eu faço" pede recomendação.
  // Análise ganha no empate: é a pergunta mais útil, e a resposta dela já
  // inclui os números.
  if (RE_ANALISE.test(t)) return { intencao: "analisar", alvos, termo };
  if (RE_INFO.test(t)) return { intencao: "info", alvos, termo };

  // Só o nome do produto, sem verbo: trata como análise.
  return { intencao: "analisar", alvos, termo };
}
