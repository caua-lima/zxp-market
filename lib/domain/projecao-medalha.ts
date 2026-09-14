import type { DiaDeVendas } from "@/lib/domain/reputacao-vendas";
import { janelaDaMedalha, type MetaMedalha } from "@/lib/domain/mercadolider-metas";

/**
 * Quando a medalha chega — com a janela ANDANDO, que é como ela anda.
 *
 * ─── O ERRO ─────────────────────────────────────────────────────────────
 *
 * A projeção era linear:
 *
 *   vendasPorDia = acumuladoNaJanela / diasDaJanela
 *   diasNoRitmo  = ceil(falta / vendasPorDia)
 *   chegaEm      = hoje + diasNoRitmo
 *
 * Isso trata o acumulado como se só crescesse. Mas a janela da medalha é
 * "3 meses + os dias do mês vigente", e ela é MÓVEL: quando o mês vira, o mês
 * mais antigo sai dela inteiro.
 *
 * Medindo em 05/09 a janela é 01/06 a 05/09 — junho, julho, agosto e 5 dias
 * de setembro. Em 01/10 ela vira 01/07 a 01/10, e **junho inteiro desaparece
 * do acumulado**. A projeção somava o ritmo dia após dia e nunca subtraía
 * nada, então prometia uma data que a conta simplesmente não alcança: em
 * 01/10 o acumulado pode CAIR, não subir.
 *
 * Quanto mais longe a data projetada, pior — e a data longe é exatamente a de
 * quem está atrás da meta, que é quem mais precisa do número certo.
 *
 * ─── COMO FICA ──────────────────────────────────────────────────────────
 *
 * Simula dia a dia: a cada passo, soma o ritmo projetado e SUBTRAI o que
 * saiu da janela naquele dia, lido da série histórica real. A resposta só sai
 * quando a série cobre a janela inteira; sem cobertura, a função diz que não
 * dá — em vez de devolver uma data com falsa precisão.
 */

export type Ritmo = { vendasPorDia: number; faturamentoPorDia: number };

export type Projecao =
  | {
      /** Os dois eixos já fecharam. */
      tipo: "ja_fechou";
    }
  | {
      tipo: "chega";
      /** yyyy-mm-dd em que os dois eixos fecham ao mesmo tempo. */
      chegaEm: string;
      dias: number;
      /** Houve pelo menos uma virada de mês no caminho? */
      atravessaViradaDeMes: boolean;
      /** Quanto sai da janela até lá, pra a tela poder explicar a diferença. */
      vendasQueSaem: number;
      faturamentoQueSai: number;
    }
  | {
      tipo: "nao_chega";
      /**
       * No ritmo atual a janela móvel nunca fecha os dois eixos dentro do
       * horizonte: o que entra não compensa o que sai. É uma resposta de
       * verdade, não uma falha.
       */
      horizonteDias: number;
    }
  | {
      tipo: "sem_cobertura";
      /** Quantos dias da janela atual a série cobre, e quantos deveria. */
      diasCobertos: number;
      diasNecessarios: number;
    };

/** Horizonte da simulação. Além disso, "algum dia" não é uma informação útil. */
const HORIZONTE_DIAS = 400;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function paraData(diaISO: string): Date | null {
  const m = String(diaISO).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Quantos dias da janela atual a série efetivamente cobre.
 *
 * "Cobrir" aqui é ter alcance, não ter venda: um dia sem venda legitimamente
 * não aparece na série. O que importa é a série começar no início da janela
 * ou antes — se ela começa no meio, o que sai da janela é desconhecido e a
 * simulação seria chute.
 */
export function coberturaDaSerie(serie: DiaDeVendas[], hojeISO: string): {
  diasCobertos: number;
  diasNecessarios: number;
  suficiente: boolean;
} {
  const janela = janelaDaMedalha(hojeISO);
  const diasNecessarios = janela.dias;

  const dentro = (serie ?? []).filter((d) => d?.dia >= janela.de && d.dia <= janela.ate);
  if (dentro.length === 0) {
    return { diasCobertos: 0, diasNecessarios, suficiente: false };
  }

  const primeiro = dentro[0].dia;
  const inicio = paraData(janela.de);
  const primeiroData = paraData(primeiro);
  if (!inicio || !primeiroData) {
    return { diasCobertos: 0, diasNecessarios, suficiente: false };
  }

  const ate = paraData(janela.ate);
  if (!ate) return { diasCobertos: 0, diasNecessarios, suficiente: false };

  const diasCobertos = Math.round((ate.getTime() - primeiroData.getTime()) / 86400000) + 1;

  /**
   * Tolerância de uma semana: é normal a série começar alguns dias depois do
   * início da janela quando simplesmente não houve venda nesses dias. Um
   * buraco maior que isso já é falta de dado, não silêncio de vendas.
   */
  const suficiente = diasCobertos >= diasNecessarios - 7;
  return { diasCobertos, diasNecessarios, suficiente };
}

/**
 * Simula a janela móvel até os dois eixos fecharem.
 *
 * @param serie   vendas por dia, histórico real. Dias sem venda podem faltar.
 * @param hojeISO a data de referência, pra a função continuar pura.
 * @param ritmo   quanto se espera por dia daqui pra frente.
 */
export function projetarMedalha(
  serie: DiaDeVendas[],
  meta: MetaMedalha,
  hojeISO: string,
  ritmo: Ritmo,
  atual: { vendas: number; faturamento: number },
): Projecao {
  if (atual.vendas >= meta.vendas && atual.faturamento >= meta.faturamento) {
    return { tipo: "ja_fechou" };
  }

  const cobertura = coberturaDaSerie(serie, hojeISO);
  if (!cobertura.suficiente) {
    return {
      tipo: "sem_cobertura",
      diasCobertos: cobertura.diasCobertos,
      diasNecessarios: cobertura.diasNecessarios,
    };
  }

  const porDia = new Map(serie.map((d) => [d.dia, d]));
  const hoje = paraData(hojeISO);
  if (!hoje) {
    return { tipo: "sem_cobertura", diasCobertos: 0, diasNecessarios: cobertura.diasNecessarios };
  }

  let vendas = atual.vendas;
  let faturamento = atual.faturamento;
  let vendasQueSaem = 0;
  let faturamentoQueSai = 0;
  let atravessaViradaDeMes = false;

  const inicioHoje = janelaDaMedalha(hojeISO).de;
  let inicioAnterior = inicioHoje;

  for (let k = 1; k <= HORIZONTE_DIAS; k++) {
    const dia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + k);
    const diaISO = iso(dia);

    // 1. O que entra: o ritmo projetado pra este dia.
    vendas += ritmo.vendasPorDia;
    faturamento += ritmo.faturamentoPorDia;

    /**
     * 2. O que SAI: na virada do mês o início da janela pula um mês inteiro, e
     * todos os dias entre o início antigo e o novo deixam de contar. Era isso
     * que a projeção linear ignorava.
     */
    const inicioAgora = janelaDaMedalha(diaISO).de;
    if (inicioAgora !== inicioAnterior) {
      atravessaViradaDeMes = true;
      const de = paraData(inicioAnterior);
      const ate = paraData(inicioAgora);
      if (de && ate) {
        for (let d = new Date(de); d < ate; d.setDate(d.getDate() + 1)) {
          const saiu = porDia.get(iso(d));
          if (!saiu) continue;
          vendas -= saiu.concluidas;
          faturamento -= saiu.faturado;
          vendasQueSaem += saiu.concluidas;
          faturamentoQueSai += saiu.faturado;
        }
      }
      inicioAnterior = inicioAgora;
    }

    if (vendas >= meta.vendas && faturamento >= meta.faturamento) {
      return {
        tipo: "chega",
        chegaEm: diaISO,
        dias: k,
        atravessaViradaDeMes,
        vendasQueSaem: Math.round(vendasQueSaem),
        faturamentoQueSai: Math.round(faturamentoQueSai),
      };
    }
  }

  return { tipo: "nao_chega", horizonteDias: HORIZONTE_DIAS };
}
