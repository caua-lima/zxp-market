/**
 * Um limite de taxa por janela FIXA: no máximo `max` ações a cada `janelaMs`.
 *
 * Existe pra rotas autenticadas que disparam efeito em OUTRA pessoa (um push).
 * Estar autenticado não é o mesmo que ter direito a mandar cem avisos por
 * minuto: a autenticação diz QUEM está chamando, não QUANTAS vezes pode.
 *
 * Puro: o estado entra e sai como argumento, e quem o persiste (numa
 * transação, pra duas chamadas simultâneas não passarem juntas) está em
 * lib/notification-limites.ts.
 */

export type EstadoDoLimite = { inicio: number; contagem: number };

export type ResultadoDoLimite = {
  permitido: boolean;
  estado: EstadoDoLimite;
  /** Quanto falta pra janela reabrir, em segundos — vai no `Retry-After`. */
  esperarSegundos: number;
};

export function consumirLimite(
  atual: EstadoDoLimite | null,
  agora: number,
  cfg: { max: number; janelaMs: number },
): ResultadoDoLimite {
  const naJanela = atual && agora >= atual.inicio && agora - atual.inicio < cfg.janelaMs;
  const base: EstadoDoLimite = naJanela ? atual : { inicio: agora, contagem: 0 };

  if (base.contagem >= cfg.max) {
    return {
      permitido: false,
      estado: base,
      esperarSegundos: Math.max(1, Math.ceil((base.inicio + cfg.janelaMs - agora) / 1000)),
    };
  }
  return { permitido: true, estado: { inicio: base.inicio, contagem: base.contagem + 1 }, esperarSegundos: 0 };
}
