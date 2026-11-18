"use client";

import { authedFetch } from "@/lib/api/authed-fetch";
import { transferirEstoque } from "@/lib/firebase/data";
import { planejarTransferencia } from "@/lib/domain/transferencia-estoque";
import { chaveDoGrupo } from "@/lib/domain/grupo-produto";
import { estoqueForaDoFull } from "@/lib/domain/estoque";
import type { Product } from "@/lib/domain/types";
import { custoMedioDe, fullDe, normMlb, type EstoqueML } from "./estoque-compartilhado";

/**
 * "EM CASA" É UM SÓ (pedido do dono, 17/11/2026).
 *
 * O que está em casa mora no cadastro "… Agências" do sabor (o livro) e no
 * anúncio de agência do ML (cada venda desconta sozinha). O produto do Full não
 * guarda estoque de casa: ele MOSTRA o mesmo número das Agências e, quando sai
 * um envio pro Full, a mercadoria sai DAQUI — transferência das Agências pro
 * Full (o custo vai junto, a média não muda) seguida da baixa `saida_full`, e
 * o anúncio de agência no ML desce a mesma quantidade.
 */

/** O cadastro de Agências do mesmo sabor (mesmo grupo, canal "agências"), ou null. */
export function irmaoDeAgencias(produto: Product, produtos: readonly Product[]): Product | null {
  if (produto.canal === "agencias") return null;
  const chave = chaveDoGrupo(produto);
  if (chave.startsWith("produto:")) return null;
  const irmaos = produtos.filter((p) => p.id !== produto.id && p.ativo !== false && p.canal === "agencias" && chaveDoGrupo(p) === chave);
  return irmaos.length === 1 ? irmaos[0] : null;
}

/**
 * Antes da baixa `saida_full` do produto Full: traz das Agências o que o livro
 * do Full não tem. Devolve quantas unidades vieram (0 = o Full já tinha).
 */
export async function trazerDasAgencias(e: {
  full: Product; irmao: Product; quantidade: number; data: string; idBase: string; estoqueML: EstoqueML;
}): Promise<number> {
  const falta = e.quantidade - Math.max(Number(e.full.qtdLocal) || 0, 0);
  if (falta <= 0) return 0;
  const fi = fullDe(e.irmao, e.estoqueML);
  const ff = fullDe(e.full, e.estoqueML);
  const plano = planejarTransferencia({
    de: {
      id: e.irmao.id, nome: e.irmao.name, emCasa: Math.max(Number(e.irmao.qtdLocal) || 0, 0),
      estoqueTotal: fi.qtd + estoqueForaDoFull(Math.max(Number(e.irmao.qtdLocal) || 0, 0), fi.proprio, fi.ehFull),
      custoMedio: custoMedioDe(e.irmao),
    },
    para: {
      id: e.full.id, nome: e.full.name,
      estoqueTotal: ff.qtd + Math.max(Number(e.full.qtdLocal) || 0, 0),
      custoMedio: custoMedioDe(e.full),
    },
    quantidade: falta, data: e.data, obs: "envio pro Full", idBase: `full-${e.idBase}`,
  });
  if (!plano.ok) throw new Error(`Não deu pra tirar das Agências: ${plano.motivo}`);
  await transferirEstoque(plano, { de: e.irmao.name, para: e.full.name });
  return falta;
}

/**
 * O anúncio de agência no ML desce a quantidade que foi pro Full. Só quando o
 * cadastro de Agências tem UM estoque de anúncio (pares sincronizados contam
 * como um); com estoque dividido entre anúncios, não chuta de qual tirar.
 */
export async function descontarDoAnuncioDeAgencias(irmao: Product, quantidade: number): Promise<{ ok: boolean; texto: string }> {
  if (quantidade <= 0) return { ok: true, texto: "" };
  try {
    const r = await authedFetch("/api/ml/estoque-ml", { cache: "no-store" });
    const estoque = ((await r.json()) as { estoque?: EstoqueML }).estoque ?? {};
    const mlbs = (Array.isArray(irmao.mlbs) && irmao.mlbs.length ? irmao.mlbs : irmao.mlb ? [irmao.mlb] : []).map(normMlb);
    const proprios = mlbs.map((m) => ({ mlb: m, item: estoque[m] })).filter((x) => x.item && x.item.logistic !== "fulfillment");
    const pools = new Map<string, { mlb: string; available: number }>();
    for (const x of proprios) {
      const pool = x.item!.poolProprio || x.mlb;
      if (!pools.has(pool)) pools.set(pool, { mlb: x.mlb, available: x.item!.available });
    }
    if (pools.size !== 1) {
      return { ok: false, texto: `Tire ${quantidade} un do anúncio de agência no ML à mão: ${irmao.name} tem ${pools.size} estoques de anúncio e não sei de qual tirar.` };
    }
    const [{ mlb, available }] = [...pools.values()];
    const novo = Math.max(available - quantidade, 0);
    const res = await authedFetch("/api/ml/estoque-anuncio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modo: "aplicar", motivo: `envio pro Full: ${quantidade} un saíram de casa`, itens: [{ mlb, quantidade: novo }] }),
    });
    const j = (await res.json().catch(() => null)) as { anuncios?: { resultado?: string; acao?: string; erro?: string }[]; details?: string } | null;
    const a = j?.anuncios?.[0];
    if (res.ok && (a?.resultado === "ok" || a?.acao === "ja-esta")) return { ok: true, texto: `Anúncio de agência no ML: ${available} → ${novo} un.` };
    return { ok: false, texto: `Não consegui baixar o anúncio de agência no ML (${a?.erro ?? j?.details ?? `erro ${res.status}`}). Tire ${quantidade} un à mão.` };
  } catch {
    return { ok: false, texto: `Não consegui falar com o ML. Tire ${quantidade} un do anúncio de agência à mão.` };
  }
}
