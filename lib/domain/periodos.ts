/**
 * Períodos: "hoje", "mês passado" e o que cada rótulo realmente cobre.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * 1. Os atalhos do seletor de datas eram calculados UMA vez, na montagem
 *    (`useMemo(..., [])`). Uma aba deixada aberta na virada do dia continuava
 *    com o "Hoje" de ontem e o "Mês passado" do mês retrasado.
 *
 * 2. "Hoje" vinha do relógio do NAVEGADOR, enquanto o resto do app conta o dia
 *    em Brasília. Quem abre o app com o relógio em outro fuso (ou viaja) via um
 *    dia diferente do que o servidor usava.
 *
 * 3. "Mês passado", na aba de Desempenho, não era o mês passado: a rota só
 *    aceita "N dias pra trás a partir de hoje", então o botão pedia dias
 *    suficientes pra alcançar o 1º do mês passado — e trazia também o mês em
 *    curso. O tooltip avisava; o RÓTULO dizia o contrário.
 *
 * Tudo aqui trabalha em "YYYY-MM-DD" e em UTC puro, sem `new Date()` local: o
 * resultado não depende do fuso de quem calcula, nem do horário de verão.
 */

export const FUSO_DA_OPERACAO = "America/Sao_Paulo";

const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_DA_OPERACAO, year: "numeric", month: "2-digit", day: "2-digit",
});
const formatoHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO_DA_OPERACAO, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** O dia de hoje NA OPERAÇÃO (Brasília), não no relógio do navegador. */
export function hojeNaOperacao(agora: number | Date = Date.now()): string {
  return formatoDia.format(agora);
}

/**
 * Quantos milissegundos faltam pra virar o dia em Brasília. É o que agenda o
 * recálculo dos atalhos: sem isso, a aba aberta na virada ficava com o dia velho.
 */
export function msAteAVirada(agora: number | Date = Date.now()): number {
  const [h, m, s] = formatoHora.format(agora).split(":").map(Number);
  const passados = ((h % 24) * 3600 + m * 60 + s) * 1000;
  // +1s de folga: dispara já no dia novo, nunca um instante antes da virada.
  return 24 * 3600 * 1000 - passados + 1000;
}

function partes(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
function montar(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function somarDias(iso: string, n: number): string {
  const { y, m, d } = partes(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return montar(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Primeiro e último dia do mês que contém `iso`. */
export function limitesDoMes(iso: string): { de: string; ate: string } {
  const { y, m } = partes(iso);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { de: montar(y, m, 1), ate: montar(y, m, ultimo) };
}

/** O mês anterior ao de `iso`, inteiro. */
export function mesAnterior(iso: string): { de: string; ate: string } {
  const { y, m } = partes(iso);
  return limitesDoMes(montar(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1));
}

export type PresetDePeriodo = { chave: string; rotulo: string; de: string; ate: string };

/** Os atalhos do seletor de datas, calculados a partir de UM "hoje" explícito. */
export function presetsDePeriodo(hoje: string): PresetDePeriodo[] {
  const mes = limitesDoMes(hoje);
  const passado = mesAnterior(hoje);
  return [
    { chave: "mes", rotulo: "Mês atual", de: mes.de, ate: mes.ate },
    { chave: "mespas", rotulo: "Mês passado", de: passado.de, ate: passado.ate },
    { chave: "7d", rotulo: "Últimos 7 dias", de: somarDias(hoje, -6), ate: hoje },
    { chave: "30d", rotulo: "Últimos 30 dias", de: somarDias(hoje, -29), ate: hoje },
    { chave: "hoje", rotulo: "Hoje", de: hoje, ate: hoje },
    { chave: "ontem", rotulo: "Ontem", de: somarDias(hoje, -1), ate: somarDias(hoje, -1) },
  ];
}

/** "20/09/2026". */
export function dataBR(iso: string): string {
  const { y, m, d } = partes(iso);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "20 de setembro de 2026" — o que um leitor de tela precisa ouvir, não só "20". */
export function dataPorExtenso(iso: string): string {
  const { y, m, d } = partes(iso);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

// ─── janelas "N dias pra trás a partir de hoje" (a rota de Desempenho) ──────

/** Quantos dias (contando hoje) vão do dia 1º do mês até hoje. */
export function diasDesdeInicioDoMes(hoje: string): number {
  return partes(hoje).d;
}

/**
 * Quantos dias pra trás é preciso pedir pra alcançar o 1º do mês PASSADO.
 *
 * A janela sempre termina hoje, então o resultado traz o mês passado E o mês em
 * curso até hoje — não é o mês passado sozinho. Por isso o rótulo tem que dizer
 * "desde": ver `rotuloDesdeMesPassado`.
 */
export function diasCobrindoMesPassado(hoje: string): number {
  return diasDesdeInicioDoMes(hoje) + partes(mesAnterior(hoje).ate).d;
}

/** O rótulo verdadeiro do botão: o que ele cobre, com a data de início. */
export function rotuloDesdeMesPassado(hoje: string): { curto: string; longo: string } {
  const inicio = mesAnterior(hoje).de;
  const { d, m } = partes(inicio);
  const curto = `Desde 1º/${MESES[m - 1].slice(0, 3)}`;
  return {
    curto,
    longo: `De ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} até hoje (${dataBR(hoje)}): o mês passado inteiro e o mês atual até agora. A rota só aceita "últimos N dias", então não dá pra pedir o mês passado sozinho.`,
  };
}
