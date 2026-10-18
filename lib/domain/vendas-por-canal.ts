/**
 * Vendas por canal — quanto o MESMO produto vendeu só nas agências, só no Full
 * e nos dois juntos.
 *
 * Com o estoque separado por tipo de anúncio ("Limão Caipira" no Full,
 * "Limão Caipira Agências" nas agências), cada cadastro vende por si. Pra
 * decidir comprar, precificar ou cortar, a pergunta é sobre o produto: no
 * total, quanto ele vende, e de onde vem. É isso que esta conta responde,
 * agrupando pelo `grupo` (lib/domain/grupo-produto.ts).
 *
 * ─── A BASE ─────────────────────────────────────────────────────────────
 *
 * "Vendas brutas" do Seller Center: pedidos válidos, sem cancelado nem
 * devolvido (lib/domain/vendas-brutas.ts). A soma de todas as linhas fecha com
 * o número que a pessoa confere lá — o que não for de nenhum canal conhecido
 * aparece à parte, em vez de sumir ou ser empurrado pra um lado.
 *
 * ─── O CANAL DE CADA ANÚNCIO ────────────────────────────────────────────
 *
 * O fato primeiro (a logística do anúncio no ML), o cadastro do produto
 * depois, e "não identificado" quando nenhum dos dois sabe — nunca um chute.
 *
 * Puro e autossuficiente (sem `@/` fora do domínio).
 */

import { canalDoAnuncio, chaveDoGrupo, type Canal, type ProdutoComGrupo } from "./grupo-produto";

export type VendaDoAnuncio = {
  item_id: string;
  title: string;
  /** Valor vendido (preço × unidades) nos pedidos válidos. */
  bruto: number;
  /** Cancelado/devolvido do anúncio — fora do `bruto`, só pra mostrar o quanto se perde. */
  perdido?: number;
  qty: number;
  pedidos: number;
};

export type ProdutoParaCanal = ProdutoComGrupo & { mlbs?: string[]; mlb?: string; skusAnteriores?: string[] };

export type TotalDeVenda = { valor: number; unidades: number; pedidos: number };

export type LinhaPorCanal = {
  chave: string;
  nome: string;
  full: TotalDeVenda;
  agencias: TotalDeVenda;
  /** Vendas de anúncios cujo canal ninguém sabe dizer. */
  semCanal: TotalDeVenda;
  total: TotalDeVenda;
  /** % do valor das agências sobre o que tem canal conhecido. `null` quando não há base. */
  pctAgencias: number | null;
  /** Cancelado/devolvido do grupo inteiro. */
  perdido: number;
  /** O grupo reúne mais de um cadastro (é um produto em dois anúncios). */
  agrupado: boolean;
  anuncios: number;
};

export type ResumoPorCanal = {
  linhas: LinhaPorCanal[];
  full: TotalDeVenda;
  agencias: TotalDeVenda;
  semCanal: TotalDeVenda;
  total: TotalDeVenda;
};

const zero = (): TotalDeVenda => ({ valor: 0, unidades: 0, pedidos: 0 });
const somar = (t: TotalDeVenda, v: VendaDoAnuncio) => {
  t.valor += v.bruto;
  t.unidades += v.qty;
  t.pedidos += v.pedidos;
};

/** "MLB123" e "123" são o mesmo anúncio. */
function idDoAnuncio(s: unknown): string {
  return String(s ?? "").trim().toUpperCase().replace(/^MLB/, "");
}

export function vendasPorCanal(
  vendas: readonly VendaDoAnuncio[],
  produtos: readonly ProdutoParaCanal[],
  /** A logística que o ML informa do anúncio (`fulfillment` = Full); `undefined` = não sei. */
  logisticaDe: (itemId: string) => string | undefined,
): ResumoPorCanal {
  // anúncio → produto. Anúncio em dois produtos é ambíguo: fica sem dono, não vai pro primeiro que aparecer.
  const porAnuncio = new Map<string, ProdutoParaCanal | null>();
  const porSku = new Map<string, ProdutoParaCanal | null>();
  for (const p of produtos) {
    const ids = [...(p.mlbs ?? []), ...(p.mlb ? [p.mlb] : [])].map(idDoAnuncio).filter(Boolean);
    for (const id of new Set(ids)) porAnuncio.set(id, porAnuncio.has(id) ? null : p);
    const sku = String(p.sku ?? "").trim().toLowerCase();
    if (sku) porSku.set(sku, porSku.has(sku) ? null : p);
  }
  // SKUs anteriores (venda antiga guarda o SKU da hora): só onde nenhum produto tem esse SKU hoje.
  for (const p of produtos) {
    for (const s of p.skusAnteriores ?? []) {
      const k = String(s ?? "").trim().toLowerCase();
      if (k && !porSku.has(k)) porSku.set(k, p);
    }
  }

  type Acc = LinhaPorCanal & { _produtos: Set<string> };
  const mapa = new Map<string, Acc>();
  const geral = { full: zero(), agencias: zero(), semCanal: zero(), total: zero() };

  for (const v of vendas) {
    const produto = porAnuncio.get(idDoAnuncio(v.item_id)) ?? porSku.get(String(v.item_id ?? "").trim().toLowerCase()) ?? null;
    const canal: Canal | null = canalDoAnuncio(logisticaDe(v.item_id), produto?.canal);

    const chave = produto ? chaveDoGrupo(produto) : `anuncio:${idDoAnuncio(v.item_id) || v.title}`;
    let linha = mapa.get(chave);
    if (!linha) {
      linha = {
        chave,
        nome: produto ? (String(produto.grupo ?? "").trim() || produto.name || produto.id) : (v.title || "Sem identificação"),
        full: zero(), agencias: zero(), semCanal: zero(), total: zero(),
        pctAgencias: null, perdido: 0, agrupado: false, anuncios: 0, _produtos: new Set<string>(),
      };
      mapa.set(chave, linha);
    }
    const lado = canal === "full" ? "full" : canal === "agencias" ? "agencias" : "semCanal";
    somar(linha[lado], v);
    somar(linha.total, v);
    somar(geral[lado], v);
    somar(geral.total, v);
    linha.anuncios += 1;
    linha.perdido += v.perdido ?? 0;
    if (produto) linha._produtos.add(produto.id);
  }

  const linhas = [...mapa.values()].map(({ _produtos, ...l }): LinhaPorCanal => {
    const conhecido = l.full.valor + l.agencias.valor;
    return { ...l, agrupado: _produtos.size > 1, pctAgencias: conhecido > 0 ? (l.agencias.valor / conhecido) * 100 : null };
  }).sort((a, b) => b.total.valor - a.total.valor || a.nome.localeCompare(b.nome, "pt-BR"));

  return { linhas, ...geral };
}
