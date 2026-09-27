/**
 * Roda uma vez quando o servidor sobe (convenção do Next — ver
 * node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
 *
 * S26: confere a configuração e escreve no log o que falta, SEM derrubar o
 * servidor — uma regra nova rígida demais aqui não pode tirar a produção do ar.
 * Só nomes de variável vão pro log (lib/config/ambiente.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { conferirAmbiente } = await import("./lib/config/ambiente");
  const { erros, avisos } = conferirAmbiente(process.env, { producao: process.env.NODE_ENV === "production" });
  if (erros.length) console.error(`[config] ${erros.length} problema(s): ${erros.join("; ")}`);
  if (avisos.length) console.warn(`[config] ${avisos.join("; ")}`);
}
