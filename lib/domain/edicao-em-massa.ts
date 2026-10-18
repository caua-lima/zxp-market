/**
 * Edição em massa de nome e SKU dos produtos.
 *
 * Com o estoque separado por tipo de anúncio ("Limão Caipira" e "Limão Caipira
 * Agências"), há dezenas de cadastros pra renomear de uma vez — pôr um sufixo,
 * trocar um trecho, padronizar o SKU. Esta parte é só a conta: o que cada linha
 * vira e o que impede de gravar.
 *
 * ─── O SKU É A CHAVE DA VENDA ───────────────────────────────────────────
 *
 * O pedido do ML traz o SKU do anúncio, e é por ele que a venda acha o produto
 * (e o custo dele, e a margem). Dois produtos com o mesmo SKU brigam pela mesma
 * venda; um SKU que deixa de bater com o anúncio faz a venda ficar sem produto
 * (CMV zero, margem inflada). Por isso:
 *
 *   · SKU repetido (entre os editados E entre os que não mudam) BLOQUEIA gravar;
 *   · SKU alterado entra num aviso — pode estar certo, mas é onde o erro caro mora.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export const NOME_MAX = 300;
export const SKU_MAX = 60;

export type Transformacao = {
  prefixo?: string;
  sufixo?: string;
  /** Trecho a trocar (todas as ocorrências, sem diferenciar maiúscula de minúscula). Vazio = não troca. */
  localizar?: string;
  substituir?: string;
};

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Aplica, nesta ordem: trocar trecho → prefixo → sufixo. Espaços sobrando saem. */
export function transformar(valor: string, t: Transformacao): string {
  let v = String(valor ?? "");
  const achar = String(t.localizar ?? "");
  if (achar !== "") v = v.replace(new RegExp(escapar(achar), "gi"), () => String(t.substituir ?? ""));
  v = `${t.prefixo ?? ""}${v}${t.sufixo ?? ""}`;
  return v.replace(/\s{2,}/g, " ").trim();
}

/** `true` quando a transformação não faz nada (nenhum campo preenchido). */
export function transformacaoVazia(t: Transformacao): boolean {
  return !String(t.prefixo ?? "") && !String(t.sufixo ?? "") && !String(t.localizar ?? "");
}

export const chaveDoSku = (s: unknown) => String(s ?? "").trim().toLowerCase();

export type LinhaDeEdicao = { id: string; nome: string; sku: string; novoNome: string; novoSku: string };

export type ProblemaDaLinha = { nome?: string; sku?: string };

export type ResultadoDaEdicao = {
  /** Linhas em que nome ou SKU mudou de fato. */
  mudancas: LinhaDeEdicao[];
  /** Problemas por id de produto. Qualquer entrada aqui bloqueia a gravação. */
  erros: Map<string, ProblemaDaLinha>;
  /** Linhas com SKU alterado — aviso, não bloqueio. */
  skusAlterados: LinhaDeEdicao[];
};

/**
 * `outros`: os produtos que NÃO estão sendo editados mas existem — o SKU novo não
 * pode colidir com o deles. As linhas editadas são conferidas entre si e contra eles.
 */
export function validarEdicao(
  linhas: readonly LinhaDeEdicao[],
  outros: readonly { id: string; sku?: string }[] = [],
): ResultadoDaEdicao {
  const erros = new Map<string, ProblemaDaLinha>();
  const marca = (id: string, campo: keyof ProblemaDaLinha, msg: string) => erros.set(id, { ...erros.get(id), [campo]: msg });

  const mudancas = linhas.filter((l) => l.novoNome.trim() !== l.nome.trim() || l.novoSku.trim() !== l.sku.trim());
  const editando = new Set(linhas.map((l) => l.id));

  // O SKU que cada produto terá depois: o novo, pras linhas; o atual, pros demais.
  const dono = new Map<string, string[]>();
  const entra = (id: string, sku: string) => {
    const k = chaveDoSku(sku);
    if (!k) return;
    dono.set(k, [...(dono.get(k) ?? []), id]);
  };
  for (const l of linhas) entra(l.id, l.novoSku);
  for (const o of outros) if (!editando.has(o.id)) entra(o.id, o.sku ?? "");

  for (const l of mudancas) {
    const nome = l.novoNome.trim();
    if (!nome) marca(l.id, "nome", "O nome não pode ficar vazio.");
    else if (nome.length > NOME_MAX) marca(l.id, "nome", `O nome passa de ${NOME_MAX} caracteres.`);

    const sku = l.novoSku.trim();
    if (sku.length > SKU_MAX) marca(l.id, "sku", `O SKU passa de ${SKU_MAX} caracteres.`);
    const k = chaveDoSku(sku);
    if (k && (dono.get(k)?.length ?? 0) > 1) marca(l.id, "sku", "Este SKU já é de outro produto — dois produtos com o mesmo SKU brigam pela mesma venda.");
  }

  return { mudancas, erros, skusAlterados: mudancas.filter((l) => chaveDoSku(l.novoSku) !== chaveDoSku(l.sku)) };
}
