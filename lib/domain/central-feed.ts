import type { NotificationEvent } from "@/lib/domain/notifications";

/**
 * A lógica da Central de Notificações que precisa estar CERTA: de onde vem cada
 * data, o que conta como "não lida", e — principalmente — quando é honesto dizer
 * "Tudo em dia".
 *
 * ─── A MENTIRA QUE ISTO IMPEDE ──────────────────────────────────────────
 *
 * A Central escrevia "Tudo em dia" sempre que o número de não lidas era zero. Mas
 * zero podia significar qualquer uma destas coisas:
 *
 *  - ainda estava carregando (a tela começava vazia);
 *  - a leitura FALHOU (permissão, rede) e a lista ficou vazia;
 *  - o aparelho estava offline, mostrando o último estado guardado;
 *  - havia mais de 50 avisos, e só os 50 mais recentes tinham sido lidos — as
 *    não lidas mais antigas nem eram contadas.
 *
 * Nenhuma delas é "tudo em dia". O cabeçalho agora só afirma isso quando TODAS as
 * condições que o tornam verdadeiro valem.
 */

export type OrigemDoItem = "time" | "pessoal";

export type ItemDaCentral = NotificationEvent & {
  origem: OrigemDoItem;
  /** Quando o aviso nasceu (ms), ou `null` se a data é ilegível — nunca "agora" por engano. */
  criadoEmMs: number | null;
};

/**
 * Lê a data de criação de qualquer forma que ela possa chegar: `Timestamp` do
 * cliente (com `toMillis`), `{seconds}`/`{_seconds}`, milissegundos ou segundos
 * numéricos, ou ISO. Ilegível vira `null` — a versão anterior devolvia
 * `Date.now()`, então um aviso de três meses atrás com data corrompida aparecia
 * como "agora", no topo da lista.
 */
export function lerCriadoEm(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as { toMillis?: unknown; seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; _nanoseconds?: unknown };
    if (typeof o.toMillis === "function") {
      const ms = (o.toMillis as () => number)();
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
    const s = typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : null;
    if (s != null && Number.isFinite(s) && s > 0) {
      const ns = typeof o.nanoseconds === "number" ? o.nanoseconds : typeof o._nanoseconds === "number" ? o._nanoseconds : 0;
      return s * 1000 + Math.floor(ns / 1e6);
    }
    return null;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    // Segundos (Unix) cabem em 1e11 até o ano 5138; milissegundos, não.
    return v < 1e11 ? v * 1000 : v;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) && t > 0 ? t : null;
  }
  return null;
}

/** Um item do feed PESSOAL, no formato dos demais: o lido dele vira `readBy[email]`. */
export function normalizarItemPessoal(raw: Record<string, unknown>, email: string): NotificationEvent {
  const lidoEm = typeof raw.lidoEm === "number" ? raw.lidoEm : null;
  const dispensadoEm = typeof raw.dispensadoEm === "number" ? raw.dispensadoEm : null;
  const item = { ...raw } as Record<string, unknown>;
  delete item.lidoEm;
  delete item.dispensadoEm;
  return {
    ...(item as unknown as NotificationEvent),
    readBy: lidoEm != null ? { [email]: lidoEm } : {},
    dismissedBy: dispensadoEm != null ? { [email]: dispensadoEm } : {},
  };
}

export function estaLido(item: Pick<NotificationEvent, "readBy">, email: string): boolean {
  return !!email && !!item.readBy && email in item.readBy;
}

/**
 * Junta as fontes num só feed: sem repetir id da MESMA origem, do mais recente pro
 * mais antigo. Item sem data legível vai pro FIM — e não pro topo, que é onde o
 * "agora" inventado o colocava.
 */
export function mesclarFeeds(listas: { origem: OrigemDoItem; itens: NotificationEvent[] }[]): ItemDaCentral[] {
  const vistos = new Set<string>();
  const saida: ItemDaCentral[] = [];
  for (const { origem, itens } of listas) {
    for (const it of itens) {
      const chave = `${origem}:${it.id}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push({ ...it, origem, criadoEmMs: lerCriadoEm(it.createdAt) });
    }
  }
  return saida.sort((a, b) => {
    if (a.criadoEmMs == null && b.criadoEmMs == null) return 0;
    if (a.criadoEmMs == null) return 1;
    if (b.criadoEmMs == null) return -1;
    return b.criadoEmMs - a.criadoEmMs;
  });
}

export type EstadoDaFonte = {
  carregando: boolean;
  /** Mensagem curta, sem detalhe técnico. `null` = sem erro. */
  erro: string | null;
  /** O último snapshot veio do cache local, não do servidor. */
  doCache: boolean;
  /** Há avisos mais antigos que os carregados. */
  temMais: boolean;
};

export type SituacaoDaCentral = "carregando" | "erro" | "parcial" | "desatualizada" | "vazia" | "ok";

/**
 * A situação da Central como um todo.
 *
 *  - erro: nenhuma fonte carregou e alguma falhou — a lista vazia NÃO quer dizer nada;
 *  - parcial: uma fonte falhou, outra funciona — mostra o que tem e avisa que falta parte;
 *  - desatualizada: o que se vê veio do cache (sem conexão, ou ainda sincronizando);
 *  - vazia: carregou de verdade, sem erro, e não há nada;
 *  - ok: há itens, tudo carregado.
 */
export function situacaoDaCentral(fontes: EstadoDaFonte[], totalDeItens: number): SituacaoDaCentral {
  const comErro = fontes.filter((f) => f.erro != null);
  const semDados = fontes.every((f) => f.carregando);
  if (semDados && totalDeItens === 0) return "carregando";
  if (comErro.length > 0 && comErro.length === fontes.length) return "erro";
  if (comErro.length > 0) return "parcial";
  if (fontes.some((f) => f.carregando) && totalDeItens === 0) return "carregando";
  if (fontes.some((f) => f.doCache)) return "desatualizada";
  return totalDeItens === 0 ? "vazia" : "ok";
}

export type ContadorDeNaoLidas = {
  n: number;
  /** O número é o TOTAL? Falso quando há avisos mais antigos ainda não carregados. */
  exato: boolean;
};

export function contarNaoLidas(itens: ItemDaCentral[], email: string, fontes: EstadoDaFonte[]): ContadorDeNaoLidas {
  return {
    n: itens.filter((i) => !estaLido(i, email)).length,
    exato: !fontes.some((f) => f.temMais),
  };
}

/**
 * O texto do cabeçalho. "Tudo em dia" exige TUDO: carregou, sem erro, do servidor,
 * sem histórico por carregar e zero não lidas. Em qualquer outro caso diz a
 * verdade do que se sabe.
 */
export function textoDoCabecalho(situacao: SituacaoDaCentral, c: ContadorDeNaoLidas, offline: boolean): string {
  switch (situacao) {
    case "carregando": return "Carregando…";
    case "erro": return "Não consegui carregar as notificações";
    case "parcial": return c.n > 0 ? `${c.n}${c.exato ? "" : "+"} não lida(s) — parte dos avisos não carregou` : "Parte dos avisos não carregou";
    case "desatualizada":
      return offline
        ? "Sem conexão — mostrando o que estava salvo"
        : (c.n > 0 ? `${c.n}${c.exato ? "" : "+"} não lida(s) — sincronizando…` : "Sincronizando…");
    case "vazia": return "Nenhuma notificação ainda";
    case "ok":
      if (c.n > 0) return `${c.n}${c.exato ? "" : "+"} não lida(s)`;
      // Zero nas carregadas, mas há mais antigas por carregar: não dá pra afirmar.
      return c.exato ? "Tudo em dia" : "Nenhuma não lida entre as mais recentes";
  }
}

/** "agora", "5 min atrás", "3h atrás", "12/08" — ou "data indisponível", nunca "agora" por engano. */
export function textoDeHora(ms: number | null, agora: number): string {
  if (ms == null) return "data indisponível";
  const diffMin = Math.floor((agora - ms) / 60000);
  // Data no futuro além de 2 min: relógio torto de um lado; não finge "agora".
  if (diffMin < -2) return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin} min atrás`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h atrás`;
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Quantos itens carregar por página, e o teto do que se mantém em memória. */
export const TAMANHO_DA_PAGINA = 50;
