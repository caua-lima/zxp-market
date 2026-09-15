"use client";

/**
 * Cache compartilhado de leitura do Firestore.
 *
 * POR QUE ISTO EXISTE
 * O app estourava a cota diária de leitura do Firestore (50k no plano Spark)
 * com um banco de poucos megabytes — ~2 mil pedidos no total. O problema
 * nunca foi volume de dado: era o modelo de cobrança. O Firestore cobra por
 * DOCUMENTO LIDO, e `onSnapshot` relê a consulta inteira a cada mudança,
 * multiplicado por cada aba e cada aparelho aberto.
 *
 * O pior caso era abrir o app: AvisoRemessasFull e Dashboard montam
 * watchMovimentos (até 1500 docs) e watchTasks (500) já na aba inicial —
 * ~2 mil leituras antes de o usuário clicar em qualquer coisa. Abrir e
 * fechar o app 25 vezes no dia zerava a cota sozinho.
 *
 * COMO RESOLVE
 * Uma busca ÚNICA por chave, guardada em memória e compartilhada por todos os
 * componentes que pedirem o mesmo dado. Remontar (trocar de aba e voltar,
 * abrir um modal) passa a custar ZERO leitura enquanto o cache estiver
 * quente. Toda escrita invalida a chave correspondente, então o dado nunca
 * fica velho depois de uma ação do próprio usuário.
 *
 * O QUE **NÃO** DEVE USAR ISTO
 * Notificação (o sino) precisa ser tempo real de verdade — é o ponto dela.
 * Continua em onSnapshot.
 *
 * ─── SYNC-02: A INVALIDAÇÃO QUE SE PERDIA ───────────────────────────────
 *
 * `rebuscar` começava assim:
 *
 *   if (e.buscando) return e.buscando;
 *
 * Boa intenção — não disparar duas leituras da mesma coleção. Mas quando uma
 * busca estava EM VOO e uma escrita acontecia, `invalidar` chamava `rebuscar`,
 * que devolvia a promessa da busca já em andamento. Essa busca leu o Firestore
 * ANTES da escrita, e ao terminar gravava `e.at = Date.now()` — marcando como
 * fresco um dado que já nascia velho.
 *
 * Na prática: lançar uma movimentação enquanto a lista carrega fazia o
 * lançamento não aparecer. E não aparecia "até o TTL vencer" — que é o próximo
 * problema.
 *
 * A saída é uma GERAÇÃO por chave. `invalidar` incrementa; a busca guarda a
 * geração de quando começou e, ao voltar, só publica se ela não mudou. Se
 * mudou, o resultado é descartado e uma busca nova sai.
 *
 * ─── SYNC-01: O TTL QUE NUNCA DISPARAVA ─────────────────────────────────
 *
 * A validade era conferida em UM lugar só:
 *
 *   const quente = e.dados !== undefined && Date.now() - e.at < ttl;
 *
 * E isso roda na INSCRIÇÃO. Depois de inscrito, o componente segurava o dado
 * indefinidamente: uma aba aberta a tarde inteira mostrava o estado da manhã,
 * e o TTL só tinha efeito na PRÓXIMA montagem.
 *
 * O comentário antigo dizia que mudança de outra pessoa "aparece quando o TTL
 * vence". Não aparecia: para quem já estava assinando, ele nunca vencia.
 *
 * Agora há revalidação por evento — a janela voltando ao foco e a conexão
 * voltando — e um intervalo que só corre enquanto a aba está VISÍVEL. Aba em
 * segundo plano não gasta leitura, que é o ponto de tudo isto.
 */

const TTL_PADRAO = 5 * 60 * 1000;

type Entrada<T> = {
  at: number;
  dados: T | undefined;
  inscritos: Set<(d: T) => void>;
  buscando: Promise<void> | null;
  /**
   * Sobe a cada invalidação. Uma busca que volta com geração antiga teve o
   * resultado invalidado enquanto estava em voo, e não pode publicar.
   */
  geracao: number;
  /** Anexado na primeira inscrição — é como `invalidar` consegue rebuscar. */
  rebuscar: (() => Promise<void>) | null;
};

const cache = new Map<string, Entrada<unknown>>();

function pegar<T>(chave: string): Entrada<T> {
  let e = cache.get(chave) as Entrada<T> | undefined;
  if (!e) {
    e = { at: 0, dados: undefined, inscritos: new Set(), buscando: null, geracao: 0, rebuscar: null };
    cache.set(chave, e as Entrada<unknown>);
  }
  return e;
}

/**
 * Invalida uma chave e REBUSCA se alguém ainda estiver ouvindo — é o que faz a
 * tela atualizar sozinha logo depois de uma escrita, sem esperar o TTL.
 *
 * O `geracao += 1` é o que impede a invalidação de se perder: se havia uma
 * busca em voo, ela volta com a geração antiga e é descartada.
 */
export function invalidar(chave: string): void {
  const e = cache.get(chave);
  if (!e) return;
  e.at = 0;
  e.geracao += 1;
  if (e.inscritos.size > 0 && e.rebuscar) void e.rebuscar();
}

/** Revalida toda chave que tenha ouvinte. Usado no foco e na volta da conexão. */
export function revalidarTudo(): void {
  for (const e of cache.values()) {
    if (e.inscritos.size > 0 && e.rebuscar) void e.rebuscar();
  }
}

/**
 * Revalida o que estiver VELHO, sem forçar o que acabou de ser lido.
 *
 * É o que o intervalo usa: varrer tudo a cada tique gastaria leitura à toa
 * numa chave buscada há dez segundos.
 */
export function revalidarVencidos(ttl = TTL_PADRAO): void {
  const agora = Date.now();
  for (const e of cache.values()) {
    if (e.inscritos.size === 0 || !e.rebuscar) continue;
    if (agora - e.at >= ttl) void e.rebuscar();
  }
}

/**
 * Liga a revalidação por evento.
 *
 * Idempotente: chamar duas vezes não duplica ouvinte. Só faz sentido no
 * navegador — no servidor não há foco nem aba.
 */
let revalidacaoLigada = false;
export function ligarRevalidacaoAutomatica(intervaloMs = TTL_PADRAO): () => void {
  if (revalidacaoLigada || typeof document === "undefined") return () => {};
  revalidacaoLigada = true;

  const aoVoltar = () => {
    // Só quando a aba fica visível: o evento dispara nos dois sentidos.
    if (document.visibilityState === "visible") revalidarVencidos(intervaloMs);
  };
  const aoConectar = () => revalidarTudo();

  document.addEventListener("visibilitychange", aoVoltar);
  window.addEventListener("online", aoConectar);

  /**
   * O intervalo só age com a aba visível. Sem essa condição, cada aba aberta
   * em segundo plano continuaria relendo coleções inteiras — o custo que este
   * arquivo inteiro existe pra evitar.
   */
  const id = setInterval(() => {
    if (document.visibilityState === "visible") revalidarVencidos(intervaloMs);
  }, intervaloMs);

  return () => {
    document.removeEventListener("visibilitychange", aoVoltar);
    window.removeEventListener("online", aoConectar);
    clearInterval(id);
    revalidacaoLigada = false;
  };
}

/**
 * Assina uma consulta com cache. Devolve a função de cancelar, igual ao
 * onSnapshot que substitui — quem chama não muda de forma.
 */
export function assinarComCache<T>(
  chave: string,
  buscar: () => Promise<T>,
  cb: (d: T) => void,
  opts: { ttl?: number; onError?: (msg: string) => void } = {},
): () => void {
  const ttl = opts.ttl ?? TTL_PADRAO;
  const e = pegar<T>(chave);
  e.inscritos.add(cb);

  const rebuscar = async (): Promise<void> => {
    // Uma busca por vez por chave: dois componentes montando junto (Dashboard
    // + aba) não podem virar duas leituras da mesma coleção.
    if (e.buscando) return e.buscando;

    // A geração de QUANDO esta busca começou. Se `invalidar` correr enquanto
    // ela estiver em voo, este número fica para trás e o resultado é jogado
    // fora em vez de sobrescrever a escrita nova.
    const geracaoNaPartida = e.geracao;

    e.buscando = (async () => {
      try {
        const dados = await buscar();
        if (e.geracao !== geracaoNaPartida) {
          // Invalidado em voo: este resultado é anterior à escrita. Descarta.
          return;
        }
        e.dados = dados;
        e.at = Date.now();
        e.inscritos.forEach((f) => f(dados));
      } catch (err) {
        opts.onError?.(err instanceof Error ? err.message : String(err));
      } finally {
        e.buscando = null;
      }
    })();

    await e.buscando;

    // Se foi invalidado durante a busca, sai outra agora — senão a escrita
    // ficaria esperando o TTL, e para quem já está inscrito o TTL não corre.
    if (e.geracao !== geracaoNaPartida) await rebuscar();
  };
  e.rebuscar = rebuscar;

  const quente = e.dados !== undefined && Date.now() - e.at < ttl;
  if (quente) {
    // Entrega o que já está em memória sem custo nenhum de leitura.
    cb(e.dados as T);
  } else {
    void rebuscar();
  }

  return () => {
    e.inscritos.delete(cb);
  };
}

/** Limpa tudo — usado no logout, pra não vazar dado de uma conta pra outra. */
export function limparCache(): void {
  cache.clear();
}
