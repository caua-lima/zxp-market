/**
 * A fila de toasts — o que aparece, por quanto tempo e o que acontece quando
 * chega mais do que cabe.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * O provedor guardava a fila numa ref e a MUTAVA de dentro dos atualizadores de
 * estado (`filaRef.current.push`). O React pode executar um atualizador mais de
 * uma vez (Strict Mode faz isso de propósito): cada execução extra empilhava o
 * mesmo aviso de novo, ou tirava um da fila sem mostrar. Além disso:
 *
 *  - a fila e o conjunto de "já vistos" cresciam sem teto — uma rajada de 100
 *    vendas com a aba parada guardava 100 toasts pra mostrar depois, em fila,
 *    uma hora mais tarde;
 *  - o efeito recriava o temporizador de TODOS os toasts a cada mudança da lista:
 *    quando chegava um novo, os que já estavam na tela ganhavam a duração
 *    inteira de novo, e um toast podia ficar minutos na tela;
 *  - nada pausava com o mouse ou o foco em cima, então o botão "Ver pedido"
 *    sumia enquanto se estendia a mão pra ele;
 *  - não havia prioridade: o alerta de prejuízo esperava atrás de três "venda
 *    confirmada".
 *
 * ─── COMO É AGORA ───────────────────────────────────────────────────────
 *
 * Tudo aqui é PURO: cada função recebe o estado e o instante (`agora`) e devolve
 * o estado novo — sem ref, sem relógio interno. Executar duas vezes dá o mesmo
 * resultado, que é o que o Strict Mode exige.
 *
 * Cada toast tem o PRÓPRIO prazo absoluto (`expiraEm`); um único temporizador
 * aponta pro prazo mais próximo (proximoPrazo). Quando o mouse ou o foco está em
 * cima, o prazo congela (`restanteMs`) e volta a correr ao sair.
 *
 * O toast é um aviso de PRESENÇA, não o registro: o que a fila descarta continua
 * na Central de Notificações.
 */

export type ToastItem<T> = {
  /** Identidade estável do aviso (eventId). */
  id: string;
  /** Mesma tag = mesma notificação: uma nova SUBSTITUI a anterior (como o aparelho faz). */
  tag: string;
  dados: T;
  /** Maior = mais urgente. */
  prioridade: number;
  duracaoMs: number;
  chegouEm: number;
  /** Prazo absoluto de fechamento; `null` enquanto pausado ou ainda na fila. */
  expiraEm: number | null;
  /** Quanto falta, guardado enquanto pausado. */
  restanteMs: number | null;
};

export type EstadoDeToasts<T> = {
  visiveis: ToastItem<T>[];
  fila: ToastItem<T>[];
  /** id → até quando lembrar que já foi visto (dedupe com retenção LIMITADA). */
  vistos: Record<string, number>;
};

export type ConfigDeToasts = {
  /** Quantos ao mesmo tempo. No celular é 1 — um toast principal, e o resto vira um contador. */
  maxVisiveis: number;
  /** Quantos esperam. O que passa disso é descartado (menos urgente primeiro) — segue na Central. */
  maxFila: number;
  /** Quanto tempo um aviso espera na fila antes de deixar de valer a pena mostrar. */
  ttlNaFilaMs: number;
  /** Por quanto tempo lembra que já mostrou um id. */
  retencaoDeVistosMs: number;
  /** Teto duro de ids lembrados. */
  maxVistos: number;
};

export const CONFIG_PADRAO: ConfigDeToasts = {
  maxVisiveis: 3,
  maxFila: 12,
  ttlNaFilaMs: 30_000,
  retencaoDeVistosMs: 10 * 60_000,
  maxVistos: 200,
};

export function estadoInicial<T>(): EstadoDeToasts<T> {
  return { visiveis: [], fila: [], vistos: {} };
}

/** Mais urgente primeiro; entre iguais, quem chegou antes. */
function porUrgencia<T>(a: ToastItem<T>, b: ToastItem<T>): number {
  return b.prioridade - a.prioridade || a.chegouEm - b.chegouEm;
}

function podarVistos(vistos: Record<string, number>, agora: number, cfg: ConfigDeToasts): Record<string, number> {
  const validos = Object.entries(vistos).filter(([, ate]) => ate > agora);
  // Teto duro: se ainda passar, esquece os que expiram primeiro.
  validos.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(validos.slice(0, cfg.maxVistos));
}

/** Promove da fila pra tela enquanto houver espaço. O prazo do toast só começa a correr AQUI, quando ele fica visível. */
function promover<T>(e: EstadoDeToasts<T>, agora: number, cfg: ConfigDeToasts): EstadoDeToasts<T> {
  const visiveis = [...e.visiveis];
  const fila = [...e.fila].sort(porUrgencia);
  while (visiveis.length < cfg.maxVisiveis && fila.length > 0) {
    const proximo = fila.shift()!;
    visiveis.push({ ...proximo, expiraEm: agora + proximo.duracaoMs, restanteMs: null });
  }
  return { ...e, visiveis, fila };
}

export type NovoToast<T> = { id: string; tag: string; dados: T; prioridade: number; duracaoMs: number };

/** Um aviso chegou. */
export function chegou<T>(e: EstadoDeToasts<T>, n: NovoToast<T>, agora: number, cfg: ConfigDeToasts = CONFIG_PADRAO): EstadoDeToasts<T> {
  // Mesma TAG de um que já está aí (visível ou esperando): substitui o conteúdo no mesmo lugar,
  // sem empilhar — é o que o aparelho faz com `tag`, e o resumo de rajada depende disso.
  if (n.tag) {
    const noLugar = (t: ToastItem<T>): ToastItem<T> =>
      t.tag === n.tag
        ? { ...t, id: n.id, dados: n.dados, prioridade: Math.max(t.prioridade, n.prioridade), duracaoMs: n.duracaoMs,
            // Reinicia o prazo: o conteúdo é novo. Pausado continua pausado (com a duração cheia).
            expiraEm: t.expiraEm == null ? null : agora + n.duracaoMs,
            restanteMs: t.restanteMs == null ? null : n.duracaoMs }
        : t;
    const jaHavia = [...e.visiveis, ...e.fila].some((t) => t.tag === n.tag);
    if (jaHavia) {
      return {
        visiveis: e.visiveis.map(noLugar),
        fila: e.fila.map(noLugar),
        vistos: podarVistos({ ...e.vistos, [n.id]: agora + cfg.retencaoDeVistosMs }, agora, cfg),
      };
    }
  }

  // Já mostrado há pouco (o SDK reentrega, a aba reconecta): ignora.
  if ((e.vistos[n.id] ?? 0) > agora) return e;

  const vistos = podarVistos({ ...e.vistos, [n.id]: agora + cfg.retencaoDeVistosMs }, agora, cfg);
  const item: ToastItem<T> = { ...n, chegouEm: agora, expiraEm: null, restanteMs: null };

  let proximo: EstadoDeToasts<T> = { ...e, vistos, fila: [...e.fila, item] };
  proximo = promover(proximo, agora, cfg);

  // Fila com teto: descarta o MENOS urgente (e, entre iguais, o mais novo). Segue na Central.
  if (proximo.fila.length > cfg.maxFila) {
    const ordenada = [...proximo.fila].sort(porUrgencia);
    proximo = { ...proximo, fila: ordenada.slice(0, cfg.maxFila) };
  }
  return proximo;
}

/** Fechado à mão (ou por navegar). Libera a vaga e promove o próximo. */
export function dispensar<T>(e: EstadoDeToasts<T>, id: string, agora: number, cfg: ConfigDeToasts = CONFIG_PADRAO): EstadoDeToasts<T> {
  return promover({
    ...e,
    visiveis: e.visiveis.filter((t) => t.id !== id),
    fila: e.fila.filter((t) => t.id !== id),
  }, agora, cfg);
}

/** Mouse ou foco em cima: congela o prazo DESTE toast. Só ele. */
export function pausar<T>(e: EstadoDeToasts<T>, id: string, agora: number): EstadoDeToasts<T> {
  return {
    ...e,
    visiveis: e.visiveis.map((t) =>
      t.id === id && t.expiraEm != null ? { ...t, restanteMs: Math.max(0, t.expiraEm - agora), expiraEm: null } : t),
  };
}

/** Saiu o mouse/foco: o prazo volta a correr de onde parou. */
export function retomar<T>(e: EstadoDeToasts<T>, id: string, agora: number): EstadoDeToasts<T> {
  return {
    ...e,
    visiveis: e.visiveis.map((t) =>
      t.id === id && t.expiraEm == null && t.restanteMs != null ? { ...t, expiraEm: agora + t.restanteMs, restanteMs: null } : t),
  };
}

/**
 * O relógio andou: fecha o que venceu, descarta o que esperou demais na fila e
 * promove. É a ÚNICA função que o temporizador precisa chamar.
 */
export function passar<T>(e: EstadoDeToasts<T>, agora: number, cfg: ConfigDeToasts = CONFIG_PADRAO): EstadoDeToasts<T> {
  return promover({
    visiveis: e.visiveis.filter((t) => t.expiraEm == null || t.expiraEm > agora),
    fila: e.fila.filter((t) => agora - t.chegouEm <= cfg.ttlNaFilaMs),
    vistos: podarVistos(e.vistos, agora, cfg),
  }, agora, cfg);
}

/** O limite mudou (girou o celular, redimensionou): o que passa do novo teto volta pra fila. */
export function ajustarLimite<T>(e: EstadoDeToasts<T>, agora: number, cfg: ConfigDeToasts): EstadoDeToasts<T> {
  if (e.visiveis.length <= cfg.maxVisiveis) return promover(e, agora, cfg);
  const mantidos = e.visiveis.slice(0, cfg.maxVisiveis);
  const devolvidos = e.visiveis.slice(cfg.maxVisiveis).map((t) => ({ ...t, expiraEm: null, restanteMs: null }));
  return { ...e, visiveis: mantidos, fila: [...devolvidos, ...e.fila] };
}

/** Troca de conta: nada do que era da pessoa anterior pode aparecer pra próxima. */
export function limpar<T>(): EstadoDeToasts<T> {
  return estadoInicial<T>();
}

/**
 * Quando o temporizador precisa acordar: o menor prazo entre os toasts em curso e
 * os vencimentos da fila. `null` = nada agendado (tudo pausado ou vazio).
 */
export function proximoPrazo<T>(e: EstadoDeToasts<T>, cfg: ConfigDeToasts = CONFIG_PADRAO): number | null {
  const prazos = [
    ...e.visiveis.map((t) => t.expiraEm),
    ...e.fila.map((t) => t.chegouEm + cfg.ttlNaFilaMs + 1),
  ].filter((p): p is number => p != null);
  return prazos.length > 0 ? Math.min(...prazos) : null;
}

/** Prioridade por tipo: prejuízo e cancelamento furam a fila; venda comum espera. */
export function prioridadeDoTipo(type: string): number {
  switch (type) {
    case "sale_negative_margin": case "sale_cancelled": case "return_completed": case "return_opened":
      return 3;
    case "sale_low_margin": case "sync_warning": case "stock_low": case "task_due":
      return 2;
    case "task_assigned": case "sale_high_value": case "milestone":
      return 1;
    default:
      return 0;
  }
}
