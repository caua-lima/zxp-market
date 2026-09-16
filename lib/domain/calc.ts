import type { ComputedAd, Cost, DaySummary, Listing } from "./types";
import { contribuicaoNoPeriodo } from "./vigencia-custo";

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function todayStr(): string {
  return localDateStr(new Date());
}
export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateStr(d);
}
export function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

function isoUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** O período informado é um mês civil completo (dia 1 ao último dia)? */
export function isFullMonth(from: string, to: string): boolean {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  const last = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate();
  return a.getUTCDate() === 1 && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCFullYear() === b.getUTCFullYear() && b.getUTCDate() === last;
}

/**
 * Período imediatamente anterior, do mesmo tamanho. Mês cheio → mês
 * anterior; senão desloca a janela pra trás pelo mesmo número de dias.
 * Mês em andamento compara dia a dia com o mesmo dia do mês anterior (não
 * com o mês anterior inteiro, que infla artificialmente a queda).
 */
export function prevPeriod(from: string, to: string): { from: string; to: string } {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  if (isFullMonth(from, to)) {
    const pm = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1));
    const y = pm.getUTCFullYear();
    const m = pm.getUTCMonth() + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");

    if (to > todayStr()) {
      const diaAtual = Number(todayStr().slice(8, 10));
      const diaClamp = Math.min(diaAtual, last);
      return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(diaClamp).padStart(2, "0")}` };
    }

    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  const prevTo = new Date(a.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: isoUTC(prevFrom), to: isoUTC(prevTo) };
}
export function mesAtual(): string {
  return todayStr().slice(0, 7);
}
export function diaAtualNoMes(): number {
  return new Date().getDate();
}
export function diasNoMes(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
export function formatMesBR(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}
export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-");
  return new Date(+y, +m - 1, +d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
export function fmtBRL(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
export function colorClass(v: number): "positive" | "negative" | "neutral" {
  return v > 0 ? "positive" : v < 0 ? "negative" : "neutral";
}
export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function emptyListing(): Listing {
  return { name: "", preco: "", retorno: "", custo: "", vendas: "", ads: "" };
}

export function parseBRNumber(raw: string | undefined | null): number {
  if (raw === undefined || raw === null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = s.replace(",", ".");
  } else {
    normalized = s;
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function computeAd(a: Listing): ComputedAd {
  const preco = parseBRNumber(a.preco);
  const retorno = parseBRNumber(a.retorno);
  const custo = parseBRNumber(a.custo);
  const vendas = parseInt(a.vendas, 10) || 0;
  const adsp = parseBRNumber(a.ads);
  const faturamento = preco * vendas;
  const cmv = custo * vendas;
  const bruto = retorno * vendas - cmv;
  const liquido = bruto - adsp;
  const margem = faturamento > 0 ? (liquido / faturamento) * 100 : 0;
  const roas = adsp > 0 ? faturamento / adsp : null;
  return {
    name: a.name?.trim() || "Sem nome",
    faturamento,
    cmv,
    bruto,
    liquido,
    margem,
    ads: adsp,
    roas,
  };
}

export function computeSummary(adsRaw: Listing[]): DaySummary {
  let tF = 0,
    tCMV = 0,
    tB = 0,
    tL = 0,
    tA = 0;
  const ads = adsRaw.map((a) => {
    const r = computeAd(a);
    tF += r.faturamento;
    tCMV += r.cmv;
    tB += r.bruto;
    tL += r.liquido;
    tA += r.ads;
    return r;
  });
  return {
    ads,
    totalFaturamento: tF,
    totalCMV: tCMV,
    totalBruto: tB,
    totalLiquido: tL,
    totalAds: tA,
    totalRoas: tA > 0 ? tF / tA : null,
    totalMargem: tF > 0 ? (tL / tF) * 100 : 0,
  };
}

export function normalizeCostDate(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function totalCustosDia(custos: Cost[], dateISO = todayStr()): number {
  return custos.reduce((s, item) => {
    const v = parseBRNumber(item.valor);
    if (item.freq === "diario") return s + v;
    if (item.freq === "avulso" && normalizeCostDate(item.data) === dateISO) return s + v;
    return s;
  }, 0);
}

/**
 * Projeção linear de fechamento do mês: assume que o ritmo médio até hoje se
 * mantém pelos dias restantes. `diaAtual` <= 0 (mês ainda não começou) não
 * dá pra projetar, retorna 0 em vez de dividir por zero.
 */
export function projetarMes(valorAcumulado: number, diaAtual: number, totalDiasMes: number): number {
  if (diaAtual <= 0) return 0;
  return (valorAcumulado / diaAtual) * totalDiasMes;
}

export type CenariosProjecao = { conservador: number; esperado: number; agressivo: number };

/**
 * Três cenários de fechamento do mês a partir da MESMA projeção linear
 * (`projetarMes`) — não há dado diário disponível aqui pra estimar uma
 * tendência real, então "conservador"/"agressivo" são o ritmo atual ±
 * `variacaoPct` (padrão 15%), não uma previsão estatística. Serve pra dar
 * uma noção de sensibilidade ("e se o ritmo cair/subir"), não uma garantia.
 */
export function scenariosDeProjecao(
  valorAcumulado: number,
  diaAtual: number,
  totalDiasMes: number,
  variacaoPct = 0.15,
): CenariosProjecao {
  const esperado = projetarMes(valorAcumulado, diaAtual, totalDiasMes);
  return {
    conservador: esperado * (1 - variacaoPct),
    esperado,
    agressivo: esperado * (1 + variacaoPct),
  };
}

/**
 * @param hojeISO usado só pelo legado de `ativo: false` sem `vigenteAte`.
 *   Ausente, assume o primeiro dia do mês consultado — assim a função continua
 *   pura pra quem já a chamava com dois argumentos.
 *
 * A vigência entrou aqui porque esta conta e a da rota de métricas precisam
 * concordar: era esta que alimentava os totais da aba de Custos e a prévia do
 * formulário, e ela somava TODA despesa recorrente em TODO mês, tivesse ela
 * existido naquele mês ou não. Consultar um mês antigo trazia despesas
 * criadas depois dele.
 */
export function totalCustosMes(custos: Cost[], mes: string, hojeISO?: string): number {
  const de = `${mes}-01`;
  const ate = `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
  const hoje = hojeISO ?? de;

  return custos.reduce((s, item) => {
    return s + contribuicaoNoPeriodo(
      {
        valor: parseBRNumber(item.valor),
        freq: item.freq,
        data: normalizeCostDate(item.data) ?? item.data,
        vigenteDe: item.vigenteDe,
        vigenteAte: item.vigenteAte,
        ativo: item.ativo,
      },
      { de, ate },
      hoje,
    );
  }, 0);
}

// ── Badge de margem — usado em Pedidos, Ads e onde mais precisar de um
// selo consistente de "saudável / atenção / prejuízo" ──────────────────
export type MarginStatus = "saudavel" | "atencao" | "prejuizo";

/** saudável = bateu a meta; atenção = positiva mas abaixo da meta; prejuízo = negativa. */
export function getMarginStatus(margem: number, metaMargem = 10): MarginStatus {
  if (margem < 0) return "prejuizo";
  if (margem >= metaMargem) return "saudavel";
  return "atencao";
}

export function getMarginStatusLabel(status: MarginStatus): string {
  return status === "saudavel" ? "Margem saudável" : status === "atencao" ? "Margem em atenção" : "Prejuízo";
}
