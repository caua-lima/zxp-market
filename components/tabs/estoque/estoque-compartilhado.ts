/**
 * O vocabulário compartilhado da aba de Estoque.
 *
 * ─── POR QUE ISTO VIROU UM ARQUIVO ───────────────────────────────────────
 *
 * `EstoqueTab.tsx` passou de 3.100 linhas: onze componentes, cinco modais e
 * os ajudantes que todos usam, num arquivo só. Abrir o arquivo pra mexer num
 * modal significava rolar por tudo, e "onde está `fullDe`?" não tinha
 * resposta melhor que buscar no arquivo inteiro.
 *
 * O que mora aqui são as definições que MAIS DE UM componente usa. É o
 * critério inteiro — não é uma pasta de utilitários. Função usada por um
 * componente só continua ao lado dele: movê-la pra cá só acrescentaria um
 * arquivo pra abrir.
 *
 * ─── E POR QUE NÃO FOI PRA lib/domain ────────────────────────────────────
 *
 * Porque estas leem o formato que a ROTA do ML devolve e o que o cadastro
 * guarda, e decidem coisas de apresentação. `lib/domain` é onde vivem as
 * regras que valem independentemente de tela — e misturar as duas faria o
 * domínio depender do formato de uma resposta HTTP.
 */
import { parseBRNumber } from "@/lib/domain/calc";
import { consolidarEstoqueAnuncios, ehFullLogistic, estoqueForaDoFull } from "@/lib/domain/estoque";
import { calcularLucroEstoque, medirTaxas } from "@/lib/domain/estoque-lucro";
import type { FinanceiroProduto, LucroEstoque } from "@/lib/domain/estoque-lucro";
import { impostoNaData } from "@/lib/domain/types";
import type { Product } from "@/lib/domain/types";
export type MlItem = { available: number; sold: number; status: string; price: number; regularPrice: number; hasPromo: boolean; logistic: string; inventoryId?: string };

export type EstoqueML = Record<string, MlItem>;

export type Forecast = {
  vendas: Record<string, number>;
  dias: number;
  /** Realizado por produto — base das taxas medidas (ver lib/domain/estoque-lucro.ts). */
  financeiro?: Record<string, FinanceiroProduto>;
  /**
   * Dias, dentro da janela, em que o produto esteve à venda. Base da média
   * diária — anúncio pausado metade do período vende o dobro por dia ativo
   * do que a divisão pela janela sugere (ver mediaDiariaAjustada).
   */
  diasAtivos?: Record<string, number>;
};

// dias-alvo de cobertura pra sugestão de reposição
export const DIAS_ALVO = 30;

/**
 * Hoje no fuso de Brasilia. `todayISO` usa o relogio LOCAL da maquina,
 * que diverge do dia BR quando o navegador esta em outro fuso — e a data alvo
 * do planejamento nao pode depender disso.
 */
export function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Lê número em formato brasileiro — delegando pra a definição compartilhada.
 *
 * ─── O ERRO DE MIL VEZES ─────────────────────────────────────────────────
 *
 * Esta função era:
 *
 *   parseFloat(String(s).replace(",", "."))
 *
 * Uma troca só, da PRIMEIRA vírgula. Com "1.234,56" isso vira "1.234.56",
 * e `parseFloat` para no segundo ponto: **1,234**. Mil vezes menos.
 *
 * E ela alimentava `custoMedioDe`, que é o custo do produto — que vira valor
 * de estoque, valor em risco e custo unitário do plano de reposição. O mesmo
 * texto lido por `parseBRNumber` (em lib/domain/calc, usado pelo resto do
 * app) dava 1234,56. Duas telas, dois custos, pro mesmo produto.
 *
 * ─── POR QUE NÃO UNIFICAR COM `lerValorEmReais` TAMBÉM ───────────────────
 *
 * Parece a mesma coisa e não é. `lerValorEmReais` lê o que a PESSOA DIGITA:
 * ali "1.234" quase certamente significa mil duzentos e trinta e quatro, e
 * ela aplica essa heurística. `parseBRNumber` lê o que está GRAVADO — e
 * `custoDe` grava com `toFixed(2)`, onde o ponto é decimal de verdade ("1234.56").
 *
 * Fundir as duas faria uma delas mentir. São trabalhos diferentes, e o
 * comentário existe pra ninguém juntar depois achando que é duplicação.
 */
export const parseNum = parseBRNumber;

export function mlbsDe(p: Product): string[] {
  if (p.mlbs && p.mlbs.length) return p.mlbs;
  return p.mlb ? [p.mlb] : [];
}

export function normMlb(s: string) {
  const up = s.trim().toUpperCase();
  return up.startsWith("MLB") ? up : up ? `MLB${up}` : "";
}

export function custoMedioDe(p: Product): number {
  return p.custoMedio ?? parseNum(p.custo);
}

// Anúncios (MLBs) do produto com os dados do ML de cada um.
export type AnuncioML = { mlb: string; item: MlItem | null };

export function anunciosDe(p: Product, estoqueML: EstoqueML): AnuncioML[] {
  return mlbsDe(p).map((m) => ({ mlb: normMlb(m), item: estoqueML[normMlb(m)] ?? null }));
}

/**
 * Estoque do ML por logística, com cada pool físico contado UMA vez —
 * a regra e o porquê de cada armadilha estão em lib/domain/estoque.ts
 * (consolidarEstoqueAnuncios), que é puro e tem os testes.
 */
export function fullDe(p: Product, estoqueML: EstoqueML): { qtd: number; proprio: number; ehFull: boolean; temDado: boolean; fullCompartilhado: boolean; proprioCompartilhado: boolean } {
  const c = consolidarEstoqueAnuncios(
    anunciosDe(p, estoqueML)
      .filter(({ item }) => item)
      .map(({ item }) => ({ available: item!.available, logistic: item!.logistic, inventoryId: item!.inventoryId })),
  );
  return { qtd: c.full, proprio: c.proprio, ehFull: c.ehFull, temDado: c.temDado, fullCompartilhado: c.fullCompartilhado, proprioCompartilhado: c.proprioCompartilhado };
}

// Faixa de preços dos anúncios (por anúncio, sem média). Retorna min/max/único.
export function precosDe(p: Product, estoqueML: EstoqueML): { min: number; max: number; temPromo: boolean; count: number } {
  const precos: number[] = [];
  let temPromo = false;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item || !item.price) continue;
    precos.push(item.price);
    if (item.hasPromo) temPromo = true;
  }
  if (!precos.length) return { min: 0, max: 0, temPromo: false, count: 0 };
  return { min: Math.min(...precos), max: Math.max(...precos), temPromo, count: precos.length };
}

export type PrevisaoProduto = {
  precoMin: number;
  precoMax: number;
  casa: number;
  full: number;
  proprio: number;
  ehFull: boolean;
  total: number;
  mediaDiaria: number;
  cobertura: number;    // dias até acabar o total (Infinity = sem vendas ou sem estoque)
  valorPotencial: number;
  reporQtd: number;     // unidades pra levar o Full a cobrir DIAS_ALVO (só produtos no Full)
  /**
   * Lucro que este estoque ainda pode render, com comissão e frete MEDIDOS
   * nas vendas do período. `null` quando não há base (produto sem venda ou
   * sem preço de anúncio) — a tela mostra "—", nunca R$ 0,00.
   */
  lucro: LucroEstoque | null;
};

export function previsaoDe(p: Product, estoqueML: EstoqueML, forecast: Forecast): PrevisaoProduto {
  const casa = Math.max(p.qtdLocal ?? 0, 0);
  const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
  const foraFull = estoqueForaDoFull(casa, proprio, ehFull);
  const total = full + foraFull;
  const { min: precoMin, max: precoMax } = precosDe(p, estoqueML);
  // Venda potencial: `full` já vem deduplicado por pool (fullDe) — precifica
  // pelo MELHOR preço entre os anúncios Full, em vez de somar available×price
  // de CADA anúncio (isso multiplicava o mesmo pool compartilhado pelo preço
  // de cada listagem, dobrando o valor exatamente como dobrava a unidade).
  // Fora do Full: mesma ideia, uma vez só, pelo melhor preço entre os próprios.
  let precoFullMax = 0;
  let precoProprioMax = 0;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item) continue;
    if (ehFullLogistic(item.logistic)) precoFullMax = Math.max(precoFullMax, item.price);
    else precoProprioMax = Math.max(precoProprioMax, item.price);
  }
  const valorPotencial = full * (precoFullMax || precoMax || precoMin) + foraFull * (precoProprioMax || precoMax || precoMin);
  const mediaDiaria = forecast.dias > 0 ? (forecast.vendas[p.id] ?? 0) / forecast.dias : 0;
  const cobertura = mediaDiaria > 0 && total > 0 ? total / mediaDiaria : Infinity;
  // Reposição só faz sentido pra quem está no Full.
  const reporQtd = ehFull && mediaDiaria > 0 ? Math.max(0, Math.ceil(mediaDiaria * DIAS_ALVO) - full) : 0;

  /**
   * Lucro projetado do que está parado. Precifica pelo MENOR preço entre os
   * anúncios (precoMin), não o maior: o comprador escolhe o mais barato, então
   * projetar pelo topo prometeria um lucro que a venda real não entrega.
   * Imposto e custo saem da vigência de HOJE — é a decisão de hoje que está
   * em jogo, não o histórico.
   */
  const lucro = calcularLucroEstoque({
    preco: precoMin || precoMax,
    custo: custoMedioDe(p),
    impostoPct: impostoNaData(p, todayISO()),
    unidades: total,
    taxas: medirTaxas(forecast.financeiro?.[p.id]),
  });

  return { precoMin, precoMax, casa, full, proprio, ehFull, total, mediaDiaria, cobertura, valorPotencial, reporQtd, lucro };
}

export function coberturaFmt(dias: number): { txt: string; cor: string } {
  if (!Number.isFinite(dias)) return { txt: "—", cor: "var(--muted)" };
  const d = Math.round(dias);
  const cor = d <= 7 ? "var(--red)" : d <= 15 ? "var(--warning)" : "var(--green)";
  return { txt: `${d}d`, cor };
}

/**
 * O plano de vinculação por SKU.
 *
 * Mora aqui porque DOIS componentes o leem: o modal que pede o aval pra
 * vinculação aproximada, e o `AutoVincularSku`, que aplica sozinho só o
 * casamento exato. Deixá-lo no modal faria o segundo importar do primeiro —
 * e aí mexer no formulário arriscaria quebrar a vinculação automática.
 */
export type NovoSku = { mlb: string; titulo: string; skuAnuncio: string; exato: boolean };

export type PlanoSku = {
  productId: string; name: string; sku: string;
  atuais: { mlb: string; titulo: string }[];
  novos: NovoSku[];
};

export type ResumoSku = { produtos: number; anunciosDaConta: number; anunciosLidos: number; semSku: number; semMatch: number; aproximados: number; aVincular: number };
