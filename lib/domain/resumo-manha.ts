/**
 * O aviso das 7h — a média do mês, com o mês ainda dando pra mudar.
 *
 * ─── QUAL JANELA, E POR QUÊ ─────────────────────────────────────────────
 *
 * Só DIAS FECHADOS: do dia 1º até ontem, inclusive. O dia de ontem fecha à
 * meia-noite, e às 7h de hoje ele já é definitivo.
 *
 * A alternativa seria incluir o dia corrente, e ela estraga justamente o que
 * o aviso existe pra dar. Às 7h da manhã o dia de hoje tem quase nada, e essa
 * quase-nada entraria na média dividida por mais um dia — a média cairia todo
 * dia de manhã e subiria à tarde, sem nada ter acontecido. Média só faz
 * sentido sobre períodos comparáveis, e o único período comparável é o dia
 * inteiro.
 *
 * A janela usada vai escrita na própria mensagem ("média de 1 a 9 de
 * setembro"). Se algum dia a leitura divergir do esperado, o texto mostra
 * qual foi, em vez de o número discordar em silêncio.
 *
 * Puro: monta título e corpo. Buscar e enviar fica fora.
 */

import { mesPorExtenso, seloMercadoLider } from "./marcos";

export type DiaFaturado = { dia: string; valor: number };

export type ResumoManha = {
  /** yyyy-mm-dd do primeiro e do último dia contados. */
  de: string;
  ate: string;
  diasContados: number;
  total: number;
  media: number;
  /** Projeção do mês pelo ritmo atual — média × dias do mês. */
  projecao: number;
  /** Quanto o melhor dia da janela fez, pra dar escala à média. */
  melhorDia: DiaFaturado | null;
  titulo: string;
  corpo: string;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const brl0 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Quantos dias tem o mês de "2026-09". */
export function diasNoMes(mes: string): number {
  const m = String(mes).match(/^(\d{4})-(\d{2})$/);
  if (!m) return 30;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

/** O dia anterior a `hojeISO`, em yyyy-mm-dd. */
export function ontemDe(hojeISO: string): string {
  const m = String(hojeISO).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * @param serie  faturamento por dia do mês corrente, como o Dashboard o tem.
 *   Dias sem venda podem vir ausentes — ver o tratamento abaixo.
 * @param hojeISO  hoje, no fuso BR. Entra como parâmetro pra função continuar
 *   pura: sem isso o teste dependeria do relógio.
 * @param nivelML  nível de MercadoLíder, pro selo que fecha a mensagem.
 */
export function montarResumoManha(
  serie: DiaFaturado[],
  hojeISO: string,
  nivelML?: string | null,
): ResumoManha | null {
  const hoje = String(hojeISO).slice(0, 10);
  const mes = hoje.slice(0, 7);
  const ontem = ontemDe(hoje);

  /**
   * Dia 1º não tem aviso: não há dia fechado no mês ainda, e a média de zero
   * dias não existe. O aviso volta no dia 2.
   */
  if (!ontem || ontem.slice(0, 7) !== mes) return null;

  const primeiro = `${mes}-01`;
  const daJanela = (serie ?? []).filter((d) => d?.dia >= primeiro && d.dia <= ontem);

  /**
   * O denominador é o CALENDÁRIO, não a quantidade de dias com venda.
   *
   * Um dia sem nenhuma venda costuma vir ausente da série. Dividir só pelos
   * dias presentes trataria um domingo zerado como se não tivesse existido, e
   * a média sairia inflada exatamente nos meses com dias fracos — que são os
   * meses em que a média mais importa.
   */
  const diasContados = Number(ontem.slice(8, 10));
  const total = daJanela.reduce((s, d) => s + (Number(d.valor) || 0), 0);
  const media = diasContados > 0 ? total / diasContados : 0;
  const doMes = diasNoMes(mes);
  const projecao = media * doMes;

  const melhorDia = daJanela.reduce<DiaFaturado | null>(
    (a, d) => (!a || d.valor > a.valor ? { dia: d.dia, valor: Number(d.valor) || 0 } : a),
    null,
  );

  const nomeMes = mesPorExtenso(mes);
  const dia = (s: string) => Number(s.slice(8, 10));

  const corpo =
    `Média de ${brl(media)} por dia em ${nomeMes}, considerando `
    + `${diasContados === 1 ? "o dia 1º" : `os dias 1 a ${dia(ontem)}`} `
    + `(${brl(total)} no total).\n\n`
    + `Nesse ritmo, ${nomeMes} fecha em ${brl0(projecao)}.`
    + (melhorDia ? `\nMelhor dia até aqui: ${brl(melhorDia.valor)}, no dia ${dia(melhorDia.dia)}.` : "")
    + `\n\n${seloMercadoLider(nivelML)}`;

  return {
    de: primeiro,
    ate: ontem,
    diasContados,
    total,
    media,
    projecao,
    melhorDia,
    titulo: `${nomeMes}: ${brl(media)} por dia`,
    corpo,
  };
}

/** A chave de dedupe do aviso — um por dia, sem repetir se o cron rodar duas vezes. */
export function chaveDoResumo(hojeISO: string): string {
  return `resumo_manha:${String(hojeISO).slice(0, 10)}`;
}
