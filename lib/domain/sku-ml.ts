/**
 * Levar a troca de SKU do app pro anúncio no Mercado Livre — sem precisar
 * mudar nos dois lugares.
 *
 * Esta parte é só a decisão: dado o anúncio como o ML devolve
 * (`GET /items/{id}`), o SKU antigo e o novo, o que mandar no `PUT` — e,
 * depois, se o anúncio ficou como devia. Quem chama a API é a rota.
 *
 * ─── ONDE O SKU MORA NO ANÚNCIO ─────────────────────────────────────────
 *
 * No atributo `SELLER_SKU` (do anúncio ou de cada variação). O campo antigo
 * `seller_custom_field` é "uso interno do vendedor, sem relação" — doc de
 * Variações do ML: "Você sempre deve carregar o valor no atributo para que ele
 * seja considerado". Por isso a escrita é SEMPRE no atributo; o campo antigo só
 * é lido, pra reconhecer anúncio que ainda o usa.
 *
 * ─── A ARMADILHA DAS VARIAÇÕES ──────────────────────────────────────────
 *
 * Num anúncio com variações, o `PUT` precisa listar TODAS as variações pelo id.
 * A que ficar de fora é APAGADA (doc de Variações: "No caso de não enviar todos
 * os IDs das variações, serão apagadas aquelas que não tenham sido enviadas").
 * Então o corpo leva todas, e só as do SKU antigo levam o atributo novo.
 *
 * Atributos: "Se somente envia no PUT os atributos que precisa alterar, os demais
 * não serão eliminados" (doc de Atributos) — só o `SELLER_SKU` vai no corpo.
 *
 * ─── O QUE NÃO SE MEXE ──────────────────────────────────────────────────
 *
 * Anúncio cujo SKU atual é OUTRO (nem o antigo, nem vazio) fica como está e
 * entra no relatório: pode ser de outro produto, e sobrescrever faria a venda
 * dele cair no produto errado. Variações com SKUs diferentes e nenhuma com o
 * antigo: mesmo motivo.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type AtributoML = { id?: string; value_id?: string | null; value_name?: string | null };
export type VariacaoML = { id: number | string; attributes?: AtributoML[]; seller_custom_field?: string | null };
export type ItemML = {
  id: string;
  title?: string;
  status?: string;
  seller_custom_field?: string | null;
  attributes?: AtributoML[];
  variations?: VariacaoML[];
};

/** Mesma comparação que liga a venda ao produto: sem diferença de caixa nem espaço na borda. */
export const mesmoSku = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** O SKU de um anúncio ou variação: o atributo SELLER_SKU, ou o campo antigo se o atributo não existir. */
export function skuDe(alvo: { attributes?: AtributoML[]; seller_custom_field?: string | null }): string {
  const attr = (alvo.attributes ?? []).find((a) => String(a?.id) === "SELLER_SKU");
  const v = String(attr?.value_name ?? "").trim();
  return v || String(alvo.seller_custom_field ?? "").trim();
}

const ATRIBUTO = (sku: string): AtributoML[] => [{ id: "SELLER_SKU", value_name: sku }];

export type CorpoDoPut = {
  attributes?: AtributoML[];
  variations?: { id: number | string; attributes?: AtributoML[] }[];
};

export type PlanoDoAnuncio =
  | {
      acao: "alterar";
      mlb: string;
      titulo: string;
      /** O SKU que está lá hoje (do anúncio, ou o das variações alvo). */
      skuAtual: string;
      corpo: CorpoDoPut;
      /** Ids das variações que mudam. Vazio = o SKU é do anúncio (sem variações). */
      variacoes: (number | string)[];
      /** Quantas variações o anúncio tem (0 = nenhuma). Conferido depois do PUT. */
      totalVariacoes: number;
    }
  | { acao: "ja-esta"; mlb: string; titulo: string; skuAtual: string }
  | { acao: "nao-mexer"; mlb: string; titulo: string; skuAtual: string; motivo: string };

export function planejarSkuNoAnuncio(item: ItemML, skuAntigo: string, skuNovo: string): PlanoDoAnuncio {
  const mlb = String(item.id ?? "");
  const titulo = String(item.title ?? "");
  const novo = String(skuNovo ?? "").trim();
  const variacoes = item.variations ?? [];

  if (!novo) return { acao: "nao-mexer", mlb, titulo, skuAtual: skuDe(item), motivo: "O SKU novo está vazio — o anúncio fica com o que tem." };

  // ── Sem variações: o SKU é do anúncio ──
  if (variacoes.length === 0) {
    const atual = skuDe(item);
    if (mesmoSku(atual, novo) && String(atual).trim() === novo) return { acao: "ja-esta", mlb, titulo, skuAtual: atual };
    if (atual && !mesmoSku(atual, skuAntigo) && !mesmoSku(atual, novo)) {
      return { acao: "nao-mexer", mlb, titulo, skuAtual: atual, motivo: `O anúncio está com o SKU “${atual}”, que não é o antigo. Pode ser de outro produto — não alterei.` };
    }
    return { acao: "alterar", mlb, titulo, skuAtual: atual, corpo: { attributes: ATRIBUTO(novo) }, variacoes: [], totalVariacoes: 0 };
  }

  // ── Com variações: só as do SKU antigo ──
  const doAntigo = variacoes.filter((v) => skuDe(v) && mesmoSku(skuDe(v), skuAntigo) && skuDe(v).trim() !== novo);
  let alvo = doAntigo;
  if (alvo.length === 0) {
    const jaNovas = variacoes.filter((v) => skuDe(v).trim() === novo);
    if (jaNovas.length > 0) return { acao: "ja-esta", mlb, titulo, skuAtual: novo };
    // Uma variação só e sem SKU nenhum: é dela.
    if (variacoes.length === 1 && !skuDe(variacoes[0])) alvo = variacoes;
  }
  if (alvo.length === 0) {
    const vistos = [...new Set(variacoes.map((v) => skuDe(v)).filter(Boolean))];
    return {
      acao: "nao-mexer", mlb, titulo, skuAtual: vistos.join(", "),
      motivo: vistos.length
        ? `Nenhuma variação está com o SKU antigo (têm: ${vistos.join(", ")}). Não alterei pra não trocar a de outro produto.`
        : `O anúncio tem ${variacoes.length} variações sem SKU — não dá pra saber qual é deste produto. Não alterei.`,
    };
  }

  const ids = new Set(alvo.map((v) => String(v.id)));
  const corpo: CorpoDoPut = {
    // TODAS as variações vão no corpo: a que ficar de fora é apagada pelo ML.
    variations: variacoes.map((v) => (ids.has(String(v.id)) ? { id: v.id, attributes: ATRIBUTO(novo) } : { id: v.id })),
  };
  // O SKU também no nível do anúncio, se ele tinha o antigo lá.
  const doItem = skuDe(item);
  if (doItem && mesmoSku(doItem, skuAntigo)) corpo.attributes = ATRIBUTO(novo);

  return {
    acao: "alterar", mlb, titulo, skuAtual: skuDe(alvo[0]), corpo,
    variacoes: alvo.map((v) => v.id), totalVariacoes: variacoes.length,
  };
}

/**
 * Depois do PUT, o anúncio relido: o SKU tem que estar lá, e NENHUMA variação
 * pode ter sumido. Se algo não bate, a tela diz — "salvo" sem conferir foi o
 * que já custou caro neste app.
 */
export function conferirSkuNoAnuncio(
  depois: ItemML,
  plano: Extract<PlanoDoAnuncio, { acao: "alterar" }>,
  skuNovo: string,
): { ok: true } | { ok: false; problema: string } {
  const novo = String(skuNovo).trim();
  const vars = depois.variations ?? [];
  if (plano.totalVariacoes === 0) {
    return skuDe(depois).trim() === novo ? { ok: true } : { ok: false, problema: `O ML aceitou, mas o anúncio continua com o SKU “${skuDe(depois) || "vazio"}”.` };
  }
  if (vars.length !== plano.totalVariacoes) {
    return { ok: false, problema: `O anúncio tinha ${plano.totalVariacoes} variações e agora tem ${vars.length}. Confira no Mercado Livre.` };
  }
  const porId = new Map(vars.map((v) => [String(v.id), v]));
  for (const id of plano.variacoes) {
    const v = porId.get(String(id));
    if (!v) return { ok: false, problema: `A variação ${id} não aparece mais no anúncio. Confira no Mercado Livre.` };
    if (skuDe(v).trim() !== novo) return { ok: false, problema: `A variação ${id} continua com o SKU “${skuDe(v) || "vazio"}”.` };
  }
  return { ok: true };
}

/** Mensagem legível pra um erro do ML no PUT. */
export function explicarErroDoMl(status: number, corpo: unknown): string {
  const j = (corpo ?? {}) as { message?: string; error?: string; cause?: { message?: string; code?: string }[] };
  const causa = (j.cause ?? []).map((c) => c?.message || c?.code).filter(Boolean).join(" · ");
  if (status === 401) return "A conexão com o Mercado Livre expirou. Reconecte a conta e tente de novo.";
  if (status === 403) return "O Mercado Livre recusou a alteração (sem permissão de escrita nesta conexão ou neste anúncio). Reconecte a conta autorizando alterações.";
  if (status === 429) return "O Mercado Livre pediu pra esperar (muitas alterações seguidas). Tente de novo em alguns minutos.";
  const msg = [j.message || j.error, causa].filter(Boolean).join(" — ");
  return msg ? `O Mercado Livre recusou: ${msg}` : `O Mercado Livre recusou a alteração (HTTP ${status}).`;
}
