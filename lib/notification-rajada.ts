import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { buildGroupedSalesContent, type NotificationEventType, type SalePushPayload } from "@/lib/domain/notifications";
import {
  JANELA_MS,
  LIMIAR_AGRUPAMENTO,
  idsDoResumo,
  minutosDaJanela,
  type DecisaoNaJanela,
} from "@/lib/domain/janela-de-vendas";
import { lerJanela, registrarVendaNaJanela } from "@/lib/notification-janelas";
import { COLECAO_OUTBOX, publicarEEntregar, type Dependencias, type EspecPush } from "@/lib/notification-outbox";

/**
 * A orquestração de uma venda numa rajada: decide a posição dela na janela e
 * publica o aviso avulso e, quando cabe, os resumos. A política está em
 * lib/domain/janela-de-vendas; aqui está o encadeamento, separado de
 * notificar-venda pra ser testado contra o emulador com o FCM simulado.
 */

/**
 * A decisão de rajada desta venda.
 *
 * A decisão é gravada no outbox do push individual (campo `agrupamento`) e
 * REUSADA quando a mesma venda volta — retry do webhook, sync que reencontra o
 * pedido. Sem isso, cada passagem contava a venda de novo: dez vendas com retry
 * viravam vinte, uma venda suprimida por agrupamento reaparecia como aviso
 * avulso, e um resumo que falhou era reenviado como individual.
 *
 * Prejuízo NUNCA agrupa — é o aviso que não pode se perder num resumo.
 */
export async function decidirRajada(
  db: Firestore,
  venda: { eventId: string; type: NotificationEventType; gross: number },
  agora = Date.now(),
): Promise<DecisaoNaJanela | null> {
  if (venda.type === "sale_negative_margin") return null;

  const existente = (await db.collection(COLECAO_OUTBOX).doc(venda.eventId).get()).data();
  const gravada = existente?.agrupamento as { janelaId?: string; n?: number } | null | undefined;
  if (gravada?.janelaId && Number.isFinite(gravada.n)) {
    const n = Number(gravada.n);
    const janela = await lerJanela(db, gravada.janelaId);
    const membros = janela ? Object.values(janela.membros) : [];
    const total = Math.max(membros.length, n);
    return {
      janelaId: gravada.janelaId,
      n,
      modo: n >= LIMIAR_AGRUPAMENTO ? "agrupada" : "individual",
      totalNaJanela: total,
      grossNaJanela: membros.reduce((s, m) => s + m.gross, 0),
      fim: janela?.fim ?? 0,
      abre: n === LIMIAR_AGRUPAMENTO,
      precisaDeFechamento: total > LIMIAR_AGRUPAMENTO,
    };
  }
  return registrarVendaNaJanela(db, { eventId: venda.eventId, gross: venda.gross }, agora);
}

/**
 * Publica os resumos da rajada: o de abertura (na 4ª venda) e, se ela passou de
 * quatro, o de fechamento — agendado pro fim da janela, com o número FINAL
 * calculado na hora de enviar. Ids determinísticos: repetir é idempotente.
 */
async function publicarResumosDaRajada(
  deps: Dependencias,
  d: DecisaoNaJanela,
  montarBase: (pushId: string, titulo: string, corpo: string, tag: string) => SalePushPayload,
): Promise<number> {
  const ids = idsDoResumo(d.janelaId);
  const texto = buildGroupedSalesContent(d.totalNaJanela, d.grossNaJanela, minutosDaJanela({ inicio: d.fim - JANELA_MS, fim: d.fim }));
  const base = (pushId: string): SalePushPayload => ({
    ...montarBase(pushId, texto.title, texto.body, ids.tag),
    // O conteúdo real (número final) é recalculado da janela na hora de enviar.
    resumoCount: d.totalNaJanela,
  });
  const conteudo = { tipo: "resumo_janela", janelaId: d.janelaId } as const;

  const abertura = await publicarEEntregar(deps, {
    pushId: ids.abertura, eventId: ids.abertura, type: "sale_paid", payload: base(ids.abertura), isSummary: true,
    rajada: "resumo", atualizaEvento: false, origem: "venda:resumo-abertura", conteudo,
  });
  let aceitas = abertura.aceitas;

  if (d.precisaDeFechamento) {
    const fechamento = await publicarEEntregar(deps, {
      pushId: ids.fechamento, eventId: ids.fechamento, type: "sale_paid", payload: base(ids.fechamento), isSummary: true,
      rajada: "resumo", atualizaEvento: false, origem: "venda:resumo-fechamento", conteudo,
      // Só sai quando a janela fecha; se o varredor demorar demais, expira em vez de chegar tarde.
      entregarApos: d.fim, validadeMs: 10 * 60_000,
    });
    aceitas += fechamento.aceitas;
  }
  return aceitas;
}

export type ResultadoDaVenda = {
  /** Destinos que aceitaram o aviso avulso + os resumos, nesta passagem. */
  aceitas: number;
  decisao: DecisaoNaJanela | null;
  /** A venda entrou na rajada: quem agrupa recebe resumo em vez do aviso avulso. */
  agrupada: boolean;
};

/**
 * O push avulso de uma venda, dada a decisão de rajada. Uma função só pra o
 * mesmo push nascer junto do evento (S09) e ser entregue em seguida.
 */
export function especDaVendaAvulsa(
  venda: { eventId: string; type: NotificationEventType; payload: SalePushPayload },
  decisao: DecisaoNaJanela | null,
): EspecPush {
  return {
    pushId: venda.eventId, eventId: venda.eventId, type: venda.type, payload: venda.payload, origem: "venda",
    rajada: decisao?.modo === "agrupada" ? "individual_agrupada" : undefined,
    agrupamento: decisao ? { janelaId: decisao.janelaId, n: decisao.n } : undefined,
  };
}

/**
 * Publica uma venda respeitando a rajada.
 *
 * O aviso avulso é publicado SEMPRE — quem agrupa é suprimido no ENVIO, por
 * decisão de cada pessoa (e isso não é falha de entrega). Assim quem prefere
 * cada venda recebe, e a preferência é a do momento do envio.
 */
export async function publicarVendaComRajada(
  deps: Dependencias,
  venda: {
    eventId: string;
    type: NotificationEventType;
    payload: SalePushPayload;
    gross: number;
    /** Monta o payload base de um resumo (deep link, tag). */
    montarResumo: (pushId: string, titulo: string, corpo: string, tag: string) => SalePushPayload;
    /**
     * A decisão já tomada por quem chamou — pra criar o push avulso junto do
     * evento (S09), a decisão vem antes. Ausente, é tomada aqui.
     */
    decisao?: DecisaoNaJanela | null;
  },
): Promise<ResultadoDaVenda> {
  const decisao = venda.decisao !== undefined
    ? venda.decisao
    : await decidirRajada(deps.db, { eventId: venda.eventId, type: venda.type, gross: venda.gross }, deps.agora());
  const agrupada = decisao?.modo === "agrupada";

  const avulso = await publicarEEntregar(deps, especDaVendaAvulsa(venda, decisao));
  let aceitas = avulso.aceitas;
  if (decisao && agrupada) aceitas += await publicarResumosDaRajada(deps, decisao, venda.montarResumo);

  return { aceitas, decisao, agrupada };
}
