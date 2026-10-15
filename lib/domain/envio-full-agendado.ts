/**
 * Envios AGENDADOS pro Full — as unidades que já têm destino marcado e por isso
 * não são mais das agências.
 *
 * ─── O PROBLEMA ─────────────────────────────────────────────────────────
 *
 * "Em casa" e "agência" são o MESMO estoque: o anúncio fora do Full vende do
 * monte que está no galpão (ver estoqueForaDoFull). Só que parte desse monte
 * pode já estar prometida ao Full: entram 379 unidades, 199 seguem pro centro
 * na quarta que vem, e o anúncio das agências deveria mostrar 180 — não 379.
 * Anunciar 379 vende o que vai embora na quarta.
 *
 * Esta é a conta que a pessoa fazia de cabeça (379 − 199 = 180) antes de
 * mexer no anúncio. Aqui ela fica registrada: o envio tem produto, quantidade e
 * dia, e o app passa a dizer quanto está LIVRE pras agências.
 *
 * ─── POR QUE O ESTOQUE ENTRA INTEIRO ────────────────────────────────────
 *
 * A entrada continua sendo de 379, não de 180. Quando o Full receber as 199, a
 * baixa tira 199 do livro e sobram 180 — exato. Lançar só 180 faria a baixa
 * deixar o galpão em −19. O agendamento é uma RESERVA em cima do livro, não um
 * lançamento: não mexe no estoque nem no custo médio.
 *
 * ─── A RESERVA SE DESFAZ SOZINHA ────────────────────────────────────────
 *
 * Quando a baixa de verdade é lançada (a automática da aba Full ou o "Enviar
 * pro Full" manual), o livro já desceu. Se a reserva continuasse de pé, o mesmo
 * lote seria descontado duas vezes e as agências veriam 199 a menos do que têm.
 * Por isso a saída pro Full registrada depois do agendamento ABATE a reserva
 * (`reservasPorProduto`), do envio mais próximo pro mais distante.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type StatusEnvioAgendado = "agendado" | "enviado" | "cancelado";

export type EnvioFullAgendado = {
  id: string;
  productId: string;
  /** Unidades destinadas ao Full neste envio. */
  quantidade: number;
  /** Dia previsto do envio (yyyy-mm-dd). */
  data: string;
  /** Dia em que o envio foi agendado (yyyy-mm-dd) — só saídas a partir dele abatem a reserva. */
  criadoEm: string;
  status: StatusEnvioAgendado;
  obs?: string;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
};

/** O pedaço do livro que importa aqui: as saídas pro Full. */
export type SaidaFull = { productId: string; tipo: string; quantidade: number; data: string };

export type EnvioComSaldo = {
  envio: EnvioFullAgendado;
  /** Quanto das unidades já saiu do livro (baixa lançada). */
  atendido: number;
  /** Quanto ainda está reservado. */
  restante: number;
  /** A data prevista já passou e ainda sobra reserva — a baixa não veio. */
  atrasado: boolean;
};

export type ReservaDoProduto = {
  /** Unidades ainda reservadas pro Full (soma dos envios em aberto). */
  reservado: number;
  envios: EnvioComSaldo[];
  /** O dia do próximo envio em aberto (o mais cedo). */
  proximaData: string | null;
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** yyyy-mm-dd que existe de verdade (30/02 não passa). */
export function dataValida(d: unknown): d is string {
  if (typeof d !== "string" || !DATA_ISO.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export type NovoEnvio = { productId: string; quantidade: number; data: string };

/** `null` = pode agendar; senão, o motivo em português. */
export function validarEnvio(e: NovoEnvio, hoje: string): string | null {
  if (!String(e.productId ?? "").trim()) return "Escolha o produto.";
  if (!Number.isFinite(e.quantidade) || !Number.isInteger(e.quantidade) || e.quantidade <= 0) {
    return "A quantidade precisa ser um número inteiro maior que zero.";
  }
  if (!dataValida(e.data)) return "Informe o dia do envio (dia/mês/ano).";
  if (e.data < hoje) return "Esse dia já passou. Agende a partir de hoje.";
  return null;
}

/**
 * A reserva de cada produto, já abatida pelo que o livro registrou de saída pro
 * Full depois do agendamento.
 *
 * Só conta `status === "agendado"`: enviado e cancelado não seguram unidade.
 * As saídas são consumidas na ordem do envio mais próximo (empate: o agendado
 * primeiro), e cada envio só aceita saída de dia igual ou posterior ao dia em
 * que foi agendado — a baixa de um lote antigo não pode apagar uma reserva nova.
 */
export function reservasPorProduto(
  envios: readonly EnvioFullAgendado[],
  saidas: readonly SaidaFull[],
  hoje: string,
): Map<string, ReservaDoProduto> {
  const abertos = new Map<string, EnvioFullAgendado[]>();
  for (const e of envios) {
    if (e.status !== "agendado" || !(e.quantidade > 0)) continue;
    const l = abertos.get(e.productId) ?? [];
    l.push(e);
    abertos.set(e.productId, l);
  }

  const saidasPorProduto = new Map<string, { data: string; sobra: number }[]>();
  for (const s of saidas) {
    if (s.tipo !== "saida_full" || !(s.quantidade > 0)) continue;
    const l = saidasPorProduto.get(s.productId) ?? [];
    l.push({ data: s.data, sobra: s.quantidade });
    saidasPorProduto.set(s.productId, l);
  }

  const resultado = new Map<string, ReservaDoProduto>();
  for (const [productId, lista] of abertos) {
    lista.sort((a, b) => a.data.localeCompare(b.data) || a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id));
    const pool = (saidasPorProduto.get(productId) ?? []).sort((a, b) => a.data.localeCompare(b.data));

    const linhas: EnvioComSaldo[] = [];
    for (const envio of lista) {
      let falta = envio.quantidade;
      for (const s of pool) {
        if (falta <= 0) break;
        if (s.sobra <= 0 || s.data < envio.criadoEm) continue;
        const tira = Math.min(falta, s.sobra);
        s.sobra -= tira;
        falta -= tira;
      }
      const atendido = envio.quantidade - falta;
      linhas.push({ envio, atendido, restante: falta, atrasado: falta > 0 && envio.data < hoje });
    }

    const emAberto = linhas.filter((l) => l.restante > 0);
    resultado.set(productId, {
      reservado: emAberto.reduce((s, l) => s + l.restante, 0),
      envios: linhas,
      proximaData: emAberto.length ? emAberto[0].envio.data : null,
    });
  }
  return resultado;
}

export type Disponibilidade = {
  /** O que as agências podem anunciar: o que está em casa menos o reservado. */
  livre: number;
  /** Reservado pro Full (inteiro, mesmo quando falta estoque pra cobri-lo). */
  reservado: number;
  /** Quanto falta em casa pra cumprir os envios agendados (0 = cobre). */
  faltam: number;
};

/**
 * Quanto sobra pras agências. Estoque negativo no livro conta como zero —
 * ele é sintoma de compra por lançar, não unidade (ver a coluna "Em casa").
 */
export function disponivelParaAgencias(emCasa: number, reservado: number): Disponibilidade {
  const casa = Math.max(Number(emCasa) || 0, 0);
  const res = Math.max(Number(reservado) || 0, 0);
  return { livre: Math.max(casa - res, 0), reservado: res, faltam: Math.max(res - casa, 0) };
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "qua, 22/10" — o dia da semana importa: o envio é combinado como "quarta que vem". */
export function rotuloDoDia(d: string): string {
  if (!dataValida(d)) return d;
  const dt = new Date(`${d}T00:00:00Z`);
  return `${DIAS[dt.getUTCDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Dias entre dois yyyy-mm-dd (positivo = `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);
}

/** "hoje", "amanhã", "em 6 dias", "há 2 dias". */
export function quandoFalta(data: string, hoje: string): string {
  const n = diasEntre(hoje, data);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

/** Os próximos `n` dias a partir de `hoje` (inclusive), em yyyy-mm-dd — atalhos de data. */
export function proximosDias(hoje: string, n: number): string[] {
  if (!dataValida(hoje)) return [];
  const base = Date.parse(`${hoje}T00:00:00Z`);
  return Array.from({ length: Math.max(0, n) }, (_, i) => new Date(base + i * 86400000).toISOString().slice(0, 10));
}

export type PlanoDoDestino =
  | { acao: "nada" }
  | { acao: "criar"; quantidade: number; data: string }
  | { acao: "editar"; id: string; quantidade: number; data: string }
  | { acao: "encerrar"; id: string; status: "enviado" | "cancelado" }
  /** Há mais de um envio em aberto: o total não diz qual deles mudar. */
  | { acao: "varios" }
  | { acao: "invalido"; motivo: string };

/**
 * O que gravar pra o produto passar a ter `alvo` unidades destinadas ao Full
 * (o restante em casa fica pras agências), no dia `data`.
 *
 * É a operação da tela "Destinação": a pessoa diz "199 pro Full" e não precisa
 * saber se isso é criar, editar ou cancelar um envio. Pode ser refeita a
 * qualquer hora — o estoque mudou, muda o destino.
 *
 * `alvo` é o que AINDA vai sair (o restante). Se parte do envio já foi baixada,
 * a quantidade gravada soma o que já saiu, pra baixa feita não "desfazer" a reserva.
 */
export function planejarDestino(
  reserva: ReservaDoProduto | null,
  alvo: number,
  data: string,
  hoje: string,
): PlanoDoDestino {
  if (!Number.isInteger(alvo) || alvo < 0) return { acao: "invalido", motivo: "A quantidade precisa ser um número inteiro, zero ou mais." };
  const abertos = (reserva?.envios ?? []).filter((e) => e.restante > 0);
  if (abertos.length > 1) return { acao: "varios" };

  if (abertos.length === 0) {
    if (alvo === 0) return { acao: "nada" };
    if (!dataValida(data)) return { acao: "invalido", motivo: "Informe o dia do envio (dia/mês/ano)." };
    if (data < hoje) return { acao: "invalido", motivo: "Esse dia já passou. Agende a partir de hoje." };
    return { acao: "criar", quantidade: alvo, data };
  }

  const [it] = abertos;
  if (alvo === 0) return { acao: "encerrar", id: it.envio.id, status: it.atendido > 0 ? "enviado" : "cancelado" };

  const dia = data || it.envio.data;
  if (!dataValida(dia)) return { acao: "invalido", motivo: "Informe o dia do envio (dia/mês/ano)." };
  if (dia !== it.envio.data && dia < hoje) return { acao: "invalido", motivo: "Esse dia já passou. Agende a partir de hoje." };
  const quantidade = it.atendido + alvo;
  if (quantidade === it.envio.quantidade && dia === it.envio.data) return { acao: "nada" };
  return { acao: "editar", id: it.envio.id, quantidade, data: dia };
}
