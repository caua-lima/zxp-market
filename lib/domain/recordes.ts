/**
 * Recordes da empresa — as conquistas que só acontecem uma vez.
 *
 * ─── POR QUE ISTO É DIFERENTE DE UM MARCO DE DEGRAU ─────────────────────
 *
 * "Passou de R$ 30 mil no mês" acontece todo mês em que se passa de 30 mil.
 * "Passou de R$ 30 mil num mês PELA PRIMEIRA VEZ" acontece uma vez na vida da
 * empresa — e é essa a notícia que se conta pra alguém.
 *
 * A diferença exige memória: para saber que é a primeira vez, é preciso saber
 * o que já aconteceu. Este módulo é a parte pura dessa decisão — recebe o que
 * está registrado e o que acabou de acontecer, e devolve o registro novo mais
 * os marcos que nasceram daí. Quem persiste é o chamador.
 *
 * ─── POR QUE O REGISTRO GUARDA A DATA, E NÃO SÓ O VALOR ─────────────────
 *
 * "Melhor dia: R$ 3.480" é um número solto. "Melhor dia: R$ 3.480, em 07/08"
 * é uma memória — e quando o recorde cai, dá pra dizer o que foi superado, que
 * é a metade boa da notícia.
 */

import { diaBR, mesPorExtenso, seloMercadoLider, type Marco } from "./marcos";

export type MarcaDeDia = { dia: string; valor: number };
export type MarcaDeMes = { mes: string; valor: number };
export type MarcaDeContagem = { dia: string; quantidade: number };

export type Recordes = {
  /** Maior faturamento num único dia, em toda a história. */
  melhorDia: MarcaDeDia | null;
  /** Maior faturamento num mês fechado (ou no mês corrente, se já superar). */
  melhorMes: MarcaDeMes | null;
  /** Mais pedidos num único dia. */
  maisPedidosNumDia: MarcaDeContagem | null;
  /**
   * Degraus de faturamento MENSAL já alcançados alguma vez, e em que mês foi
   * a primeira. A chave é o degrau em reais, como string.
   */
  primeiraVezMensal: Record<string, string>;
};

export const RECORDES_VAZIOS: Recordes = {
  melhorDia: null,
  melhorMes: null,
  maisPedidosNumDia: null,
  primeiraVezMensal: {},
};

/**
 * Degraus que valem "primeira vez na história".
 *
 * Mais espaçados que os do mês corrente de propósito: um recorde histórico é
 * uma notícia grande, e tê-la de 5 em 5 mil a esvaziaria. Estes são os números
 * redondos que alguém diria em voz alta.
 */
export const DEGRAUS_HISTORICOS: number[] = [
  10_000, 20_000, 30_000, 40_000, 50_000, 75_000,
  100_000, 150_000, 200_000, 300_000, 500_000, 1_000_000,
];

export type FatoDoPeriodo = {
  /** Faturamento por dia FECHADO. Dia em andamento não entra — ver abaixo. */
  dias: { dia: string; valor: number; pedidos?: number }[];
  /** Mês corrente e o quanto ele soma até agora. */
  mes: string;
  faturamentoMes: number;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/**
 * Compara o que aconteceu com o que está registrado.
 *
 * ─── O DIA EM ANDAMENTO NÃO ENTRA ───────────────────────────────────────
 *
 * Quem chama passa só dias FECHADOS. Um dia pela metade sempre perde pro
 * recorde e, se ganhasse, o recorde seria batido de novo à tarde pelo mesmo
 * dia — e o "maior dia da história" mudaria três vezes num dia só. Recorde de
 * dia se apura quando o dia acaba.
 *
 * @param nivelML nível de MercadoLíder, pro selo que fecha a mensagem.
 */
export function avaliarRecordes(
  atuais: Recordes,
  fato: FatoDoPeriodo,
  nivelML?: string | null,
): { novos: Recordes; marcos: Marco[] } {
  const novos: Recordes = {
    melhorDia: atuais.melhorDia ? { ...atuais.melhorDia } : null,
    melhorMes: atuais.melhorMes ? { ...atuais.melhorMes } : null,
    maisPedidosNumDia: atuais.maisPedidosNumDia ? { ...atuais.maisPedidosNumDia } : null,
    primeiraVezMensal: { ...(atuais.primeiraVezMensal ?? {}) },
  };
  const marcos: Marco[] = [];

  // ── Melhor dia ──
  for (const d of fato.dias ?? []) {
    if (!d?.dia || !(d.valor > 0)) continue;
    if (!novos.melhorDia || d.valor > novos.melhorDia.valor) {
      const anterior = novos.melhorDia;
      novos.melhorDia = { dia: d.dia, valor: d.valor };
      /**
       * Sem recorde anterior não há o que comemorar: é a primeira medição, e
       * "melhor dia da história" no primeiro dia medido é uma frase vazia.
       */
      if (anterior) {
        marcos.push({
          // A chave leva o DIA: o recorde é daquele dia, e só se anuncia uma vez.
          chave: `recorde_dia:${d.dia}`,
          titulo: "Melhor dia da história!",
          corpo: `${diaBR(d.dia)} fechou em ${brl2(d.valor)} — o maior faturamento `
            + `num único dia desde que a operação começou. `
            + `O recorde anterior era ${brl2(anterior.valor)}, de ${diaBR(anterior.dia)}.`
            + `\n\n${seloMercadoLider(nivelML)}`,
        });
      }
    }

    // ── Mais pedidos num dia ──
    if (typeof d.pedidos === "number" && d.pedidos > 0) {
      if (!novos.maisPedidosNumDia || d.pedidos > novos.maisPedidosNumDia.quantidade) {
        const anterior = novos.maisPedidosNumDia;
        novos.maisPedidosNumDia = { dia: d.dia, quantidade: d.pedidos };
        if (anterior) {
          marcos.push({
            chave: `recorde_pedidos:${d.dia}`,
            titulo: "Mais pedidos num dia!",
            corpo: `${diaBR(d.dia)} teve ${d.pedidos} pedidos — mais que qualquer outro dia. `
              + `O recorde anterior era ${anterior.quantidade}, de ${diaBR(anterior.dia)}.`
              + `\n\n${seloMercadoLider(nivelML)}`,
          });
        }
      }
    }
  }

  // ── Melhor mês ──
  if (fato.mes && fato.faturamentoMes > 0) {
    const superaOutroMes = !novos.melhorMes
      || fato.faturamentoMes > novos.melhorMes.valor
      // O próprio mês corrente atualizando o próprio recorde: não é conquista
      // nova, é o mesmo mês crescendo.
      || novos.melhorMes.mes === fato.mes;

    if (superaOutroMes) {
      const anterior = novos.melhorMes;
      const ehOutroMes = !anterior || anterior.mes !== fato.mes;
      const superou = !anterior || fato.faturamentoMes > anterior.valor;
      if (superou) {
        novos.melhorMes = { mes: fato.mes, valor: fato.faturamentoMes };
        if (anterior && ehOutroMes) {
          marcos.push({
            // Chave pelo MÊS: anuncia uma vez que este mês virou o melhor, e
            // não a cada real a mais que ele soma depois.
            chave: `recorde_mes:${fato.mes}`,
            titulo: "Melhor mês da história!",
            corpo: `${mesPorExtenso(fato.mes)} passou ${mesPorExtenso(anterior.mes)} `
              + `e virou o melhor mês da operação. `
              + `O recorde anterior era ${brl2(anterior.valor)}.`
              + `\n\n${seloMercadoLider(nivelML)}`,
          });
        }
      }
    }

    // ── Primeira vez em cada degrau histórico ──
    for (const degrau of DEGRAUS_HISTORICOS) {
      if (fato.faturamentoMes < degrau) continue;
      const chave = String(degrau);
      if (novos.primeiraVezMensal[chave]) continue;
      novos.primeiraVezMensal[chave] = fato.mes;
      marcos.push({
        chave: `primeira_vez:${degrau}`,
        titulo: `Primeira vez em ${brl(degrau)}!`,
        corpo: `${mesPorExtenso(fato.mes)} é o primeiro mês da história da empresa a passar `
          + `de ${brl(degrau)} de faturamento. Está em ${brl2(fato.faturamentoMes)}.`
          + `\n\n${seloMercadoLider(nivelML)}`,
      });
    }
  }

  return { novos, marcos };
}

/**
 * Semeia os recordes a partir do histórico, SEM gerar marco nenhum.
 *
 * ─── POR QUE ISTO PRECISA EXISTIR ───────────────────────────────────────
 *
 * Na primeira execução não há registro, e sem ele todo dia acima de zero seria
 * "melhor dia da história". Semeando com o passado, o primeiro aviso de
 * verdade só sai quando algo realmente for superado.
 */
export function semear(fato: FatoDoPeriodo, mesesConhecidos: MarcaDeMes[] = []): Recordes {
  const r: Recordes = { ...RECORDES_VAZIOS, primeiraVezMensal: {} };

  for (const d of fato.dias ?? []) {
    if (!d?.dia || !(d.valor > 0)) continue;
    if (!r.melhorDia || d.valor > r.melhorDia.valor) r.melhorDia = { dia: d.dia, valor: d.valor };
    if (typeof d.pedidos === "number" && d.pedidos > 0
      && (!r.maisPedidosNumDia || d.pedidos > r.maisPedidosNumDia.quantidade)) {
      r.maisPedidosNumDia = { dia: d.dia, quantidade: d.pedidos };
    }
  }

  const meses = [...mesesConhecidos];
  if (fato.mes && fato.faturamentoMes > 0) meses.push({ mes: fato.mes, valor: fato.faturamentoMes });
  for (const m of meses) {
    if (!r.melhorMes || m.valor > r.melhorMes.valor) r.melhorMes = { ...m };
    for (const degrau of DEGRAUS_HISTORICOS) {
      if (m.valor < degrau) continue;
      const chave = String(degrau);
      // Guarda o mês MAIS ANTIGO que bateu o degrau — é ele a "primeira vez".
      if (!r.primeiraVezMensal[chave] || m.mes < r.primeiraVezMensal[chave]) {
        r.primeiraVezMensal[chave] = m.mes;
      }
    }
  }

  return r;
}
