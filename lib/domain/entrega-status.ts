/**
 * O status de entrega em português, como o Mercado Livre mostra.
 *
 * ─── POR QUE TRADUZIR ───────────────────────────────────────────────────
 *
 * A API devolve `status`/`substatus` em inglês e em código:
 * `ready_to_ship`/`in_warehouse`, `shipped`, `delivered`. A tela de pedidos
 * mostrava esse código cru, que não diz nada pra quem está conferindo se um
 * envio atrasou. O painel do ML mostra "Processando no centro de
 * distribuição · Chega quinta-feira dia 3 de setembro" — e é essa frase que
 * responde a pergunta.
 *
 * ─── O SUBSTATUS IMPORTA ────────────────────────────────────────────────
 *
 * `ready_to_ship` sozinho é ambíguo: no Full significa que o centro de
 * distribuição está processando (nada a fazer), e fora do Full significa que
 * a etiqueta espera VOCÊ despachar. São situações opostas pra quem lê, e por
 * isso a logística entra na decisão.
 */

export type EnvioParaStatus = {
  /** `status` do envio no ML. */
  status?: string | null;
  /** `substatus` do envio, quando existe. */
  substatus?: string | null;
  /** `logistic_type` — "fulfillment" é Full. */
  logistica?: string | null;
  /** Data estimada de entrega (yyyy-mm-dd ou ISO). */
  estimadaEm?: string | null;
  /** Limite da estimativa, quando o ML dá uma faixa em vez de um dia. */
  estimadaAte?: string | null;
  /** Data real da entrega, quando já entregue. */
  entregueEm?: string | null;
};

export type StatusDeEntrega = {
  /** A frase principal: "A caminho", "Processando no centro de distribuição". */
  titulo: string;
  /** A linha de baixo: "Chega quinta-feira dia 3 de setembro". Vazia quando não há prazo. */
  prazo: string;
  /** Cor semântica pra tela: o que exige ação sua não pode ficar igual ao que já está resolvido. */
  tom: "ok" | "andamento" | "acao" | "problema" | "neutro";
  /** Exige alguma coisa de VOCÊ — despachar, resolver. */
  pedeAcao: boolean;
};

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Interpreta yyyy-mm-dd como data LOCAL — `new Date("2026-09-03")` viraria UTC e voltaria um dia. */
function comoData(iso: string | null | undefined): Date | null {
  const s = String(iso ?? "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "quinta-feira dia 3 de setembro", ou "hoje"/"amanhã" quando é perto.
 *
 * Perto importa mais que preciso: "chega amanhã" é acionável, "chega
 * quinta-feira dia 3" exige o leitor consultar o calendário.
 */
export function textoDaData(iso: string | null | undefined, hojeISO: string): string {
  const d = comoData(iso);
  const hoje = comoData(hojeISO);
  if (!d || !hoje) return "";
  const dias = Math.round((d.getTime() - hoje.getTime()) / 86400000);
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias < 0) return `${DIAS[d.getDay()]} dia ${d.getDate()} de ${MESES[d.getMonth()]}`;
  return `${DIAS[d.getDay()]} dia ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

/** "entre os dias 2 e 3 de setembro" quando a estimativa é uma faixa. */
function textoDaFaixa(deISO: string, ateISO: string): string {
  const a = comoData(deISO);
  const b = comoData(ateISO);
  if (!a || !b) return "";
  if (a.getMonth() === b.getMonth()) {
    return `entre os dias ${a.getDate()} e ${b.getDate()} de ${MESES[a.getMonth()]}`;
  }
  return `entre ${a.getDate()} de ${MESES[a.getMonth()]} e ${b.getDate()} de ${MESES[b.getMonth()]}`;
}

const ehFull = (l?: string | null) => String(l ?? "").toLowerCase() === "fulfillment";

/**
 * Traduz o envio.
 *
 * `hojeISO` entra como parâmetro pra função continuar pura: "chega amanhã"
 * depende de que dia é hoje, e sem isso o teste dependeria do relógio.
 */
export function statusDeEntrega(envio: EnvioParaStatus, hojeISO: string): StatusDeEntrega {
  const status = String(envio.status ?? "").trim().toLowerCase();
  const sub = String(envio.substatus ?? "").trim().toLowerCase();
  const full = ehFull(envio.logistica);

  // ── Já entregue: o prazo vira a data real, não a estimativa ──
  if (status === "delivered" || envio.entregueEm) {
    const quando = textoDaData(envio.entregueEm ?? envio.estimadaEm, hojeISO);
    return {
      titulo: "Entregue",
      prazo: quando ? `Entregue ${quando}` : "",
      tom: "ok",
      pedeAcao: false,
    };
  }

  const de = String(envio.estimadaEm ?? "").slice(0, 10);
  const ate = String(envio.estimadaAte ?? "").slice(0, 10);
  const temFaixa = Boolean(de && ate && de !== ate);
  const prazo = temFaixa
    ? `Chega ${textoDaFaixa(de, ate)}`
    : de
      ? `Chega ${textoDaData(de, hojeISO)}`
      : "";

  if (status === "not_delivered") {
    return { titulo: "Não entregue", prazo: "", tom: "problema", pedeAcao: true };
  }
  if (status === "cancelled") {
    return { titulo: "Envio cancelado", prazo: "", tom: "problema", pedeAcao: false };
  }
  if (status === "shipped") {
    return { titulo: "A caminho", prazo, tom: "andamento", pedeAcao: false };
  }

  if (status === "ready_to_ship") {
    /**
     * A mesma palavra do ML significa coisas opostas conforme a logística:
     * no Full o centro de distribuição cuida, fora dele a etiqueta espera
     * VOCÊ. Confundir os dois faz o vendedor ignorar o que precisa despachar.
     */
    if (full) {
      return { titulo: "Processando no centro de distribuição", prazo, tom: "andamento", pedeAcao: false };
    }
    if (sub === "printed") {
      return { titulo: "Etiqueta impressa — falta despachar", prazo, tom: "acao", pedeAcao: true };
    }
    return { titulo: "Pronto pra despachar", prazo, tom: "acao", pedeAcao: true };
  }

  if (status === "handling" || status === "pending") {
    return {
      titulo: full ? "Preparando no centro de distribuição" : "Aguardando preparação",
      prazo,
      tom: full ? "andamento" : "acao",
      pedeAcao: !full,
    };
  }

  // Status desconhecido: mostra o prazo, que é o que interessa, e não inventa
  // uma frase pra um estado que o ML pode ter acabado de criar.
  return { titulo: status ? "Em andamento" : "Sem envio", prazo, tom: "neutro", pedeAcao: false };
}
