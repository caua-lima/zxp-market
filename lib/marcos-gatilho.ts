import "server-only";
import { verificarMarcos, type ResultadoMarcos } from "@/lib/marcos-run";

/**
 * Busca os números do mês e dispara a checagem de marcos.
 *
 * ─── POR QUE ISTO É COMPARTILHADO ───────────────────────────────────────
 *
 * A checagem rodava só no cron diário, e isso tinha um custo que não estava
 * escrito em lugar nenhum: passar de R$ 10 mil às 14h de terça só era
 * comemorado às 6h de quarta. Uma comemoração que chega no dia seguinte não é
 * comemoração, é relatório.
 *
 * Agora o sync também dispara — e o sync roda a cada 15 minutos enquanto o
 * painel está aberto. O mesmo código nos dois lugares, porque duas cópias
 * divergiriam na primeira correção.
 *
 * ─── POR QUE PASSA PELO ENDPOINT DE MÉTRICAS ────────────────────────────
 *
 * É de lá que sai o faturamento que o Dashboard mostra. Somar por conta
 * própria aqui criaria uma segunda definição, e o marco comemoraria um número
 * que não bate com a tela.
 */

export type Metricas = {
  faturamentoLiquido?: number;
  hoje?: { faturamentoLiquido?: number };
  serieDiaria?: { data: string; faturamento: number }[];
};

/** Hoje no fuso BR, yyyy-mm-dd. */
export function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * @param origem  base da URL da própria aplicação.
 * @param auth    header Authorization a repassar — o endpoint de métricas
 *   exige acesso, e sem repassar ele responde 401. Foi essa falta que segurou
 *   os marcos por semanas.
 */
export async function dispararMarcos(
  origem: string,
  auth: string | null,
): Promise<ResultadoMarcos | null> {
  const hoje = hojeBR();
  const mes = hoje.slice(0, 7);

  let m: Metricas | null = null;
  try {
    const r = await fetch(`${origem}/api/ml/metrics?month=${mes}&dia=${hoje}`, {
      headers: auth ? { Authorization: auth } : {},
      cache: "no-store",
    });
    if (r.ok) m = (await r.json()) as Metricas;
    else console.error("[marcos] metricas indisponiveis:", r.status);
  } catch (err) {
    console.error("[marcos] metricas falharam", err);
  }

  try {
    /**
     * Mesmo sem métricas a checagem segue: a subida de nível no MercadoLíder
     * não depende de faturamento nenhum, e amarrar as duas foi o bug que
     * segurou o aviso do selo.
     */
    return await verificarMarcos({
      faturamentoMes: m ? Number(m.faturamentoLiquido ?? 0) : null,
      mes,
      faturamentoHoje: m?.hoje ? Number(m.hoje.faturamentoLiquido ?? 0) : null,
      hoje,
      serieDiaria: m?.serieDiaria ?? [],
    });
  } catch (err) {
    console.error("[marcos] falharam", err);
    return null;
  }
}
