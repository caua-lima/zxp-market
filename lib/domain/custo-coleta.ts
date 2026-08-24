/**
 * Edição em LOTE dos custos de coleta do Full.
 *
 * ─── POR QUE ISTO É UM MÓDULO, E NÃO ESTADO SOLTO NA TELA ───────────────
 *
 * A tela antiga salvava uma coleta por vez e recarregava tudo a cada salvar:
 * quem tinha cinco valores pra informar recarregava cinco vezes, perdendo a
 * posição da rolagem e o foco no meio do trabalho. Editar várias e salvar uma
 * vez só exige saber, com precisão, O QUE mudou — e essa decisão tem uma
 * sutileza que merece teste:
 *
 *   · campo em branco onde JÁ HAVIA custo  → alteração (limpar)
 *   · campo em branco onde NÃO havia custo → nada mudou
 *   · valor igual ao que já estava salvo   → nada mudou
 *
 * Sem essa distinção, salvar em lote gravaria `null` por cima de custos já
 * informados só porque o usuário não tocou naquela linha — apagando dado bom
 * em silêncio. É o tipo de erro que só aparece na DRE, semanas depois.
 *
 * ─── POR QUE `null` NÃO É ZERO ──────────────────────────────────────────
 *
 * `null` = "não sabemos" (o ML não expõe pela API). `0` = coleta grátis, que
 * é informação de verdade. Tratar um como o outro subestima custo e infla
 * lucro, então o parse mantém os dois separados.
 */

export type LinhaCusto = {
  remessa: string;
  /** O que já está salvo. null = não informado. */
  custo: number | null;
};

export type Alteracao = {
  remessa: string;
  /** null = limpar o custo (voltar pra "não informado"). */
  valor: number | null;
};

export type ResultadoDiff = {
  /** Só o que de fato mudou — o que vai pro banco. */
  alteracoes: Alteracao[];
  /** Remessas cujo texto digitado não é um número válido. */
  invalidas: string[];
};

/**
 * Lê o que foi digitado. Aceita vírgula decimal (é o teclado brasileiro) e
 * espaços nas pontas.
 *
 * Devolve `{ ok: false }` pra texto que não é número, e para negativo:
 * coleta com custo negativo não existe, e aceitar viraria um crédito falso
 * no resultado.
 */
export function parseCusto(bruto: string): { ok: true; valor: number | null } | { ok: false } {
  const t = String(bruto ?? "").trim().replace(",", ".");
  if (t === "") return { ok: true, valor: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, valor: n };
}

/** Compara centavos, não floats: 97.38 e 97.380000001 são o mesmo custo. */
function mesmoValor(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

export function diffCustos(
  originais: LinhaCusto[],
  rascunho: Readonly<Record<string, string>>,
): ResultadoDiff {
  const alteracoes: Alteracao[] = [];
  const invalidas: string[] = [];

  for (const linha of originais) {
    const digitado = rascunho[linha.remessa];
    // Linha que o usuário nem tocou não entra no lote — é o que impede
    // sobrescrever custo bom com null.
    if (digitado === undefined) continue;

    const lido = parseCusto(digitado);
    if (!lido.ok) {
      invalidas.push(linha.remessa);
      continue;
    }
    if (mesmoValor(lido.valor, linha.custo)) continue;
    alteracoes.push({ remessa: linha.remessa, valor: lido.valor });
  }

  return { alteracoes, invalidas };
}

/** Total informado — o que de fato entra na DRE. Sem custo fica de fora. */
export function totalInformado(linhas: LinhaCusto[]): number {
  return linhas.reduce((s, l) => s + (l.custo ?? 0), 0);
}
