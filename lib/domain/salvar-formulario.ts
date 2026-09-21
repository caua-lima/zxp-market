/**
 * Salvar um formulário sem perder o que a pessoa digitou.
 *
 * ─── O QUE ACONTECIA ────────────────────────────────────────────────────
 *
 * O modal de produto chamava `onSave`, que capturava a falha num `alert` e
 * fechava o formulário num `finally` — de modo que salvar com erro e salvar com
 * sucesso terminavam igual: o formulário sumia. Nome, SKU, custo e imposto
 * digitados eram descartados, e a única pista era um alerta que já tinha
 * passado. O `catch` do próprio modal nunca disparava, porque quem chamava já
 * tinha engolido o erro.
 *
 * ─── O CONTRATO ─────────────────────────────────────────────────────────
 *
 * Quem grava LANÇA quando falha e só fecha quando termina. Quem desenha o
 * formulário chama `salvarSemPerder`, recebe um resultado em vez de uma
 * exceção, e em caso de falha mostra a mensagem DENTRO do formulário, com os
 * valores intactos e o mesmo botão pra tentar de novo. O identificador do item
 * é criado antes de abrir o formulário, então repetir regrava o mesmo
 * documento e não cria um segundo.
 */

export type ResultadoDoSalvamento = { ok: true } | { ok: false; mensagem: string };

/** Traduz o erro do Firebase/rede pro que a pessoa precisa fazer. */
export function mensagemDeErroDeSalvamento(err: unknown): string {
  const codigo = String((err as { code?: unknown } | null)?.code ?? "");
  const texto = err instanceof Error ? err.message : String(err ?? "");

  if (/permission-denied|unauthenticated/.test(codigo) || /missing or insufficient permissions/i.test(texto)) {
    return "Você não tem permissão pra salvar isto, ou a sessão expirou. Nada foi salvo; entre de novo e tente outra vez.";
  }
  if (/unavailable|deadline-exceeded|network|failed-precondition/.test(codigo) || /network|timeout|timed out|offline|failed to fetch/i.test(texto)) {
    return "Não consegui falar com o servidor. Confira a conexão e tente de novo — o que você digitou continua aqui.";
  }
  const detalhe = texto.trim();
  return detalhe
    ? `Não foi possível salvar: ${detalhe}. O que você digitou continua aqui.`
    : "Não foi possível salvar. O que você digitou continua aqui.";
}

/** Executa o salvamento e devolve o resultado, sem nunca lançar. */
export async function salvarSemPerder(gravar: () => Promise<void>): Promise<ResultadoDoSalvamento> {
  try {
    await gravar();
    return { ok: true };
  } catch (err) {
    return { ok: false, mensagem: mensagemDeErroDeSalvamento(err) };
  }
}
