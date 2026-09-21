import { rotuloCampanha } from "./ads-campaigns";
import { chaveOrdenacao } from "./ads-cores";

/**
 * A ordenação da tabela de Ads — o critério, o sentido e como falar deles.
 *
 * ─── POR QUE ISTO SAIU DO COMPONENTE ────────────────────────────────────
 *
 * A ordem morava no estado da própria tabela e só se mudava pelos botões do
 * `<thead>`. No celular a tabela vira cartões e o CSS esconde o `<thead>`
 * (`.tbl-cards thead { display:none }`): a análise perdia a única forma de
 * ordenar. Com o estado aqui e num seletor FORA da tabela, o mesmo critério
 * vale nos dois lugares, e a ordem sobrevive a a tabela desmontar (filtro que
 * zera a lista, abrir o detalhe).
 *
 * ─── O SENTIDO ──────────────────────────────────────────────────────────
 *
 * `dir` é o multiplicador da comparação: 1 = crescente, -1 = decrescente, em
 * TODAS as colunas. Antes cada coluna tinha um `asc` próprio, e nas numéricas o
 * padrão (do maior pro menor, `dir = -1`) era anunciado ao leitor de tela como
 * "ascending" — o contrário do que a tabela fazia.
 */

export type ColunaOrdenavel =
  | "campanha" | "investido" | "lucro" | "roas" | "roasobj" | "margem" | "viaads" | "decisao";

export type OrdemAds = { col: ColunaOrdenavel; dir: 1 | -1 };

export const ORDEM_INICIAL: OrdemAds = { col: "investido", dir: -1 };

/** O mínimo que a ordenação precisa saber de uma linha. `LinhaAds` satisfaz. */
export type LinhaOrdenavel = {
  i: { cost: number; campaignName?: string | null; roasTarget: number; totalSales: number };
  lucroAtual: number | null;
  roasMlAds: number | null;
  margemAtual: number | null;
  pctAds: number;
};

type MetaDaColuna = {
  rotulo: string;
  /** Sentido ao escolher a coluna pela primeira vez. */
  dirPadrao: 1 | -1;
  /** Como dizer cada sentido em português. */
  crescente: string;
  decrescente: string;
};

export const COLUNAS_ORDENAVEIS: Record<ColunaOrdenavel, MetaDaColuna> = {
  investido: { rotulo: "Investido", dirPadrao: -1, crescente: "menor primeiro", decrescente: "maior primeiro" },
  lucro: { rotulo: "Lucro após Ads", dirPadrao: -1, crescente: "menor primeiro (prejuízo no topo)", decrescente: "maior primeiro" },
  roas: { rotulo: "ROAS", dirPadrao: -1, crescente: "menor primeiro", decrescente: "maior primeiro" },
  roasobj: { rotulo: "ROAS objetivo", dirPadrao: -1, crescente: "menor primeiro", decrescente: "maior primeiro" },
  margem: { rotulo: "Margem", dirPadrao: -1, crescente: "menor primeiro", decrescente: "maior primeiro" },
  viaads: { rotulo: "Via Ads", dirPadrao: -1, crescente: "menor primeiro", decrescente: "maior primeiro" },
  campanha: { rotulo: "Campanha", dirPadrao: 1, crescente: "A a Z", decrescente: "Z a A" },
  decisao: { rotulo: "Decisão (impacto)", dirPadrao: 1, crescente: "pior impacto primeiro", decrescente: "melhor impacto primeiro" },
};

/** Ordem em que as opções aparecem no seletor. */
export const ORDEM_DAS_OPCOES: ColunaOrdenavel[] = [
  "investido", "lucro", "roas", "roasobj", "margem", "viaads", "campanha", "decisao",
];

/** Escolher a MESMA coluna inverte o sentido; outra coluna começa no sentido padrão dela. */
export function alternarOrdem(o: OrdemAds, col: ColunaOrdenavel): OrdemAds {
  return o.col === col
    ? { col, dir: (o.dir * -1) as 1 | -1 }
    : { col, dir: COLUNAS_ORDENAVEIS[col].dirPadrao };
}

/** Trocar só o critério (seletor): começa no sentido padrão do novo critério. */
export function escolherColuna(o: OrdemAds, col: ColunaOrdenavel): OrdemAds {
  return o.col === col ? o : { col, dir: COLUNAS_ORDENAVEIS[col].dirPadrao };
}

/** O valor de `aria-sort` da coluna: só a ativa tem sentido. */
export function ariaSort(o: OrdemAds, col: ColunaOrdenavel): "ascending" | "descending" | "none" {
  if (o.col !== col) return "none";
  return o.dir === 1 ? "ascending" : "descending";
}

/** "Investido — maior primeiro": o critério ativo, dito por extenso. */
export function descreverOrdem(o: OrdemAds): string {
  const m = COLUNAS_ORDENAVEIS[o.col];
  return `${m.rotulo} — ${o.dir === 1 ? m.crescente : m.decrescente}`;
}

/**
 * Ordena as linhas. Não muda o array recebido.
 *
 * A chave é o número que está NA TELA (ver a coluna ROAS: ordena por
 * `roasMlAds`, que é o exibido, e não pelo `r` do modo escolhido). Dado
 * ausente vai pro FIM nos dois sentidos — com um extremo fixo, inverter a
 * ordem traria os vazios pro topo, no lugar dos piores de verdade.
 */
export function ordenarLinhas<T extends LinhaOrdenavel>(linhas: readonly T[], ordem: OrdemAds): T[] {
  const arr = [...linhas];

  // Campanha agrupa os anúncios da mesma verba; dentro dela, o maior
  // investimento primeiro, porque é a linha que decide.
  if (ordem.col === "campanha") {
    return arr.sort((x, y) =>
      rotuloCampanha(x.i.campaignName).localeCompare(rotuloCampanha(y.i.campaignName), "pt-BR") * ordem.dir
      || y.i.cost - x.i.cost);
  }

  const chave = (l: T): number => {
    switch (ordem.col) {
      case "investido": return l.i.cost;
      case "lucro": return chaveOrdenacao(l.lucroAtual, ordem.dir);
      case "roas": return chaveOrdenacao(l.roasMlAds, ordem.dir);
      // "Sem meta" não é meta baixa: vai pro fim em vez de posar de zero.
      case "roasobj": return chaveOrdenacao(l.i.roasTarget > 0 ? l.i.roasTarget : null, ordem.dir);
      case "margem": return chaveOrdenacao(l.margemAtual, ordem.dir);
      // Sem venda no anúncio não há dependência a medir — não vira 0%.
      case "viaads": return chaveOrdenacao(l.i.totalSales > 0 ? l.pctAds : null, ordem.dir);
      // O impacto é o próprio lucro (menor = pior); sem lucro, o custo como perda.
      case "decisao": return l.lucroAtual ?? -l.i.cost;
      default: return 0;
    }
  };
  return arr.sort((x, y) => (chave(x) - chave(y)) * ordem.dir);
}
