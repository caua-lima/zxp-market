/**
 * Quais registros de push viram destinos de um aviso — e o que se pode afirmar
 * sobre registros antigos.
 *
 * ─── O QUE O DEDUPE ANTIGO FAZIA ────────────────────────────────────────
 *
 * `deduplicarPorDispositivo` apagava do banco, NO CAMINHO DO ENVIO, todo
 * registro legado (sem deviceId) de um e-mail que tivesse QUALQUER registro
 * novo, e mantinha só um legado por e-mail. A premissa era "o deploy troca o
 * código de todo mundo de uma vez, então o legado é sobra". Não é:
 *
 *  - uma pessoa com celular E notebook ativa o push num aparelho depois do
 *    deploy: o registro do OUTRO aparelho, legado e perfeitamente vivo, era
 *    apagado — e ela deixava de receber lá sem nenhum aviso;
 *  - o legado é indexado pelo token, não pelo aparelho: dois celulares
 *    legados do mesmo e-mail eram reduzidos a um.
 *
 * E o envio fazia isso com escrita destrutiva a cada aviso.
 *
 * ─── O QUE SE PODE AFIRMAR ──────────────────────────────────────────────
 *
 * Só duas coisas provam "mesmo aparelho":
 *  - o MESMO token (é o aparelho, por definição);
 *  - o MESMO (e-mail, deviceId) — o id do documento já garante isso.
 *
 * O e-mail sozinho não prova nada. Um legado de outro token continua sendo,
 * até prova em contrário, um aparelho — e o custo de mantê-lo é, no pior caso,
 * uma notificação que o aparelho colapsa pela `tag`. O custo de apagá-lo é
 * uma pessoa sem aviso, sem saber. O assimétrico decide.
 *
 * O envio, portanto, NUNCA apaga nada por dedupe. Limpeza é uma operação
 * explícita, com simulação antes (ver diagnosticarRegistros).
 */

export type RegistroDeDestino = {
  docId: string;
  token: string;
  updatedAt: number;
  deviceId: string;
  email: string;
  userAgent: string;
};

/**
 * Os destinos de um envio: um por TOKEN. Registros repetidos do mesmo token
 * (o mais recente vence) não geram duas mensagens pro mesmo aparelho.
 * Não escreve em nada.
 */
export function planejarDestinos(registros: RegistroDeDestino[]): RegistroDeDestino[] {
  const porToken = new Map<string, RegistroDeDestino>();
  for (const r of registros) {
    if (!r.token) continue;
    const atual = porToken.get(r.token);
    if (!atual || r.updatedAt > atual.updatedAt) porToken.set(r.token, r);
  }
  return [...porToken.values()];
}

export type DiagnosticoDeRegistros = {
  total: number;
  /** Registros no formato atual: (e-mail, instalação). */
  comInstalacao: number;
  /** Registros do formato antigo — indexados pelo token, sem instalação. */
  legados: number;
  /** Registros de e-mails que têm legado E registro novo: candidatos a sobra, NUNCA provados. */
  legadosDeEmailComRegistroNovo: number;
  /** Docs que repetem um token já visto: duplicata PROVADA, seguros de apagar. */
  duplicadosPorToken: string[];
  /** Registros sem e-mail — órfãos, não recebem nada (fail-closed). */
  semEmail: number;
};

/**
 * Simulação da limpeza: conta o que há e diz o que é seguro apagar. Não apaga
 * nada e não decide por e-mail — só o token repetido é prova.
 */
export function diagnosticarRegistros(registros: RegistroDeDestino[]): DiagnosticoDeRegistros {
  const legados = registros.filter((r) => !r.deviceId);
  const emailsComNovo = new Set(registros.filter((r) => r.deviceId).map((r) => r.email.toLowerCase()));

  const vistos = new Map<string, RegistroDeDestino>();
  const duplicados: string[] = [];
  const ordenados = [...registros].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const r of ordenados) {
    if (!r.token) continue;
    if (vistos.has(r.token)) duplicados.push(r.docId);
    else vistos.set(r.token, r);
  }

  return {
    total: registros.length,
    comInstalacao: registros.length - legados.length,
    legados: legados.length,
    legadosDeEmailComRegistroNovo: legados.filter((r) => emailsComNovo.has(r.email.toLowerCase())).length,
    duplicadosPorToken: duplicados,
    semEmail: registros.filter((r) => !r.email).length,
  };
}
