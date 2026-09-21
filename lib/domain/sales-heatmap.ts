/**
 * Concentração de vendas por dia da semana e horário — mesma ideia do painel
 * "Concentração de vendas por dia e horário" do próprio Mercado Livre
 * (Métricas > Negócio), só que calculada em cima dos pedidos já
 * sincronizados, sem bater em API nenhuma.
 *
 * Dia e hora saem SEMPRE convertidos pro fuso de Brasília (lib/domain/tempo.ts),
 * nunca fatiados da string: o Mercado Livre devolve `date_created` no offset
 * dele, e fatiar deslocava a venda em uma hora. O dia (YYYY-MM-DD) vira Date
 * com componentes locais (new Date(y, m-1, d)) só pra achar o dia da semana —
 * mesmo truque já usado em MelhoresDias (components/dashboard/Dashboard.tsx).
 */

import { paraBR } from "./tempo";

export type OrderParaHeatmap = {
  date_created?: string;
};

export type ResultadoHeatmap = {
  /** grid[diaSemana 0-6][hora 0-23] = nº de vendas. 0=domingo, como Date.getDay(). */
  grid: number[][];
  totalVendas: number;
  diaMaisForte: number | null;
  horaMaisForte: number | null;
};

/**
 * Dia e hora SEMPRE convertidos pro fuso de Brasília (ver lib/domain/tempo.ts).
 *
 * A primeira versão disto só tratava timestamp marcado como UTC (sufixo Z) e
 * fatiava o resto da string. Só que o Mercado Livre devolve `date_created` com
 * o offset dele — na prática `-04:00` — e fatiar dava uma hora a menos: a
 * venda das 13:01 caía na faixa das 12h. Perto da meia-noite isso também
 * jogava a venda pro DIA DA SEMANA errado, que é o pior erro possível num
 * mapa de concentração por dia/horário.
 */
export function calcularConcentracaoVendas(orders: OrderParaHeatmap[]): ResultadoHeatmap {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let totalVendas = 0;

  for (const o of orders) {
    const conv = paraBR(o.date_created);
    if (!conv) continue;
    const [y, m, d] = conv.dia.split("-").map(Number);
    const hora = conv.horaNum;
    if (!y || !m || !d) continue;
    const diaSemana = new Date(y, m - 1, d).getDay();
    grid[diaSemana][hora]++;
    totalVendas++;
  }

  const totaisPorDia = grid.map((linha) => linha.reduce((s, n) => s + n, 0));
  const totaisPorHora = new Array(24).fill(0);
  for (const linha of grid) for (let h = 0; h < 24; h++) totaisPorHora[h] += linha[h];

  const diaMaisForte = totalVendas > 0 ? totaisPorDia.indexOf(Math.max(...totaisPorDia)) : null;
  const horaMaisForte = totalVendas > 0 ? totaisPorHora.indexOf(Math.max(...totaisPorHora)) : null;

  return { grid, totalVendas, diaMaisForte, horaMaisForte };
}

export type CelulaDoRanking = { diaDaSemana: number; hora: number; vendas: number };

/**
 * As N células (dia da semana × hora) com mais vendas, da maior pra menor.
 *
 * É a leitura que o mapa de bolinhas não dá a quem não enxerga cor nem tamanho, e
 * que ninguém consegue tirar de 168 células passando o mouse. Empate desempata por
 * dia da semana e depois por hora, pra a ordem não mudar sozinha entre duas
 * pinturas. Célula com zero venda nunca entra: "o horário mais forte" que tem zero
 * vendas não é forte.
 */
export function topCelulas(grid: readonly (readonly number[])[], n = 5): CelulaDoRanking[] {
  const todas: CelulaDoRanking[] = [];
  grid.forEach((linha, diaDaSemana) => linha.forEach((vendas, hora) => {
    if (vendas > 0) todas.push({ diaDaSemana, hora, vendas });
  }));
  return todas
    .sort((a, b) => b.vendas - a.vendas || a.diaDaSemana - b.diaDaSemana || a.hora - b.hora)
    .slice(0, n);
}
