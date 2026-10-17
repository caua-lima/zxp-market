/**
 * Grupo e canal do produto — "o mesmo produto, anúncio diferente".
 *
 * ─── O PROBLEMA ─────────────────────────────────────────────────────────
 *
 * O estoque passa a ser separado por TIPO de anúncio: o limão caipira que vai
 * pro Full e o que fica nas agências são dois cadastros, cada um com o seu SKU
 * e o seu estoque ("Limão Caipira" e "Limão Caipira Agências"). Separado, o
 * controle é limpo — mas na hora de analisar, é o MESMO produto: quanto vendeu
 * só nas agências, só no Full e nos dois juntos.
 *
 * O elo é o `grupo`: produtos com o mesmo grupo são variações do mesmo item.
 * O `canal` diz de qual lado cada um está.
 *
 * ─── O CANAL DE UMA VENDA SAI DO ANÚNCIO, NÃO DO CADASTRO ───────────────
 *
 * O Mercado Livre diz a logística de cada anúncio (`fulfillment` = Full). Isso
 * é fato; o `canal` digitado é intenção. Quando os dois existem, vale o fato —
 * um produto marcado "agências" cujo anúncio é Full não vende nas agências.
 * O canal do cadastro só entra quando o ML não respondeu sobre o anúncio.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type Canal = "full" | "agencias";

export const ROTULO_CANAL: Record<Canal, string> = { full: "Full", agencias: "Agências" };

export type ProdutoComGrupo = {
  id: string;
  name?: string;
  sku?: string;
  grupo?: string;
  canal?: Canal;
  ativo?: boolean;
};

/** Minúsculas, sem acento, espaços colapsados — "Limão  Caipira" e "limao caipira" são o mesmo grupo. */
export function normalizarGrupo(nome: unknown): string {
  return String(nome ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** `canal` vindo de fora (campo livre do Firestore) só vale se for um dos dois. */
export function canalValido(c: unknown): Canal | null {
  return c === "full" || c === "agencias" ? c : null;
}

/** A logística do ML decide: `fulfillment` é Full, qualquer outra é das agências. */
export function canalDaLogistica(logistica: unknown): Canal | null {
  const l = String(logistica ?? "").trim().toLowerCase();
  if (!l) return null;
  return l === "fulfillment" ? "full" : "agencias";
}

/**
 * O canal de um anúncio: o fato (logística) primeiro, o cadastro do produto
 * depois, e `null` quando nenhum dos dois sabe — o chamador mostra "não
 * identificado" em vez de chutar um lado.
 */
export function canalDoAnuncio(logistica: unknown, canalDoProduto: unknown): Canal | null {
  return canalDaLogistica(logistica) ?? canalValido(canalDoProduto);
}

export type GrupoDeProdutos<P extends ProdutoComGrupo> = {
  /** Chave estável: o grupo normalizado, ou `produto:{id}` quando o produto está sozinho. */
  chave: string;
  /** Nome pra mostrar: o grupo como foi digitado (do primeiro produto), ou o nome do produto avulso. */
  nome: string;
  produtos: P[];
};

/** Chave do grupo de um produto — avulso (sem grupo) forma um grupo só dele. */
export function chaveDoGrupo(p: ProdutoComGrupo): string {
  const g = normalizarGrupo(p.grupo);
  return g ? `grupo:${g}` : `produto:${p.id}`;
}

/** Agrupa mantendo a ordem de entrada. Produto sem grupo é um grupo de um. */
export function agruparProdutos<P extends ProdutoComGrupo>(produtos: readonly P[]): GrupoDeProdutos<P>[] {
  const mapa = new Map<string, GrupoDeProdutos<P>>();
  for (const p of produtos) {
    const chave = chaveDoGrupo(p);
    const g = mapa.get(chave);
    if (g) g.produtos.push(p);
    else mapa.set(chave, { chave, nome: String(p.grupo ?? "").trim() || p.name || p.id, produtos: [p] });
  }
  return [...mapa.values()];
}

/** Os outros produtos do mesmo grupo — vazio quando o produto está sozinho. */
export function irmaosDe<P extends ProdutoComGrupo>(produto: ProdutoComGrupo, produtos: readonly P[]): P[] {
  if (!normalizarGrupo(produto.grupo)) return [];
  const chave = chaveDoGrupo(produto);
  return produtos.filter((p) => p.id !== produto.id && chaveDoGrupo(p) === chave);
}

/** Os grupos que já existem (nome como digitado), pra sugerir no cadastro. */
export function gruposExistentes(produtos: readonly ProdutoComGrupo[]): string[] {
  const vistos = new Map<string, string>();
  for (const p of produtos) {
    const g = String(p.grupo ?? "").trim();
    const k = normalizarGrupo(g);
    if (k && !vistos.has(k)) vistos.set(k, g);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

const SUFIXO_CANAL = /\s*[-–—(]?\s*\b(ag[eê]ncias?|ag\.?|full)\b\s*\)?\s*$/i;

/**
 * Sugere o grupo a partir do nome: tira o sufixo que marca o canal
 * ("Limão Caipira Agências" → "Limão Caipira"). É só sugestão — a pessoa
 * confirma ou muda no cadastro.
 */
export function sugerirGrupo(nome: unknown): string {
  const n = String(nome ?? "").trim();
  const sem = n.replace(SUFIXO_CANAL, "").trim();
  return sem || n;
}

/** Canal que o nome insinua ("… Agências" → agencias, "… Full" → full), ou null. */
export function sugerirCanal(nome: unknown): Canal | null {
  const m = String(nome ?? "").trim().match(SUFIXO_CANAL);
  if (!m) return null;
  return /^full$/i.test(m[1]) ? "full" : "agencias";
}

/** O outro lado: quem é Full tem como par as agências, e vice-versa. */
export function canalOposto(c: Canal): Canal {
  return c === "full" ? "agencias" : "full";
}

/**
 * Nome e SKU sugeridos pra versão do OUTRO canal de um produto:
 * "Limão Caipira" + agencias → "Limão Caipira Agências" / SKU "LimaoCaipiraAgencias".
 * O SKU é sugestão (a pessoa digita o que usa); nunca repete o do original.
 */
export function sugerirVersao(
  produto: ProdutoComGrupo,
  canal: Canal,
): { nome: string; sku: string; grupo: string } {
  const base = sugerirGrupo(produto.name);
  const rotulo = ROTULO_CANAL[canal];
  const grupo = String(produto.grupo ?? "").trim() || base;
  // SKU costuma ser uma palavra só ("MentaFull"): o sufixo vem colado, sem fronteira de palavra.
  const skuSem = String(produto.sku ?? "").trim().replace(/(ag[eê]ncias?|full)$/i, "").replace(/[-_\s]+$/, "");
  const skuBase = skuSem || base.replace(/\s+/g, "");
  const semAcento = rotulo.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return { nome: `${base} ${rotulo}`, sku: `${skuBase}${semAcento}`, grupo };
}
