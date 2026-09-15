/**
 * Quando o token do Mercado Livre expira, e quem pode renová-lo.
 *
 * ─── O RELÓGIO ERA COMPARTILHADO COM OUTRA COISA ────────────────────────
 *
 * A expiração era calculada assim:
 *
 *   expiresAt = Date.parse(tokenData.updated_at) + expires_in * 1000
 *
 * Mas `updated_at` não é "quando o token foi emitido" — é "quando o documento
 * foi tocado pela última vez". O callback do OAuth grava `updated_at` junto com
 * o perfil; qualquer `set(..., { merge: true })` futuro no mesmo documento faz
 * o mesmo. Atualizar o perfil do vendedor EMPURRAVA a validade do token pra
 * frente, e o app seguia usando um access token já morto até tomar 401 do ML.
 *
 * Agora o token tem relógio próprio: `tokenIssuedAt` e `expiresAt`, escritos
 * só por quem emite token. `updated_at` volta a ser o que o nome diz.
 *
 * ─── DESCONHECIDO NÃO É "VÁLIDO" ────────────────────────────────────────
 *
 * `tokenExpired` devolvia `false` quando faltava `expires_in` ou `updated_at`:
 * sem saber, assumia que o token estava bom. Um documento sem esses campos
 * nunca renovava, e TODA chamada ao ML falhava com 401 até alguém reconectar
 * na mão. Sem informação, o certo é renovar — o custo é uma chamada a mais.
 *
 * ─── DUAS RENOVAÇÕES AO MESMO TEMPO ─────────────────────────────────────
 *
 * Nada coordenava. Duas requisições que achassem o token vencido chamavam
 * `refreshAccessToken` com o MESMO refresh_token. O Mercado Livre ROTACIONA o
 * refresh token: a segunda chamada usa um valor já consumido e falha — e, pior,
 * a resposta que chegasse por último sobrescrevia a mais nova com a mais
 * velha, deixando gravado um token que já não vale.
 *
 * Daí a concessão (lease): quem for renovar marca o documento por um tempo
 * curto, e os outros esperam a gravação em vez de disparar a própria chamada.
 */

export type DadosToken = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  /** Instante (ms) em que o token foi EMITIDO. Relógio próprio do token. */
  tokenIssuedAt?: number | null;
  /** Instante (ms) em que ele expira. Derivado na emissão, não na leitura. */
  expiresAt?: number | null;
  /** Legado: "quando o documento foi tocado". Só entra como último recurso. */
  updated_at?: string | null;
  /** Sobe a cada vínculo concluído — ver app/api/ml/callback. */
  geracao?: number | null;
  /** Até quando alguém já está renovando. */
  refreshLeaseAte?: number | null;
};

/** Margem antes do vencimento: renova com folga em vez de tomar 401 no meio. */
export const MARGEM_MS = 60_000;

/** Quanto tempo a concessão de renovação vale. Curto: um processo pode morrer. */
export const LEASE_MS = 30_000;

/**
 * Quando este token expira, em ms. `null` = não dá pra saber.
 *
 * Ordem: o relógio próprio do token; depois o legado `updated_at + expires_in`,
 * que serve pros documentos gravados antes destes campos existirem.
 */
export function expiraEm(t: DadosToken | null | undefined): number | null {
  const proprio = Number(t?.expiresAt);
  if (Number.isFinite(proprio) && proprio > 0) return proprio;

  const emitido = Number(t?.tokenIssuedAt);
  const dura = Number(t?.expires_in);
  if (Number.isFinite(emitido) && emitido > 0 && Number.isFinite(dura) && dura > 0) {
    return emitido + dura * 1000;
  }

  // Legado: `updated_at` é o carimbo do DOCUMENTO, não do token. Serve só
  // enquanto os documentos antigos não forem reemitidos.
  const tocado = Date.parse(String(t?.updated_at ?? ""));
  if (Number.isFinite(tocado) && Number.isFinite(dura) && dura > 0) {
    return tocado + dura * 1000;
  }

  return null;
}

/**
 * Precisa renovar agora?
 *
 * Sem token de acesso, sim. Sem saber a validade, TAMBÉM sim — "não sei" não
 * pode virar "está bom", que era o que fazia um documento incompleto nunca
 * renovar e derrubar toda chamada ao ML.
 */
export function precisaRenovar(
  t: DadosToken | null | undefined,
  agora: number,
  margemMs: number = MARGEM_MS,
): boolean {
  if (!t?.access_token) return true;
  const fim = expiraEm(t);
  if (fim == null) return true;
  return agora >= fim - margemMs;
}

/** Os campos do relógio, pra gravar na emissão. Um lugar só. */
export function relogioDoToken(expiresInSegundos: unknown, agora: number): {
  tokenIssuedAt: number;
  expiresAt: number | null;
} {
  const dura = Number(expiresInSegundos);
  return {
    tokenIssuedAt: agora,
    expiresAt: Number.isFinite(dura) && dura > 0 ? agora + dura * 1000 : null,
  };
}

/**
 * Dá pra assumir a renovação, ou alguém já está nela?
 *
 * Concessão vencida é assumível: o processo que a tomou pode ter morrido, e
 * travar pra sempre por causa disso seria pior que uma chamada a mais.
 */
export function podeAssumirRenovacao(t: DadosToken | null | undefined, agora: number): boolean {
  const ate = Number(t?.refreshLeaseAte);
  if (!Number.isFinite(ate)) return true;
  return agora >= ate;
}

/**
 * O resultado de uma renovação ainda vale?
 *
 * Entre pedir o token novo ao ML e gravá-lo, a conexão pode ter sido trocada
 * ou removida — e `geracao` sobe a cada vínculo concluído. Gravar assim mesmo
 * RESSUSCITARIA a conexão anterior, com o token de uma conta que já não é a
 * conectada.
 */
export function resultadoAindaVale(
  geracaoQuandoPediu: number | null | undefined,
  geracaoAgora: number | null | undefined,
): boolean {
  return Number(geracaoQuandoPediu ?? 0) === Number(geracaoAgora ?? 0);
}
