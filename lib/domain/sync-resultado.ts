/**
 * O resultado de uma sincronização — incluindo quando ela não terminou.
 *
 * ─── DUAS FORMAS DE MENTIR COM ZERO ─────────────────────────────────────
 *
 * 1. `fetchAllOrders` paginava acumulando resultados e, na primeira página que
 *    falhasse, fazia `throw`. As páginas JÁ BUSCADAS iam junto: 700 pedidos
 *    lidos com sucesso viravam nada porque a página 15 deu erro. O erro subia
 *    até a rota, que respondia 500, e `savedOrders` nunca chegava a ser
 *    reportado.
 *
 *    E não havia cursor. A rodada seguinte começava do offset 0, batia na
 *    mesma falha e descartava tudo de novo — o rabo do período nunca era
 *    sincronizado, indefinidamente.
 *
 * 2. `syncClaimsRange` fazia `if (!res.ok) return 0;`. Falta de permissão
 *    devolvia ZERO DEVOLUÇÕES SINCRONIZADAS, que é exatamente o que o app
 *    devolve quando não houve devolução nenhuma. A rota reportava
 *    `savedClaims: 0` e `ok: true`, e ninguém tinha como saber a diferença.
 *
 * Nos dois casos o problema é o mesmo: uma falha vira um número que se lê como
 * sucesso. "Sincronizei e não havia nada" e "não consegui sincronizar" levam a
 * decisões opostas — a primeira diz que o painel está correto, a segunda diz
 * que ele está incompleto.
 */

export type EtapaSync = "pedidos" | "devolucoes" | "reclamacoes";

export type ResultadoEtapa = {
  etapa: EtapaSync;
  /** Quantos registros foram efetivamente gravados. */
  gravados: number;
  /** A etapa percorreu TUDO que deveria? */
  completo: boolean;
  /**
   * Onde parou, quando não completou. Guardar o cursor é o que permite a
   * próxima rodada continuar em vez de recomeçar e falhar no mesmo ponto.
   */
  cursor?: number | null;
  /** Resumo curto do erro. Nunca token, nunca corpo de resposta. */
  erro?: string | null;
};

export function etapaOk(etapa: EtapaSync, gravados: number): ResultadoEtapa {
  return { etapa, gravados, completo: true, cursor: null, erro: null };
}

/**
 * Etapa que trouxe ALGUMA COISA mas não terminou.
 *
 * O que já veio é gravado — descartar seria repetir o bug. O que marca a
 * diferença é `completo: false`.
 */
export function etapaParcial(
  etapa: EtapaSync,
  gravados: number,
  cursor: number | null,
  erro: unknown,
): ResultadoEtapa {
  return { etapa, gravados, completo: false, cursor, erro: resumirErro(erro) };
}

export function etapaFalhou(etapa: EtapaSync, erro: unknown): ResultadoEtapa {
  return { etapa, gravados: 0, completo: false, cursor: 0, erro: resumirErro(erro) };
}

/**
 * Erro em texto curto, seguro de gravar.
 *
 * Corpo de resposta do Mercado Livre pode conter identificadores e, em rota de
 * autenticação, token. O resumo fica limitado e sem corpo — o suficiente pra
 * diagnosticar, insuficiente pra vazar.
 */
export function resumirErro(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e ?? "erro");
  return bruto.replace(/\s+/g, " ").trim().slice(0, 200) || "erro";
}

export type ResumoSync = {
  etapas: ResultadoEtapa[];
  /** Todas as etapas terminaram? */
  completo: boolean;
  /** Total gravado, somando as etapas. */
  gravados: number;
  /** Quais etapas não terminaram — pra quem lê saber o que está faltando. */
  incompletas: EtapaSync[];
};

export function resumir(etapas: ResultadoEtapa[]): ResumoSync {
  const incompletas = etapas.filter((e) => !e.completo).map((e) => e.etapa);
  return {
    etapas,
    completo: incompletas.length === 0,
    gravados: etapas.reduce((s, e) => s + (Number(e.gravados) || 0), 0),
    incompletas,
  };
}

/**
 * O estado a persistir entre rodadas.
 *
 * `ultimoSucesso` é separado de `ultimaTentativa` de propósito: sem essa
 * separação, uma sequência de falhas fica indistinguível de "ninguém rodou", e
 * a antiguidade real do dado some.
 */
export type EstadoSync = {
  ultimaTentativa: number;
  /** Momento da última rodada COMPLETA. Preservado através das falhas. */
  ultimoSucesso: number | null;
  /** Rodadas seguidas sem completar. Zera ao completar. */
  tentativasSeguidas: number;
  /** Onde continuar, por etapa. */
  cursores: Partial<Record<EtapaSync, number>>;
  /** Erro da última rodada que não completou. */
  ultimoErro: string | null;
};

export const ESTADO_INICIAL: EstadoSync = {
  ultimaTentativa: 0,
  ultimoSucesso: null,
  tentativasSeguidas: 0,
  cursores: {},
  ultimoErro: null,
};

export function proximoEstado(
  anterior: EstadoSync | null | undefined,
  resumo: ResumoSync,
  agora: number,
): EstadoSync {
  const base = anterior ?? ESTADO_INICIAL;

  if (resumo.completo) {
    // Completou: os cursores não servem mais, e a contagem de tentativas zera.
    return {
      ultimaTentativa: agora,
      ultimoSucesso: agora,
      tentativasSeguidas: 0,
      cursores: {},
      ultimoErro: null,
    };
  }

  const cursores: Partial<Record<EtapaSync, number>> = { ...base.cursores };
  for (const e of resumo.etapas) {
    // Etapa que completou não deixa cursor pendente pra trás.
    if (e.completo) delete cursores[e.etapa];
    else if (typeof e.cursor === "number") cursores[e.etapa] = e.cursor;
  }

  return {
    ultimaTentativa: agora,
    // PRESERVA o último sucesso: é ele que diz quão velho o dado está.
    ultimoSucesso: base.ultimoSucesso,
    tentativasSeguidas: (Number(base.tentativasSeguidas) || 0) + 1,
    cursores,
    ultimoErro: resumo.etapas.find((e) => e.erro)?.erro ?? "incompleto",
  };
}
