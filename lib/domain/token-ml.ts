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
  /** QUEM está renovando — só o dono libera a própria concessão. */
  refreshLeaseDono?: string | null;
};

/** Margem antes do vencimento: renova com folga em vez de tomar 401 no meio. */
export const MARGEM_MS = 60_000;

/** Quanto tempo a concessão de renovação vale. Curto: um processo pode morrer. */
export const LEASE_MS = 30_000;

/**
 * Tempo máximo da chamada que troca token no ML (refresh e troca do código
 * do OAuth) — UMA tentativa, sem repetição.
 *
 * ─── POR QUE UMA TENTATIVA SÓ (S05/S06 da auditoria SaaS) ────────────────
 *
 * A troca passava por `fetchML` com 3 tentativas × 12 s + esperas: mais de
 * 37 s no pior caso, contra uma concessão de 30 s. O processo legítimo
 * perdia a concessão NO MEIO da própria chamada, outro entrava com o MESMO
 * refresh token — que o ML aceita uma vez só —, falhava e, ao falhar,
 * apagava a concessão do primeiro, abrindo a porta pra um terceiro.
 *
 * E repetir não ajuda aqui: se a primeira tentativa estourou o tempo DEPOIS
 * de o ML processá-la, o refresh token já foi consumido e a segunda recebe
 * `invalid_grant`, sempre. Uma falha limpa (503) é problema da PRÓXIMA
 * requisição, que encontra a concessão livre e tenta de novo.
 *
 * O teste em token-ml.test.ts quebra se alguém aumentar isto além do que a
 * concessão cobre.
 */
export const TIMEOUT_TROCA_TOKEN_MS = 15_000;

/** O que fazer com o resultado de uma renovação, na hora de gravar. */
export type DecisaoGravacao = {
  gravar: boolean;
  motivo: "ok" | "conexao_trocada" | "token_mais_novo_ja_gravado";
  /** Limpar a concessão? Só se ela ainda for de quem está gravando. */
  liberarConcessao: boolean;
};

/**
 * Grava o token novo, ou não? Compare-and-set no PRÓPRIO refresh token.
 *
 * ─── POR QUE NÃO "SÓ O DONO DA CONCESSÃO GRAVA" ──────────────────────────
 *
 * Parece o certo e seria pior. O refresh token do ML é de uso único: se o
 * processo A (lento, já sem a concessão) conseguiu trocar, o token que ele
 * tem na mão é o ÚNICO válido — o B, que entrou depois com o mesmo refresh
 * token, necessariamente falhou. Descartar o resultado do A por não ser mais
 * o dono jogaria fora a conexão.
 *
 * A pergunta certa é outra: "alguém gravou um token MAIS NOVO desde que eu
 * li?". Se o refresh token do documento ainda é o que eu usei, o meu é o
 * mais novo que existe — grava. Se mudou, alguém gravou depois de mim —
 * não sobrescreve (era esse o "o mais velho por cima do mais novo").
 *
 * E a concessão só é liberada por quem a detém: o B que falhou não apaga
 * mais a concessão do A que ainda está trabalhando.
 */
export function decidirGravacaoDoRefresh(
  pedido: { geracao: number; refreshUsado: string; dono: string },
  docAgora: DadosToken | null | undefined,
): DecisaoGravacao {
  const liberarConcessao = docAgora?.refreshLeaseDono === pedido.dono;
  if (!resultadoAindaVale(pedido.geracao, docAgora?.geracao)) {
    return { gravar: false, motivo: "conexao_trocada", liberarConcessao };
  }
  if ((docAgora?.refresh_token ?? null) !== pedido.refreshUsado) {
    return { gravar: false, motivo: "token_mais_novo_ja_gravado", liberarConcessao };
  }
  return { gravar: true, motivo: "ok", liberarConcessao };
}

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
