/**
 * "Quanto de estoque tenho hoje do Menta Limão?" — a resposta do chat.
 *
 * O produto é o GRUPO (Full + Agências do mesmo sabor). Pra cada grupo:
 *  · agências = o que os anúncios fora do Full declaram (é o "em casa": cada
 *    venda desconta sozinha no ML — ver estoqueForaDoFull);
 *  · Full = o disponível dos anúncios do Full, contando UMA vez cada pool
 *    (`inventoryId`): dois anúncios no mesmo pool respondem o mesmo número;
 *  · ritmo = vendas dos últimos N dias ÷ N, e pra quantos dias dá — no total
 *    e SEPARADO por lado: venda em anúncio do Full é do Full, o resto é das
 *    agências (pela logística do anúncio vendido; sem a venda por anúncio,
 *    pelo lado do produto).
 *
 * Agências: o mesmo cálculo da tela do Estoque (consolidarEstoqueAnuncios) —
 * anúncios sincronizados pelo catálogo contam uma vez; estoque dividido soma.
 */

import { consolidarEstoqueAnuncios } from "./estoque";

export type ProdutoConsulta = { id: string; name: string; grupo?: string; mlbs: string[]; ativo?: boolean; estoqueDividido?: boolean; canal?: "full" | "agencias" };
export type AnuncioConsulta = { available: number; logistic: string; status?: string; inventoryId?: string; poolProprio?: string };
export type ResumoDoGrupo = {
  nome: string;
  agencias: number;
  full: number;
  total: number;
  vendasNoPeriodo: number;
  diasDoPeriodo: number;
  /** null = sem venda no período (não dá pra dizer pra quantos dias dá). */
  mediaDia: number | null;
  diasDeCobertura: number | null;
  /** O mesmo ritmo, por lado. null = sem venda daquele lado no período. */
  vendasFull: number;
  vendasAgencias: number;
  mediaDiaFull: number | null;
  mediaDiaAgencias: number | null;
  diasDeCoberturaFull: number | null;
  diasDeCoberturaAgencias: number | null;
};

export function normalizar(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const PALAVRAS_DE_ESTOQUE = /\b(estoque|quanto[s]?|quantas?|tenho|sobra|sobrou|unidades?|repor|reposicao|acabar|acaba|dura|duram|falta)\b/;
const VAZIAS = new Set(["quanto", "quantos", "quanta", "quantas", "de", "do", "da", "dos", "das", "o", "a", "os", "as", "estoque", "tenho", "tem", "hoje", "agora",
  "eu", "meu", "minha", "unidade", "unidades", "e", "no", "na", "em", "que", "ainda", "sobra", "sobrou", "pra", "para", "repor", "reposicao", "precisa", "preciso",
  "vou", "vai", "acabar", "acaba", "dura", "duram", "falta", "faltam", "qual", "trot", "trots", "barao", "erva", "mate", "terere", "casa", "full", "agencias", "agencia", "total"]);

/** É pergunta de estoque? Devolve as palavras que sobram (o produto). */
export function perguntaDeEstoque(texto: string): string[] | null {
  const t = normalizar(texto);
  if (!PALAVRAS_DE_ESTOQUE.test(t)) return null;
  const palavras = t.split(" ").filter((p) => p.length >= 3 && !VAZIAS.has(p));
  return palavras;
}

export const nomeDoGrupo = (p: ProdutoConsulta) =>
  String(p.grupo ?? "").trim() || p.name.replace(/\s*ag[eê]ncias?\s*$/i, "").trim();

/** Grupos que batem com TODAS as palavras (no nome do grupo ou de algum produto dele). */
export function gruposQueBatem(palavras: string[], produtos: readonly ProdutoConsulta[]): string[] {
  const grupos = new Map<string, string>();
  for (const p of produtos) {
    const g = nomeDoGrupo(p);
    grupos.set(g, `${grupos.get(g) ?? ""} ${normalizar(g)} ${normalizar(p.name)}`);
  }
  if (!palavras.length) return [];
  return [...grupos].filter(([, txt]) => palavras.every((w) => txt.includes(w) || txt.includes(w.replace(/s$/, "")))).map(([g]) => g);
}

const normMlb = (s: string) => { const up = String(s ?? "").trim().toUpperCase(); return up.startsWith("MLB") ? up : `MLB${up}`; };

export function resumirGrupo(
  grupo: string,
  produtos: readonly ProdutoConsulta[],
  anuncios: Readonly<Record<string, AnuncioConsulta>>,
  vendasPorProduto: Readonly<Record<string, number>>,
  diasDoPeriodo: number,
  /** Vendas por anúncio ("MLB…"), pra separar Full × agências pela logística de quem vendeu. */
  vendasPorMlb?: Readonly<Record<string, number>>,
): ResumoDoGrupo {
  const doGrupo = produtos.filter((p) => nomeDoGrupo(p) === grupo);
  let agencias = 0;
  let full = 0;
  const pools = new Set<string>();
  const vistos = new Set<string>();
  for (const p of doGrupo) {
    const proprios: { id: string; available: number; logistic: string; poolProprio?: string }[] = [];
    for (const m of p.mlbs) {
      const mlb = normMlb(m);
      if (vistos.has(mlb)) continue;
      vistos.add(mlb);
      const a = anuncios[mlb];
      if (!a) continue;
      const qtd = Math.max(Number(a.available) || 0, 0);
      if (a.logistic === "fulfillment") {
        const pool = a.inventoryId || mlb;
        if (pools.has(pool)) continue;
        pools.add(pool);
        full += qtd;
      } else {
        proprios.push({ id: mlb, available: qtd, logistic: a.logistic, poolProprio: a.poolProprio });
      }
    }
    if (proprios.length) agencias += consolidarEstoqueAnuncios(proprios, { dividido: p.estoqueDividido === true }).proprio;
  }
  const vendas = doGrupo.reduce((s, p) => s + (Number(vendasPorProduto[p.id]) || 0), 0);

  // Full × agências: pela logística do anúncio que vendeu; o que não casar
  // com anúncio do Full (venda achada pelo SKU, anúncio sem leitura) é das agências.
  let vendasFull = 0;
  if (vendasPorMlb) {
    const vistosV = new Set<string>();
    for (const p of doGrupo) {
      for (const m of p.mlbs) {
        const mlb = normMlb(m);
        if (vistosV.has(mlb)) continue;
        vistosV.add(mlb);
        if (anuncios[mlb]?.logistic === "fulfillment") vendasFull += Number(vendasPorMlb[mlb]) || 0;
      }
    }
  } else {
    // Sem a venda por anúncio: pelo lado do produto (canal; senão, tem anúncio no Full e não é "Agências").
    for (const p of doGrupo) {
      const ladoFull = p.canal ? p.canal === "full"
        : !/ag[eê]ncias?\s*$/i.test(p.name) && p.mlbs.some((m) => anuncios[normMlb(m)]?.logistic === "fulfillment");
      if (ladoFull) vendasFull += Number(vendasPorProduto[p.id]) || 0;
    }
  }
  vendasFull = Math.min(vendasFull, vendas);
  const vendasAgencias = Math.max(vendas - vendasFull, 0);

  const media = (n: number) => (n > 0 && diasDoPeriodo > 0 ? n / diasDoPeriodo : null);
  const cobertura = (estoque: number, m: number | null) => (m ? Math.floor(estoque / m) : null);
  const mediaDia = media(vendas);
  const mediaDiaFull = media(vendasFull);
  const mediaDiaAgencias = media(vendasAgencias);
  const total = agencias + full;
  return {
    nome: grupo, agencias, full, total, vendasNoPeriodo: vendas, diasDoPeriodo, mediaDia,
    diasDeCobertura: cobertura(total, mediaDia),
    vendasFull, vendasAgencias, mediaDiaFull, mediaDiaAgencias,
    diasDeCoberturaFull: cobertura(full, mediaDiaFull),
    diasDeCoberturaAgencias: cobertura(agencias, mediaDiaAgencias),
  };
}

/** 6,4 · 12 — uma casa abaixo de 10, inteiro acima. */
function ritmoBR(m: number): string {
  const v = m >= 10 ? Math.round(m) : Math.round(m * 10) / 10;
  return String(v).replace(".", ",");
}

/** A frase do chat. `alvoDias`: quanto o estoque deveria durar (o "Estoque deve durar" da Reposição). */
export function respostaDeEstoque(r: ResumoDoGrupo, alvoDias = 30): string {
  const un = (n: number) => `${n} un`;
  const partes = [
    `${r.nome}: ${un(r.total)} no total — ${un(r.agencias)} em casa (disponível nas agências) e ${un(r.full)} no Full.`,
  ];
  if (r.mediaDia == null) {
    partes.push(`Sem venda nos últimos ${r.diasDoPeriodo} dias, então não dá pra dizer pra quantos dias dá.`);
  } else {
    const lado = (nome: string, m: number | null, vendidas: number, dias: number | null, estoque: number) =>
      m == null
        ? `${nome}: sem venda`
        : `${nome}: ~${ritmoBR(m)}/dia (${vendidas} un)${estoque === 0 ? " — está zerado" : dias != null ? ` — o estoque dele dá ~${dias} dias` : ""}`;
    partes.push(`Média de vendas nos últimos ${r.diasDoPeriodo} dias — ${lado("Full", r.mediaDiaFull, r.vendasFull, r.diasDeCoberturaFull, r.full)}; ${lado("Agências", r.mediaDiaAgencias, r.vendasAgencias, r.diasDeCoberturaAgencias, r.agencias)}.`);
    partes.push(`Somando os dois: ~${ritmoBR(r.mediaDia)}/dia, dá pra uns ${r.diasDeCobertura} dias.`);
    if ((r.diasDeCobertura ?? 0) < alvoDias) {
      const falta = Math.max(Math.ceil(r.mediaDia * alvoDias) - r.total, 0);
      partes.push(`Precisa repor: pra durar ${alvoDias} dias faltam ~${falta} un.`);
    } else {
      partes.push(`Não precisa repor agora (meta: durar ${alvoDias} dias).`);
    }
  }
  return partes.join(" ");
}
