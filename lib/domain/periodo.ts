/**
 * Ler o período pedido — e recusar o que não faz sentido ANTES de consultar.
 *
 * ─── O QUE PASSAVA ──────────────────────────────────────────────────────
 *
 * `buildRange` montava o intervalo assim:
 *
 *   if (from && to) {
 *     return { start: `${from}T00:00:00.000Z`, ... };
 *   }
 *
 * Interpolação direta, sem conferir nada. Quatro coisas saíam disso:
 *
 * 1. `?from=abc` virava `"abcT00:00:00.000Z"` — uma data que não existe, e a
 *    consulta ao Firestore saía com lixo dentro.
 *
 * 2. Intervalo invertido (`from` depois de `to`) não era recusado. A consulta
 *    voltava vazia, e vazio aqui se lê como "não vendeu nada" — o pior tipo de
 *    resposta errada, porque parece uma resposta.
 *
 * 3. Não havia TETO. `?from=2000-01-01&to=2030-12-31` fazia a rota paginar
 *    trinta anos de pedidos no Mercado Livre, página após página, até a função
 *    morrer. Qualquer pessoa autorizada derrubava a rota digitando na URL.
 *
 * 4. `month.split("-").map(Number)` com `?month=abc` dava `[NaN, NaN]`, e daí
 *    saía `"NaN-NaN-01"` como data.
 *
 * Recusar cedo é mais barato que qualquer uma dessas: a validação custa
 * microssegundos e evita dezenas de chamadas pagas à API.
 */

export type PeriodoLido =
  | { ok: true; de: string; ate: string; dias: number }
  | { ok: false; erro: string; detalhe: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

/**
 * Teto do intervalo consultável.
 *
 * Quatrocentos dias cobre "um ano mais folga" — que é o maior recorte com uso
 * real — e impede o pedido de trinta anos. O limite existe pelo custo: cada dia
 * a mais é mais uma página de pedidos buscada no ML.
 */
export const MAX_DIAS = 400;

/** Quão longe no futuro uma data ainda é aceitável. Fuso e relógio do cliente derrapam um pouco. */
const FOLGA_FUTURO_DIAS = 2;

function dataValida(s: string): boolean {
  if (!DATA.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  // Rejeita 31/02 e afins: o mês tem que ter o dia.
  return d <= new Date(Date.UTC(a, m, 0)).getUTCDate();
}

function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T00:00:00Z`);
  const b = Date.parse(`${ate}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** O mês inteiro, como período. */
function doMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/**
 * Interpreta `from`/`to`/`month`, ou cai no mês corrente.
 *
 * @param hojeISO hoje no fuso de São Paulo — é contra ele que o futuro é
 *   medido, e é o padrão quando nada é informado.
 */
export function lerPeriodo(
  params: { from?: string | null; to?: string | null; month?: string | null },
  hojeISO: string,
): PeriodoLido {
  const from = String(params.from ?? "").trim();
  const to = String(params.to ?? "").trim();
  const month = String(params.month ?? "").trim();

  let de: string;
  let ate: string;

  if (from || to) {
    // Meia dupla é erro, não "assume o resto": adivinhar aqui produziria um
    // período que ninguém pediu.
    if (!from || !to) {
      return { ok: false, erro: "periodo_incompleto", detalhe: "Informe from E to, ou nenhum dos dois." };
    }
    if (!dataValida(from) || !dataValida(to)) {
      return { ok: false, erro: "data_invalida", detalhe: "from e to precisam ser datas reais no formato aaaa-mm-dd." };
    }
    de = from;
    ate = to;
  } else if (month) {
    if (!MES.test(month)) {
      return { ok: false, erro: "mes_invalido", detalhe: "month precisa estar no formato aaaa-mm." };
    }
    const [, m] = month.split("-").map(Number);
    if (m < 1 || m > 12) {
      return { ok: false, erro: "mes_invalido", detalhe: "O mês precisa estar entre 01 e 12." };
    }
    ({ de, ate } = doMes(month));
  } else {
    // Sem nada informado: o mês corrente, que é o padrão da tela.
    ({ de, ate } = doMes(hojeISO.slice(0, 7)));
  }

  if (de > ate) {
    /**
     * Invertido devolvia consulta vazia, e vazio aqui se lê como "não vendeu
     * nada" — o pior tipo de resposta errada, porque parece uma resposta.
     */
    return { ok: false, erro: "periodo_invertido", detalhe: "A data inicial é depois da final." };
  }

  const dias = diasEntre(de, ate);
  if (dias > MAX_DIAS) {
    return {
      ok: false,
      erro: "periodo_longo",
      detalhe: `O período pedido tem ${dias} dias; o máximo é ${MAX_DIAS}.`,
    };
  }

  const limiteFuturo = somarDias(hojeISO.slice(0, 10), FOLGA_FUTURO_DIAS);
  if (de > limiteFuturo) {
    // Período inteiro no futuro não tem venda pra buscar — e buscar custa igual.
    return { ok: false, erro: "periodo_futuro", detalhe: "O período começa no futuro." };
  }

  return { ok: true, de, ate, dias };
}
