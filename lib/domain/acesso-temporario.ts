/**
 * Acesso com prazo (Etapa 6 — Acesso: "suporte temporário auditado").
 *
 * O dono dá acesso a alguém de suporte (ou a um freelancer) por alguns dias;
 * passado o prazo, a pessoa perde o acesso sozinha — no servidor, nas regras
 * do Firestore e na tela — sem depender de alguém lembrar de remover.
 *
 * Autossuficiente (sem `@/`).
 */

export const PRAZOS_EM_DIAS = [1, 7, 30] as const;

/** `expiraEm` (ms) a partir de dias; null = permanente. Fora de 1..30, recusa. */
export function expiraEmDe(dias: unknown, agora: number): number | null | "invalido" {
  if (dias === undefined || dias === null || dias === "" || dias === 0) return null;
  const n = Number(dias);
  if (!Number.isInteger(n) || n < 1 || n > 30) return "invalido";
  return agora + n * 86_400_000;
}

export function acessoExpirado(dados: { expiraEm?: unknown } | null | undefined, agora: number): boolean {
  const e = dados?.expiraEm;
  return typeof e === "number" && agora >= e;
}
