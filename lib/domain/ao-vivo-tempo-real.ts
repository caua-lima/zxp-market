import { diaBRDe } from "./periodo-br";
import { ehStatusNaoVenda } from "./venda-status";

/**
 * Vendas ao vivo EM TEMPO REAL.
 *
 * Antes a barra perguntava ao ML de minuto em minuto, e o aviso de venda ainda
 * esperava 4 s antes de reler — a venda levava até um minuto pra aparecer. Agora
 * o webhook, assim que grava o pedido, publica um SINAL (`ao_vivo/sinal`, no
 * Firestore) e o app, que escuta esse documento, soma a venda NA HORA. Logo
 * depois relê a rota (que já inclui o pedido recém-gravado) e o número
 * "otimista" é trocado pelo oficial.
 *
 * Aqui mora a parte pura: quando um pedido vira sinal, e como somar no que a
 * barra já mostra sem contar duas vezes.
 */

export type SinalAoVivo = {
  /** Sobe a cada sinal — é o que o app compara pra saber que chegou coisa nova. */
  seq: number;
  orderId: string;
  /** `true` = venda de pé (soma na hora); `false` = cancelada (o app só relê). */
  valida: boolean;
  valor: number;
  unidades: number;
  titulo: string;
  /** A data do pedido: é ela que decide o dia, igual à barra (ver resumirAoVivo). */
  dateCreated: string;
  /** Quando o sinal saiu. */
  em: number;
};

/** O pedido como `estadoDoPedido` grava em `ml_orders`. */
export type EstadoParaSinal = {
  order_id?: unknown;
  status?: unknown;
  date_created?: unknown;
  total_amount?: unknown;
  items?: { quantity?: unknown; title?: unknown }[] | unknown;
};

const DIA_MS = 24 * 3600 * 1000;
const diaBR = (ms: number) => diaBRDe(new Date(ms).toISOString());

/**
 * O sinal deste pedido, ou `null` quando a barra não muda.
 *
 * O webhook do ML dispara a CADA mudança do pedido — pagamento, etiqueta,
 * envio, entrega. Só duas interessam à barra: o pedido que ela ainda não
 * conhece (`antes` ausente) e a troca entre "venda" e "cancelada". Etiqueta
 * impressa não é sinal: viraria uma releitura do ML a cada mudança de envio.
 *
 * E só hoje ou ontem (o ontem alimenta o "vs ontem"): cancelamento de pedido da
 * semana passada não mexe em nada que a barra mostra.
 */
export function sinalDoPedido(
  estado: EstadoParaSinal,
  antes: { status?: unknown } | undefined,
  agoraMs: number,
): Omit<SinalAoVivo, "seq"> | null {
  const orderId = String(estado.order_id ?? "").trim();
  if (!orderId) return null;
  const dateCreated = String(estado.date_created ?? "");
  const dia = diaBRDe(dateCreated);
  if (dia !== diaBR(agoraMs) && dia !== diaBR(agoraMs - DIA_MS)) return null;

  const valida = !ehStatusNaoVenda(estado.status);
  if (antes) {
    const eraValida = !ehStatusNaoVenda(antes.status);
    if (eraValida === valida) return null; // nada que a barra veja mudou
  } else if (!valida) {
    return null; // nasceu cancelado: nunca entrou no número
  }

  const itens = Array.isArray(estado.items) ? (estado.items as { quantity?: unknown; title?: unknown }[]) : [];
  return {
    orderId,
    valida,
    valor: Math.round((Number(estado.total_amount ?? 0) || 0) * 100) / 100,
    unidades: itens.reduce((s, it) => s + (Number(it?.quantity ?? 1) || 0), 0),
    titulo: String(itens[0]?.title ?? "").slice(0, 80),
    dateCreated,
    em: agoraMs,
  };
}

/** Uma venda que o app soube pelo sinal (ou pelo push) e que a rota pode ainda não ter. */
export type VendaNova = {
  orderId: string;
  valor: number;
  unidades: number;
  titulo: string;
  dateCreated: string;
  /** Quando o app soube dela — pra desistir se a rota nunca a confirmar. */
  recebidaEm: number;
};

type Somavel = {
  dia: string;
  hoje: { vendas: number; pedidos: number; unidades: number };
  porHora: { hoje: number[]; ontem: number[] };
  ultimaVenda: { em: number; valor: number; titulo: string } | null;
  idsHoje?: string[];
  metaDoDia?: { alvo: number; pct: number; falta: number; batida: boolean; mesBatido: boolean } | null;
};

/**
 * O que a barra mostra = o que a rota devolveu + as vendas que chegaram depois.
 *
 * Venda que a rota JÁ contou (está em `idsHoje`) não soma de novo; venda de
 * outro dia não entra. A meta de hoje é refeita com o mesmo alvo (ele fica
 * parado o dia todo — ver metaDoDia). Não muda nada no objeto recebido.
 */
export function comVendasNovas<T extends Somavel>(dados: T, novas: readonly VendaNova[]): T {
  const ja = new Set(dados.idsHoje ?? []);
  const entram = novas.filter((v) => {
    if (ja.has(v.orderId) || diaBRDe(v.dateCreated) !== dados.dia) return false;
    ja.add(v.orderId);
    return true;
  });
  if (entram.length === 0) return dados;

  const hoje = { ...dados.hoje };
  const porHoraHoje = [...dados.porHora.hoje];
  let ultimaVenda = dados.ultimaVenda;
  for (const v of entram) {
    hoje.vendas = Math.round((hoje.vendas + v.valor) * 100) / 100;
    hoje.pedidos += 1;
    hoje.unidades += v.unidades;
    const ms = Date.parse(v.dateCreated);
    const quando = Number.isFinite(ms) ? ms : v.recebidaEm;
    const hora = new Date(quando - 3 * 3600 * 1000).getUTCHours();
    porHoraHoje[hora] = (porHoraHoje[hora] ?? 0) + v.valor;
    if (!ultimaVenda || quando > ultimaVenda.em) ultimaVenda = { em: quando, valor: v.valor, titulo: v.titulo };
  }

  const m = dados.metaDoDia;
  const metaDoDia = m && m.alvo > 0
    ? { ...m, pct: (hoje.vendas / m.alvo) * 100, falta: Math.round(Math.max(m.alvo - hoje.vendas, 0) * 100) / 100, batida: hoje.vendas >= m.alvo }
    : m;

  return {
    ...dados,
    hoje,
    porHora: { ...dados.porHora, hoje: porHoraHoje },
    ultimaVenda,
    idsHoje: [...ja],
    ...(dados.metaDoDia !== undefined ? { metaDoDia } : {}),
  };
}

/**
 * As vendas novas que ainda valem a pena guardar: some a que a rota já contou
 * e a de outro dia. Também some a que ficou `validadeMs` sem a rota confirmar
 * — é o seguro contra um número inflado pra sempre se a busca do ML nunca a
 * listar (o push da venda seria outra fonte de erro, então não se insiste).
 */
export function vendasAindaPendentes(
  pendentes: readonly VendaNova[],
  dados: { dia: string; idsHoje?: string[] },
  agoraMs: number,
  validadeMs = 5 * 60_000,
): VendaNova[] {
  const contados = new Set(dados.idsHoje ?? []);
  return pendentes.filter((v) => !contados.has(v.orderId) && diaBRDe(v.dateCreated) === dados.dia && agoraMs - v.recebidaEm < validadeMs);
}
