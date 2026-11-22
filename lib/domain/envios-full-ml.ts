/**
 * Envios pro Full como o PAINEL do Mercado Livre os mostra ("Gestão de envios
 * Full"): agenda da coleta, prazo pra editar, quantidades por produto e custo
 * da coleta.
 *
 * ─── POR QUE O PAINEL, E NÃO A API ──────────────────────────────────────
 *
 * Medido em 22/11/2026 com o token do app: `/inbounds/{id}`,
 * `/users/{id}/inbounds` e `/stock/fulfillment/inbounds` respondem 403 — o
 * recurso existe, o app não tem permissão. A agenda, o prazo e o custo só
 * existem pra quem está logado no painel. Quem lê é a extensão do Chrome
 * (extensao-vigia-full), com o login do vendedor; ela manda os objetos crus
 * e TODA a interpretação mora aqui, testada contra recortes reais da página
 * (__fixtures__/envios-full-ml.json).
 *
 * Puro e autossuficiente (sem `@/`): roda no servidor e na tela.
 */

/** O ciclo de vida de um envio, na língua de quem opera. */
export type SituacaoEnvio =
  /** Criado no ML, sem coleta marcada. Não reserva nada. */
  | "rascunho"
  /** Coleta marcada e ainda dá pra editar: reserva, mas o anúncio continua com tudo. */
  | "agendado"
  /** Passou o prazo de edição: as unidades vão embora, o anúncio de agência desce. */
  | "travado"
  /** O ML começou a receber (ou terminou): é a hora da baixa. */
  | "recebendo"
  | "finalizado"
  | "cancelado"
  | "vencido";

export type ProdutoDoEnvio = {
  sku: string;
  inventoryId: string;
  /** MLB do anúncio do Full — é por ele que se acha o produto no Estoque. */
  itemId: string;
  titulo: string;
  declarado: number;
  /** Unidades que o centro do Full recebeu (chegam aos poucos: 169 hoje, 180 amanhã). */
  recebido: number;
  aVenda: number;
  diferenca: number;
};

export type CustoDaColeta = {
  valor: number;
  /** O ML ainda está estimando (aparece assim que a coleta é marcada). */
  estimado: boolean;
  /** Já cobrado — é o número definitivo, o que aparece no faturamento. */
  cobrado: boolean;
};

export type EnvioFullML = {
  id: string;
  statusML: string;
  subStatusML: string;
  /** Dia e hora da coleta (ISO, com fuso). */
  coletaEm: string | null;
  /** Até quando dá pra editar ou cancelar o envio (ISO, com fuso). */
  editarAte: string | null;
  recebidoEm: string | null;
  declarado: number;
  recebido: number;
  aVenda: number;
  /** Vazio até a extensão ler a página de detalhe deste envio. */
  produtos: ProdutoDoEnvio[];
  custo: CustoDaColeta | null;
  /** last_updated do ML — muda quando qualquer coisa do envio muda. */
  atualizadoNoML: string | null;
  detalheLido: boolean;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const txt = (v: unknown): string => (v == null ? "" : String(v));
const isoOuNull = (v: unknown): string | null => {
  const s = txt(v);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto => (v && typeof v === "object" ? (v as Bruto) : {});

/** Uma linha da LISTA (`appProps.pageProps.data.results[]`). */
export function lerEnvioDaLista(r: unknown): EnvioFullML | null {
  const o = obj(r);
  const id = txt(o.id).trim();
  if (!/^\d{5,}$/.test(id)) return null;
  const ap = obj(o.appointment);
  const cobranca = obj(o.inbound_charges);
  const cobrado = num(cobranca.total_charged);
  return {
    id,
    statusML: txt(o.status),
    subStatusML: txt(o.sub_status),
    coletaEm: isoOuNull(ap.date),
    editarAte: isoOuNull(ap.cancellation_limit_date),
    recebidoEm: isoOuNull(o.reception_date),
    declarado: num(o.products_count),
    recebido: 0,
    aVenda: num(o.on_sale_units),
    produtos: [],
    custo: cobrado > 0 ? { valor: cobrado, estimado: false, cobrado: true } : null,
    atualizadoNoML: isoOuNull(o.last_updated),
    detalheLido: false,
  };
}

/** A página de DETALHE (`appProps.pageProps.view.data`). */
export function lerDetalheDoEnvio(d: unknown): EnvioFullML | null {
  const o = obj(d);
  const id = txt(o.inboundId).trim();
  if (!/^\d{5,}$/.test(id)) return null;
  const ap = obj(o.appointment);
  const unidades = Array.isArray(o.units) ? (o.units as unknown[]) : [];
  const produtos: ProdutoDoEnvio[] = unidades.map((u) => {
    const x = obj(u);
    return {
      sku: txt(x.sku),
      inventoryId: txt(x.inventoryId),
      itemId: txt(x.itemId).toUpperCase(),
      titulo: txt(x.itemTitle),
      declarado: num(x.declaredQuantity),
      recebido: num(x.receivedQuantity),
      aVenda: num(x.onSaleQuantity),
      diferenca: num(x.differencesQuantity),
    };
  }).filter((p) => p.itemId || p.inventoryId);

  /**
   * Custo da coleta = PICKUP_CHARGE. Multas (diferença de SKU, etiqueta…)
   * também são cobrança do envio e entram somadas — é o que o painel mostra
   * como "Total". `estimated` some quando o ML cobra de verdade.
   */
  const cobrancas = (Array.isArray(o.charges) ? (o.charges as unknown[]) : []).map(obj)
    .filter((c) => txt(c.type).toUpperCase() !== "BONUS");
  const valor = cobrancas.reduce((s, c) => s + num(c.totalCharged), 0);
  const estimado = cobrancas.some((c) => obj(c.detail).estimated === true || (Array.isArray(c.tags) && (c.tags as unknown[]).includes("PENDING")));

  const ud = obj(o.unitsDetail);
  return {
    id,
    statusML: txt(o.status),
    subStatusML: txt(o.subStatus),
    coletaEm: isoOuNull(ap.scheduledDate),
    editarAte: isoOuNull(o.cancellationLimitDate),
    recebidoEm: isoOuNull(ap.arrivalDate),
    declarado: num(ud.sent) || produtos.reduce((s, p) => s + p.declarado, 0),
    recebido: num(ud.received) || produtos.reduce((s, p) => s + p.recebido, 0),
    aVenda: produtos.reduce((s, p) => s + p.aVenda, 0),
    produtos,
    custo: cobrancas.length && valor > 0 ? { valor: Math.round(valor * 100) / 100, estimado, cobrado: !estimado } : null,
    atualizadoNoML: null,
    detalheLido: true,
  };
}

/**
 * Junta a linha da lista com o detalhe. A lista é a fonte do status e do
 * "atualizado em"; o detalhe, dos produtos e do custo estimado. O custo
 * COBRADO da lista (total_charged) vence o estimado do detalhe — é o
 * definitivo, e às vezes a lista fica pronta antes da página de detalhe.
 */
export function mesclarEnvio(lista: EnvioFullML | null, detalhe: EnvioFullML | null): EnvioFullML | null {
  if (!lista) return detalhe;
  if (!detalhe) return lista;
  const custo = lista.custo?.cobrado ? lista.custo : detalhe.custo ?? lista.custo;
  return {
    ...detalhe,
    statusML: lista.statusML || detalhe.statusML,
    subStatusML: lista.subStatusML || detalhe.subStatusML,
    coletaEm: lista.coletaEm ?? detalhe.coletaEm,
    editarAte: lista.editarAte ?? detalhe.editarAte,
    recebidoEm: lista.recebidoEm ?? detalhe.recebidoEm,
    aVenda: Math.max(lista.aVenda, detalhe.aVenda),
    custo,
    atualizadoNoML: lista.atualizadoNoML,
  };
}

const FINAIS = new Set(["closed_ok", "closed_with_changes", "closed", "finished"]);

/** Em que pé está o envio, agora. */
export function situacaoDoEnvio(e: EnvioFullML, agoraMs: number): SituacaoEnvio {
  const st = e.statusML.toLowerCase();
  if (st === "cancelled" || st === "canceled") return "cancelado";
  if (st === "expired" || e.subStatusML.toLowerCase() === "expired") return "vencido";
  if (FINAIS.has(st)) return "finalizado";
  if (e.recebidoEm || e.recebido > 0 || e.aVenda > 0) return "recebendo";
  if (!e.coletaEm) return "rascunho";
  const limite = e.editarAte ? Date.parse(e.editarAte) : Date.parse(e.coletaEm);
  return agoraMs > limite ? "travado" : "agendado";
}

/** O dia da coleta em Brasília (AAAA-MM-DD) — é o "dia do envio" da reserva. */
export function diaDaColeta(e: Pick<EnvioFullML, "coletaEm">): string | null {
  if (!e.coletaEm) return null;
  const t = Date.parse(e.coletaEm);
  return Number.isFinite(t) ? new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

/** A reserva que existe hoje (o formato de EnvioFullAgendado que interessa aqui). */
export type ReservaExistente = {
  id: string;
  productId: string;
  quantidade: number;
  data: string;
  status: "agendado" | "enviado" | "cancelado";
  obs?: string;
  inboundId?: string;
  anuncioJaBaixado?: boolean;
};

export type AcaoDeReserva =
  | { tipo: "criar"; inboundId: string; productId: string; quantidade: number; data: string }
  | { tipo: "atualizar"; id: string; inboundId: string; quantidade: number; data: string }
  | { tipo: "encerrar"; id: string; inboundId: string; status: "cancelado" };

/** MLB (do anúncio do Full) → id do produto no Estoque. */
export type MapaDeProdutos = ReadonlyMap<string, string>;

/**
 * As reservas que os envios do ML pedem, comparadas com as que existem.
 *
 * - envio AGENDADO ou TRAVADO → uma reserva por produto, com a quantidade
 *   declarada e o dia da coleta; mudou no ML, muda aqui;
 * - envio CANCELADO ou VENCIDO → a reserva dele sai (cancelada);
 * - RECEBENDO/FINALIZADO → não mexe: a baixa consome a reserva sozinha
 *   (reservasPorProduto abate saida_full);
 * - RASCUNHO → nada ainda.
 *
 * Reserva feita À MÃO pro mesmo envio (obs com "#80517703", antes desta
 * sincronização existir) é ADOTADA — senão o mesmo envio reservaria duas vezes.
 */
export function planejarReservas(
  envios: readonly EnvioFullML[],
  produtoPorMlb: MapaDeProdutos,
  existentes: readonly ReservaExistente[],
  agoraMs: number,
): { acoes: AcaoDeReserva[]; semCadastro: { inboundId: string; itemId: string; sku: string }[] } {
  const acoes: AcaoDeReserva[] = [];
  const semCadastro: { inboundId: string; itemId: string; sku: string }[] = [];

  for (const e of envios) {
    const sit = situacaoDoEnvio(e, agoraMs);
    const doEnvio = (productId: string) => existentes.find((r) =>
      r.productId === productId && r.status === "agendado"
      && (r.inboundId === e.id || (!r.inboundId && (r.obs ?? "").includes(`#${e.id}`))));

    if (sit === "cancelado" || sit === "vencido") {
      for (const r of existentes) {
        if (r.status === "agendado" && (r.inboundId === e.id || (!r.inboundId && (r.obs ?? "").includes(`#${e.id}`)))) {
          acoes.push({ tipo: "encerrar", id: r.id, inboundId: e.id, status: "cancelado" });
        }
      }
      continue;
    }
    if (sit !== "agendado" && sit !== "travado") continue;
    if (!e.detalheLido) continue;
    const data = diaDaColeta(e);
    if (!data) continue;

    // O mesmo produto pode vir em mais de uma linha (variações): soma.
    const porProduto = new Map<string, number>();
    for (const p of e.produtos) {
      const productId = produtoPorMlb.get(p.itemId);
      if (!productId) { semCadastro.push({ inboundId: e.id, itemId: p.itemId, sku: p.sku }); continue; }
      porProduto.set(productId, (porProduto.get(productId) ?? 0) + p.declarado);
    }
    for (const [productId, quantidade] of porProduto) {
      if (!(quantidade > 0)) continue;
      const r = doEnvio(productId);
      if (!r) acoes.push({ tipo: "criar", inboundId: e.id, productId, quantidade, data });
      else if (r.quantidade !== quantidade || r.data !== data || r.inboundId !== e.id) {
        acoes.push({ tipo: "atualizar", id: r.id, inboundId: e.id, quantidade, data });
      }
    }
  }
  return { acoes, semCadastro };
}

export type AcaoDeAnuncio = { reservaId: string; inboundId: string; productId: string; quantidade: number };

/**
 * Passou o prazo de editar: o que ainda está no anúncio de agência sai dele.
 * Só reserva DESTE envio e ainda não baixada (`anuncioJaBaixado`) — a que foi
 * baixada à mão (coleta #80517703, 22/11) não desce de novo.
 */
export function planejarTravamento(
  envios: readonly EnvioFullML[],
  reservas: readonly ReservaExistente[],
  agoraMs: number,
): AcaoDeAnuncio[] {
  const travados = new Set(envios.filter((e) => situacaoDoEnvio(e, agoraMs) === "travado").map((e) => e.id));
  return reservas
    .filter((r) => r.status === "agendado" && r.inboundId && travados.has(r.inboundId) && !r.anuncioJaBaixado && r.quantidade > 0)
    .map((r) => ({ reservaId: r.id, inboundId: r.inboundId!, productId: r.productId, quantidade: r.quantidade }));
}

/** Id da baixa de um envio por produto — o MESMO da baixa manual (lib/domain/remessas.ts › movIdRemessa). */
export const idDaBaixa = (inboundId: string, productId: string) => `full-${inboundId}-${productId}`;
/** Complemento que leva a baixa até `total` unidades. Id por total: rodar de novo não duplica. */
export const idDoComplemento = (inboundId: string, productId: string, total: number) => `${idDaBaixa(inboundId, productId)}-ate-${total}`;

export type MovimentoDaBaixa = { id: string; productId: string; tipo: string; quantidade: number };

export type BaixaPendente = {
  inboundId: string;
  productId: string;
  itemId: string;
  titulo: string;
  /** O que o Full recebeu, segundo o ML. */
  recebido: number;
  /** O que o livro já baixou deste envio (baixa + complementos). */
  baixado: number;
  /** Quanto falta lançar (recebido − baixado). */
  falta: number;
  /** Id do lançamento a gravar: a baixa (primeira vez) ou um complemento. */
  idLancamento: string;
};

/**
 * Baixa que falta pra cada produto de envio já recebido.
 *
 * O caso que motivou: o ML registrou 169 de 180, o Dash baixou 169 e marcou a
 * remessa como resolvida; as 11 que entraram dias depois nunca chegavam ao
 * livro. Aqui a régua é sempre o que o ML diz que recebeu AGORA: faltou,
 * vira complemento.
 *
 * Recebido MENOR que o baixado não é desfeito sozinho (`excesso`): o ML às
 * vezes recontabiliza e volta; uma pessoa decide.
 */
export function planejarBaixas(
  envios: readonly EnvioFullML[],
  produtoPorMlb: MapaDeProdutos,
  movimentos: readonly MovimentoDaBaixa[],
  agoraMs: number,
): { pendentes: BaixaPendente[]; excesso: BaixaPendente[] } {
  const pendentes: BaixaPendente[] = [];
  const excesso: BaixaPendente[] = [];
  for (const e of envios) {
    const sit = situacaoDoEnvio(e, agoraMs);
    if ((sit !== "recebendo" && sit !== "finalizado") || !e.detalheLido) continue;
    const porProduto = new Map<string, { recebido: number; itemId: string; titulo: string }>();
    for (const p of e.produtos) {
      const productId = produtoPorMlb.get(p.itemId);
      if (!productId) continue;
      const a = porProduto.get(productId) ?? { recebido: 0, itemId: p.itemId, titulo: p.titulo || p.sku };
      a.recebido += p.recebido;
      porProduto.set(productId, a);
    }
    for (const [productId, a] of porProduto) {
      const base = idDaBaixa(e.id, productId);
      const baixado = movimentos
        .filter((m) => m.tipo === "saida_full" && (m.id === base || m.id.startsWith(`${base}-ate-`)))
        .reduce((s, m) => s + Math.max(Number(m.quantidade) || 0, 0), 0);
      const linha: BaixaPendente = {
        inboundId: e.id, productId, itemId: a.itemId, titulo: a.titulo,
        recebido: a.recebido, baixado, falta: a.recebido - baixado,
        idLancamento: baixado === 0 ? base : idDoComplemento(e.id, productId, a.recebido),
      };
      if (linha.falta > 0) pendentes.push(linha);
      else if (linha.falta < 0) excesso.push(linha);
    }
  }
  return { pendentes, excesso };
}

/**
 * O custo da coleta a gravar, ou null se não há o que mudar.
 *
 * Valor DIGITADO por uma pessoa só é trocado pelo COBRADO (definitivo) —
 * nunca por estimativa. Estimativa preenche o vazio e se atualiza sozinha
 * até o ML cobrar.
 */
export function custoAGravar(
  e: Pick<EnvioFullML, "custo">,
  atual: { custoManual?: number | null; custoInformadoPor?: string | null } | null,
): { valor: number; origem: "ml-estimado" | "ml-cobrado" } | null {
  if (!e.custo || !(e.custo.valor > 0)) return null;
  const origem = e.custo.cobrado ? "ml-cobrado" as const : "ml-estimado" as const;
  const valorAtual = atual?.custoManual ?? null;
  const porSync = String(atual?.custoInformadoPor ?? "").startsWith("ml-");
  if (valorAtual == null) return { valor: e.custo.valor, origem };
  if (!porSync && origem === "ml-estimado") return null;
  if (Math.abs(valorAtual - e.custo.valor) < 0.005 && String(atual?.custoInformadoPor) === origem) return null;
  return { valor: e.custo.valor, origem };
}

/**
 * Quais envios a extensão precisa abrir no detalhe nesta rodada: os que não
 * estão encerrados, e os encerrados há pouco tempo cujo custo ainda é
 * estimativa ou cujo detalhe nunca foi lido (a contagem final e a cobrança
 * chegam dias depois).
 */
export function enviosParaDetalhar(envios: readonly EnvioFullML[], agoraMs: number, diasAposFim = 30): string[] {
  const limite = agoraMs - diasAposFim * 86400000;
  return envios.filter((e) => {
    const sit = situacaoDoEnvio(e, agoraMs);
    if (sit === "cancelado" || sit === "vencido" || sit === "rascunho") return false;
    if (sit !== "finalizado") return true;
    const quando = Date.parse(e.recebidoEm ?? e.coletaEm ?? "") || 0;
    if (quando < limite) return false;
    return !e.detalheLido || !e.custo?.cobrado;
  }).map((e) => e.id);
}
