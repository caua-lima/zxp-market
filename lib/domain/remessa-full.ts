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

/** Informa (ou corrige) o custo da coleta. */
export function patchCusto(por: string, custo: number | null): PatchRemessa {
  const valor = custo == null || !Number.isFinite(Number(custo)) ? null : Number(custo);
  return {
    custoManual: valor,
    custoInformadoPor: por,
    custoInformadoEm: Date.now(),
  };
}

/** Um patch operacional cita algum campo financeiro? Deve ser sempre `false`. */
export function tocaFinanceiro(patch: PatchRemessa): boolean {
  return CAMPOS_FINANCEIROS_DA_REMESSA.some((c) => c in patch);
}
