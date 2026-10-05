/**
 * A coleta pro Full de um período, montada de TRÊS fontes — não só do ML.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * A DRE só enxergava remessa que a API de operações do Mercado Livre devolvesse
 * AGORA. Isso derrubava a linha de coleta (e o custo que o dono já tinha
 * digitado) em três casos:
 *
 *   · período com mais de 55 dias — o ML não consulta mais; a linha virava "—"
 *     mesmo com o custo salvo no Firestore;
 *   · o ML fora do ar, token vencido ou cota estourada — a busca inteira
 *     falhava e a linha sumia;
 *   · remessa que saiu da janela do ML — o custo continuava salvo, mas sem a
 *     data da remessa não havia como saber a que mês ele pertence.
 *
 * ─── AS FONTES ──────────────────────────────────────────────────────────
 *
 *   1. API do ML (opcional)  → data, unidades e, às vezes, custo da remessa;
 *   2. custo guardado        → `full_remessas/{remessa}.custoManual`, digitado
 *      à mão (o ML não expõe a taxa de coleta), agora junto da DATA da remessa;
 *   3. baixa de estoque      → `estoque_movimentos` com id `full-{remessa}-…`,
 *      cuja `data` é a da remessa. Existe pra qualquer remessa que já recebeu
 *      baixa, mesmo muito antiga, e é o que dá data ao custo digitado antes de
 *      a data ser gravada.
 *
 * A data de cada remessa é a da primeira fonte que a tiver (ML > custo > baixa).
 * O custo é o do ML se houver, senão o digitado. `null` NUNCA vira zero: zero é
 * "coleta grátis" (informação), null é "não sei" (pendência).
 *
 * Puro: sem Firestore, sem rede. Autossuficiente (sem `@/`).
 */

/** Teto de dias que a busca de operações de estoque do ML aceita. Além disso, só o que está salvo. */
export const JANELA_MAX_DIAS_FULL = 55;

export type RemessaDaApi = {
  remessa: string;
  data: string;
  recebido?: number;
  custo?: number | null;
  /** Transferência entre centros do ML — não é coleta sua, não tem taxa sua. */
  ehTransferencia?: boolean;
};

export type CustoGuardado = {
  remessa: string;
  custoManual: number | null;
  /** Dia da remessa (AAAA-MM-DD), quando já foi gravado junto do custo. */
  data?: string | null;
  recebido?: number | null;
};

export type BaixaDeRemessa = { remessa: string; data: string; unidades: number };

/** O que o editor de custos (CustosColetaFull) mostra por remessa. */
export type RemessaDaColeta = {
  remessa: string;
  data: string;
  recebido: number;
  custo: number | null;
  /** true = o valor veio do que foi digitado (o ML mostra como ESTIMADO). */
  custoEstimado: boolean;
};

export type SemData = { remessa: string; custo: number };

export type ColetaFull = {
  total: number;
  /** Alguma remessa do período ainda sem custo: o total é piso, não valor fechado. */
  parcial: boolean;
  /**
   * O ML NÃO foi consultado por o período ser mais antigo que a janela dele.
   * Não é "sem coleta": a lista abaixo vem só do que está salvo.
   */
  foraDaJanela: boolean;
  /** O ML foi consultado e falhou (token, cota, fora do ar). */
  mlFalhou: boolean;
  remessas: number;
  todas: RemessaDaColeta[];
  pendentes: number;
  /** Custos digitados sem data conhecida: não entram em período nenhum. */
  semData: SemData[];
};

export type EntradaDaColeta = {
  periodo: { from: string; to: string };
  /** `null` = o ML não foi consultado ou falhou (diga qual em `motivoSemApi`). */
  api: RemessaDaApi[] | null;
  motivoSemApi?: "fora_da_janela" | "falhou";
  guardados: CustoGuardado[];
  baixas: BaixaDeRemessa[];
};

const ehDia = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** `Number.isFinite` sem aceitar string: custo digitado é número ou null. */
function numeroOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function montarColetaFull(e: EntradaDaColeta): ColetaFull {
  const { from, to } = e.periodo;
  const porId = new Map<string, {
    api?: RemessaDaApi;
    guardado?: CustoGuardado;
    baixa?: BaixaDeRemessa;
  }>();
  const no = (id: string) => {
    let x = porId.get(id);
    if (!x) { x = {}; porId.set(id, x); }
    return x;
  };

  const transferencias = new Set<string>();
  for (const r of e.api ?? []) {
    if (!r.remessa) continue;
    if (r.ehTransferencia) { transferencias.add(r.remessa); continue; }
    no(r.remessa).api = r;
  }
  for (const g of e.guardados) if (g.remessa) no(g.remessa).guardado = g;
  for (const b of e.baixas) {
    if (!b.remessa) continue;
    const x = no(b.remessa);
    // Várias baixas por remessa (uma por produto): a data é a mais antiga, e as unidades somam.
    if (x.baixa) {
      x.baixa = {
        remessa: b.remessa,
        data: b.data < x.baixa.data ? b.data : x.baixa.data,
        unidades: x.baixa.unidades + b.unidades,
      };
    } else x.baixa = { ...b };
  }

  const todas: RemessaDaColeta[] = [];
  const semData: SemData[] = [];

  for (const [id, x] of porId) {
    // O ML disse que é transferência: não é coleta sua, nem se houver custo salvo por engano.
    if (transferencias.has(id)) continue;

    const custoGuardado = numeroOuNull(x.guardado?.custoManual);
    const custoApi = numeroOuNull(x.api?.custo);
    const custo = custoApi ?? custoGuardado;

    const data = [x.api?.data, x.guardado?.data, x.baixa?.data].find(ehDia) ?? null;
    if (!data) {
      // Custo digitado cujo dia ninguém sabe: não dá pra dizer a que mês pertence.
      if (custo != null) semData.push({ remessa: id, custo });
      continue;
    }
    if (data < from || data > to) continue;

    // Só existe no banco como doc "ignorada" (sem custo, sem baixa, sem ML)? Não é coleta.
    if (!x.api && !x.baixa && custoGuardado == null) continue;

    todas.push({
      remessa: id,
      data,
      recebido: Number(x.api?.recebido ?? x.guardado?.recebido ?? x.baixa?.unidades ?? 0) || 0,
      custo,
      custoEstimado: custoApi == null && custoGuardado != null,
    });
  }

  todas.sort((a, b) => b.data.localeCompare(a.data) || a.remessa.localeCompare(b.remessa));
  const pendentes = todas.filter((r) => r.custo == null).length;
  return {
    total: todas.reduce((s, r) => s + (r.custo ?? 0), 0),
    parcial: pendentes > 0,
    foraDaJanela: e.api === null && e.motivoSemApi === "fora_da_janela",
    mlFalhou: e.api === null && e.motivoSemApi === "falhou",
    remessas: todas.length,
    todas,
    pendentes,
    semData: semData.sort((a, b) => a.remessa.localeCompare(b.remessa)),
  };
}

/**
 * O que a linha "Coleta pro Full" da DRE mostra, decidido fora do JSX pra ter
 * teste. `indisponivel` troca o valor por "—": zero com remessas sem custo NÃO
 * é "coleta de graça", é custo não informado, e R$ 0,00 aqui inflaria o
 * resultado líquido.
 */
export function descreverColeta(c: ColetaFull, janelaDias: number): { nota: string; indisponivel: boolean } {
  if (c.foraDaJanela && c.remessas === 0) {
    return {
      indisponivel: true,
      nota: c.semData.length > 0
        ? `nenhuma remessa deste período tem baixa de estoque ou custo com data. O Mercado Livre só devolve as remessas dos últimos ${janelaDias} dias.`
        : `nenhuma remessa deste período tem baixa de estoque ou custo informado, e o Mercado Livre só devolve as remessas dos últimos ${janelaDias} dias`,
    };
  }

  const n = c.remessas;
  let nota: string;
  if (n === 0) nota = "nenhuma remessa pro Full neste período";
  else if (c.total === 0 && c.pendentes === n) {
    nota = `${n} remessa(s) sem custo informado — o Mercado Livre não expõe esse valor pela API. Pegue em Envios › detalhe do envio › Tarifas › Custo da coleta Full e informe no painel abaixo.`;
  } else if (c.parcial) {
    nota = `${n} remessa(s) — parte ainda sem custo informado, então este valor é o mínimo (informe o resto no painel abaixo)`;
  } else nota = `${n} remessa(s) enviada(s) no período`;

  if (c.foraDaJanela) nota += " · lista montada do que está salvo (baixas e custos informados): o ML não devolve remessas deste período";
  else if (c.mlFalhou) nota += " · o ML não respondeu agora; lista montada do que está salvo";

  return { nota, indisponivel: c.pendentes === n && n > 0 && c.total === 0 };
}

/**
 * Quais custos digitados ganham a data da remessa agora.
 *
 * Roda na rota do Full, enquanto o ML ainda devolve a remessa (janela de 55
 * dias): é a última chance de saber o dia dela por lá. Só os que têm custo e
 * ainda não têm data; transferência entre centros não é coleta sua; e a data
 * precisa ser um dia de verdade.
 */
export function remessasParaDatar(
  remessas: { remessa: string; data?: unknown; recebido?: unknown; ehTransferencia?: boolean }[],
  semDataGravada: ReadonlySet<string>,
): { remessa: string; data: string; recebido: number }[] {
  return remessas
    .filter((r) => semDataGravada.has(r.remessa) && !r.ehTransferencia && ehDia(r.data))
    .map((r) => ({ remessa: r.remessa, data: r.data as string, recebido: Number(r.recebido) || 0 }));
}
