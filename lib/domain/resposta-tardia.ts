/**
 * Descartar a resposta que chegou tarde.
 *
 * ─── O QUE ACONTECIA ────────────────────────────────────────────────────
 *
 * `fetchMetrics` no Dashboard fazia:
 *
 *   const json = await res.json();
 *   if (mountedRef.current) { setMlMetrics(json); ... }
 *
 * A única guarda era "o componente ainda está montado". Isso não diz nada
 * sobre se a resposta ainda é a que se quer.
 *
 * Trocar o filtro de "Mês" pra "Hoje" dispara duas buscas. A do mês é mais
 * pesada — mais dias, mais pedidos — e costuma demorar mais. Quando ela chega
 * DEPOIS, sobrescreve os dados de hoje: a tela passa a mostrar o faturamento
 * do mês inteiro enquanto o seletor diz "Hoje".
 *
 * Não é um piscar: o estado fica errado até a próxima busca. E o erro é
 * sempre pra MAIS, porque o período maior é o que demora.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────
 *
 * Cada busca recebe um número crescente. Ao voltar, só aplica se ainda for a
 * mais recente. A última seleção vence — sempre, independente da ordem em que
 * as respostas chegam.
 */

export type Sequenciador = {
  /** Reserva o número desta busca. Chame ANTES de disparar. */
  proximo: () => number;
  /** Esta resposta ainda é a que interessa? */
  ehAtual: (n: number) => boolean;
  /** Cancela tudo que estiver em voo — usado ao desmontar. */
  descartarTudo: () => void;
};

export function criarSequenciador(): Sequenciador {
  let atual = 0;
  let descartado = false;
  return {
    proximo: () => {
      descartado = false;
      atual += 1;
      return atual;
    },
    ehAtual: (n: number) => !descartado && n === atual,
    descartarTudo: () => { descartado = true; },
  };
}

/**
 * O estado de carregamento que a tela precisa mostrar — separando TENTATIVA
 * de SUCESSO.
 *
 * Havia só `lastUpdated`, gravado no sucesso. Uma atualização que falhava
 * deixava o carimbo antigo intacto e não dizia nada: a tela continuava
 * anunciando "atualizado há 2 minutos" enquanto as três últimas tentativas
 * tinham falhado. Quem lê precisa saber a diferença entre "está fresco" e
 * "está velho e eu não consegui buscar".
 */
export type EstadoDaBusca = {
  /** Momento do último sucesso. `null` = nunca deu certo. */
  ultimoSucesso: number | null;
  /** Momento da última tentativa, tenha dado certo ou não. */
  ultimaTentativa: number | null;
  /** A última tentativa falhou? */
  falhouNaUltima: boolean;
};

export const BUSCA_INICIAL: EstadoDaBusca = {
  ultimoSucesso: null,
  ultimaTentativa: null,
  falhouNaUltima: false,
};

export function registrarSucesso(agora: number): EstadoDaBusca {
  return { ultimoSucesso: agora, ultimaTentativa: agora, falhouNaUltima: false };
}

export function registrarFalha(anterior: EstadoDaBusca, agora: number): EstadoDaBusca {
  // O último sucesso é PRESERVADO: o dado na tela continua sendo daquele
  // momento, e apagar o carimbo esconderia justamente quão velho ele está.
  return { ultimoSucesso: anterior.ultimoSucesso, ultimaTentativa: agora, falhouNaUltima: true };
}

/**
 * A resposta chegou com HTTP 200 — mas é sucesso?
 *
 * Várias rotas deste app respondem 200 com `{ error: "sem_token" }` ou
 * `{ error: "pedidos_indisponiveis" }`, de propósito, pra não fazer o ML nem o
 * navegador tratarem como falha de transporte. Quem só olha `res.ok` grava
 * esse corpo como se fossem métricas.
 */
export function corpoEhSucesso(corpo: unknown): boolean {
  if (corpo == null || typeof corpo !== "object") return false;
  const c = corpo as Record<string, unknown>;
  if (typeof c.error === "string" && c.error) return false;
  return true;
}
