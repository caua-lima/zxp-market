/**
 * O que cada ação escreve no documento da remessa Full — e o que ela NUNCA
 * pode tocar.
 *
 * ─── O QUE SE PERDIA ────────────────────────────────────────────────────
 *
 * O mesmo documento guarda duas coisas de naturezas diferentes:
 *
 *   ignorada / motivo          → estado OPERACIONAL ("já lancei essa baixa")
 *   custoManual / quem / quando → dado FINANCEIRO, digitado à mão
 *
 * O código já sabia disso — havia um comentário dizendo que os dois "são
 * independentes" e que "um não pode apagar o outro". Mas:
 *
 *   ignorarRemessaFull  fazia `setDoc(ref, {...})` SEM `{ merge: true }`.
 *                       No Firestore isso SUBSTITUI o documento inteiro, então
 *                       marcar uma remessa como resolvida apagava o custo.
 *
 *   reabrirRemessaFull  fazia `deleteDoc(ref)`. Reabrir é uma ação
 *                       operacional, e destruía o documento inteiro junto.
 *
 * O custo da coleta Full não vem da API do Mercado Livre — a documentação de
 * Fulfillment diz que só dá pra consultar estoque e operações. Esse número é
 * lido na tela do Seller Center e digitado à mão. Perdê-lo não é um campo
 * vazio que se recalcula: é alguém tendo que reabrir o painel do ML, achar a
 * remessa e digitar de novo. E, enquanto isso, o custo do Full na DRE fica
 * menor do que é.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────
 *
 * Ação operacional escreve SÓ campo operacional, sempre com merge. Apagar
 * custo é uma operação própria, explícita e registrada.
 */

/** Campos financeiros do documento — nenhuma ação operacional pode citá-los. */
export const CAMPOS_FINANCEIROS_DA_REMESSA = [
  "custoManual",
  "custoInformadoPor",
  "custoInformadoEm",
  // A data e as unidades da remessa vão junto do custo: é o que diz a que MÊS
  // ele pertence quando o ML já não devolve a remessa (ver lib/domain/coleta-full.ts).
  "data",
  "recebido",
  "dataInformadaPor",
  "dataInformadaEm",
] as const;

export type PatchRemessa = Record<string, unknown>;

/**
 * Marca a remessa como resolvida à mão.
 *
 * Só campos operacionais. O `createdBy`/`createdAt` viraram `ignoradaPor`/
 * `ignoradaEm`: os nomes antigos sugeriam que o documento tinha sido criado
 * por essa ação, quando ele pode já existir por causa do custo.
 */
export function patchIgnorar(por: string, motivo: string): PatchRemessa {
  return {
    ignorada: true,
    motivo,
    ignoradaPor: por,
    ignoradaEm: Date.now(),
  };
}

/**
 * Devolve a remessa pra lista de pendentes.
 *
 * `ignorada: false` em vez de apagar o documento — apagar levava o custo
 * junto. Os campos do "ignorar" são limpos pra não restar um motivo órfão
 * explicando um estado que não existe mais.
 */
export function patchReabrir(): PatchRemessa {
  return {
    ignorada: false,
    motivo: null,
    ignoradaPor: null,
    ignoradaEm: null,
  };
}

/**
 * Apagar o custo, explicitamente.
 *
 * `null` é diferente de ausente: significa "conferi e não há custo informado",
 * e é o que permite voltar atrás de um valor digitado errado. Fica registrado
 * quem apagou e quando, igual a informar.
 */
export function patchLimparCusto(por: string): PatchRemessa {
  return {
    custoManual: null,
    custoInformadoPor: por,
    custoInformadoEm: Date.now(),
  };
}

/** Contexto da remessa que acompanha o custo — o que o editor já tem na mão ao digitar. */
export type ContextoDaRemessa = { data?: string | null; recebido?: number | null };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Informa (ou corrige) o custo da coleta.
 *
 * Grava também a DATA da remessa (e as unidades) quando se sabe: sem ela, o
 * custo só encontra seu mês enquanto o ML ainda devolve aquela remessa (janela
 * de 55 dias) — depois disso ele continuava salvo e não entrava em DRE nenhuma.
 * Só entra no patch o que veio válido: nunca sobrescreve uma data boa por vazio.
 */
export function patchCusto(por: string, custo: number | null, ctx: ContextoDaRemessa = {}): PatchRemessa {
  const valor = custo == null || !Number.isFinite(Number(custo)) ? null : Number(custo);
  return {
    custoManual: valor,
    custoInformadoPor: por,
    custoInformadoEm: Date.now(),
    ...(typeof ctx.data === "string" && DIA.test(ctx.data) ? { data: ctx.data } : {}),
    ...(typeof ctx.recebido === "number" && Number.isFinite(ctx.recebido) && ctx.recebido >= 0 ? { recebido: ctx.recebido } : {}),
  };
}

/**
 * Informa a DATA de uma remessa cujo custo foi digitado sem ela. Não toca no
 * valor do custo. `null` se a data não for um dia válido (AAAA-MM-DD) — quem
 * chama recusa em vez de gravar lixo.
 */
export function patchData(por: string, data: string): PatchRemessa | null {
  if (!DIA.test(String(data ?? ""))) return null;
  const d = new Date(`${data}T00:00:00Z`);
  // Rejeita dia que o calendário não tem (2026-02-31 vira 03-03 e não bate de volta).
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== data) return null;
  return { data, dataInformadaPor: por, dataInformadaEm: Date.now() };
}

/** Um patch operacional cita algum campo financeiro? Deve ser sempre `false`. */
export function tocaFinanceiro(patch: PatchRemessa): boolean {
  return CAMPOS_FINANCEIROS_DA_REMESSA.some((c) => c in patch);
}
