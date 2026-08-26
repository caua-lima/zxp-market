/**
 * O motor de busca dos dois chats — dúvidas do sistema e consultor de Ads.
 *
 * ─── POR QUE UM SÓ ──────────────────────────────────────────────────────
 *
 * `ajuda.ts` e `ads-conhecimento.ts` tinham cada um a sua cópia de
 * normalizar + palavras vazias + pontuação. Eram quase iguais, e "quase" é o
 * problema: a correção de peso pra termo composto foi feita só no de Ads, e o
 * de dúvidas continuou errando o mesmo caso por dias. Duas cópias de uma
 * regra divergem na primeira melhoria.
 *
 * ─── O QUE ELE FAZ QUE AS CÓPIAS NÃO FAZIAM ─────────────────────────────
 *
 * 1. TOLERA ERRO DE DIGITAÇÃO. "extoque", "custu", "cobrança" — quem digita
 *    no celular, com pressa, erra. Antes qualquer letra trocada devolvia
 *    "não sei", que é a pior resposta possível pra uma pergunta que a base
 *    sabe responder.
 * 2. PESA TERMO COMPOSTO. "roas ideal" é sinal muito mais específico que
 *    "roas" solto, e precisa ganhar do genérico.
 * 3. EXIGE MARGEM PRA DESEMPATAR. Dois tópicos com pontuação colada querem
 *    dizer que a pergunta é ambígua — nesse caso devolve os dois, em vez de
 *    escolher um por sorte da ordem do array.
 */

/** Sem acento, minúsculo, sem pontuação. */
export function normalizar(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palavras que não ajudam a identificar assunto nenhum. Sem isto, "como eu
 * faço isso" casaria com qualquer tópico que tivesse "como" nos termos.
 */
export const VAZIAS = new Set([
  "o", "a", "os", "as", "de", "do", "da", "dos", "das", "e", "ou", "em", "no",
  "na", "nos", "nas", "um", "uma", "que", "qual", "quais", "como", "onde",
  "quando", "por", "para", "pra", "com", "sem", "eu", "meu", "minha", "me",
  "se", "faco", "fazer", "faz", "posso", "quero", "tem", "ter", "isso", "esse",
  "essa", "este", "esta", "aqui", "ali", "mais", "muito", "ser", "sao", "estao",
  "sistema", "app", "site", "pagina", "tela",
]);

/**
 * Distância de edição, com corte: para assim que passa do limite.
 *
 * O corte não é otimização — é correção. Sem ele, palavras longas e
 * completamente diferentes ("faturamento" e "notificacao") recebem uma
 * distância finita e passariam a casar se o limite fosse generoso.
 */
export function distancia(a: string, b: string, limite: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limite) return limite + 1;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let melhorNaLinha = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + custo);
      if (atual[j] < melhorNaLinha) melhorNaLinha = atual[j];
    }
    if (melhorNaLinha > limite) return limite + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Uma letra errada só é perdoada em palavra com 5+ letras.
 *
 * Em palavra curta, uma letra de diferença costuma ser OUTRA palavra:
 * "full"/"fill", "ads"/"add", "casa"/"caso". Perdoar ali criaria casamento
 * errado com a confiança de quem acertou.
 */
const MIN_PRA_ERRO = 5;

/**
 * Reduz a palavra ao singular. Não é gramática completa — são as duas regras
 * que aparecem de verdade neste domínio:
 *
 *   · plural comum:  custos → custo
 *   · plural de -ão: devoluções → devolução, impressões → impressão
 *
 * A segunda importa mais do que parece: "devolucao", "notificacao",
 * "impressao" e "promocao" são palavras centrais aqui, e sem esta regra a
 * base falhava em achar o próprio tópico quando a pergunta vinha no plural.
 */
function semPlural(p: string): string {
  // Já vem sem acento de normalizar(): "devoluções" chega como "devolucoes".
  if (p.length >= 5 && p.endsWith("oes")) return `${p.slice(0, -3)}ao`;
  if (p.length >= 4 && p.endsWith("s")) return p.slice(0, -1);
  return p;
}

export function pareceMesmaPalavra(digitada: string, termo: string): boolean {
  if (digitada === termo) return true;
  // Plural é diferença de escrita, não de assunto: "custos" e "custo" são a
  // mesma palavra, e exigir a forma exata fazia a base falhar em pergunta que
  // ela sabia responder.
  if (semPlural(digitada) === semPlural(termo)) return true;
  if (digitada.length < MIN_PRA_ERRO || termo.length < MIN_PRA_ERRO) return false;
  return distancia(digitada, termo, 1) <= 1;
}

/**
 * Expressão composta casa PALAVRA A PALAVRA, não como pedaço de texto.
 *
 * `"custos fixos".includes("custo fixo")` é falso — o plural quebra o
 * casamento literal, e o tópico de custos operacionais não era achado pela
 * própria pergunta. Exigindo que cada palavra da expressão exista no texto
 * (com tolerância a plural e erro de digitação), "custo fixo" casa com
 * "custos fixos" e com "fixo custo", que é o que a pessoa quis dizer nos dois
 * casos.
 */
function expressaoCasa(palavrasDoTexto: string[], termo: string): boolean {
  return termo.split(" ").every(
    (parte) => palavrasDoTexto.some((p) => pareceMesmaPalavra(p, parte)),
  );
}

export type ItemBuscavel = {
  /** Palavras e expressões que levam a este item. Já normalizadas. */
  termos: string[];
};

export type Pontuado<T> = { item: T; pontos: number };

/**
 * Pontua os itens contra a pergunta.
 *
 * Pesos: expressão composta presente = 4, termo inteiro presente = 2,
 * palavra parecida (erro de digitação ou prefixo) = 1. A distância entre 4 e
 * 2 é o que faz "roas ideal" ganhar de "roas" quando os dois casam.
 */
export function pontuar<T extends ItemBuscavel>(texto: string, itens: T[]): Pontuado<T>[] {
  const t = normalizar(texto);
  if (!t) return [];

  const palavras = t.split(" ").filter((p) => p.length >= 3 && !VAZIAS.has(p));
  if (palavras.length === 0) return [];

  return itens
    .map((item) => {
      let pontos = 0;
      // Todas as palavras do texto, incluindo as vazias: uma expressão como
      // "vendas brutas" pode ter parte filtrada da lista significativa.
      const todasAsPalavras = t.split(" ").filter(Boolean);
      for (const termo of item.termos) {
        if (termo.includes(" ")) {
          if (t.includes(termo) || expressaoCasa(todasAsPalavras, termo)) pontos += 4;
          continue;
        }
        if (t.includes(termo)) {
          pontos += 2;
          continue;
        }
        /**
         * Sem casamento exato: aceita erro de digitação ou prefixo — mas SÓ
         * em termo de uma palavra.
         *
         * Numa expressão, casar o começo não é evidência dela: "roas" é
         * prefixo de "roas ideal", e sem esta guarda a pergunta "o que é
         * ROAS?" pontuava o tópico de ROAS IDEAL igual ao de ROAS, e o
         * desempate virava a ordem do array — respondendo a pergunta errada
         * por sorte.
         */
        const parecida = palavras.some(
          (p) => pareceMesmaPalavra(p, termo) || (termo.startsWith(p) && p.length >= 4),
        );
        if (parecida) pontos += 1;
      }
      return { item, pontos };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);
}

/**
 * Os melhores, cortando o que ficou claramente atrás.
 *
 * Quem tem menos da metade da pontuação do primeiro não é resposta — é ruído
 * que casou por uma palavra solta. Mostrar esse item junto faz o usuário
 * duvidar do que veio em primeiro, que era o certo.
 */
export function melhores<T extends ItemBuscavel>(texto: string, itens: T[], max = 3): T[] {
  const ranked = pontuar(texto, itens);
  if (ranked.length === 0) return [];
  const teto = ranked[0].pontos;
  return ranked
    .filter((x) => x.pontos >= teto / 2)
    .slice(0, max)
    .map((x) => x.item);
}
