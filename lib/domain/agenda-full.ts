/**
 * A vigia da AGENDA do Full: o envio (inbound) foi criado no ML, mas "Não temos
 * datas disponíveis no momento". Quando o ML abrir uma data, o app avisa por push.
 *
 * ─── O QUE SE SABE DA API ───────────────────────────────────────────────
 *
 * A API pública do ML não documenta o agendamento do Full do Brasil (só o fluxo
 * do "Fulfillment China"). Medido em 28/10/2026: o prefixo `/inbounds/{id}` EXISTE
 * na api.mercadolibre.com (sem token: 403 do gateway; outros prefixos dão 404).
 * Não se sabe o formato da resposta com token — por isso esta leitura é
 * tolerante: procura listas de datas em qualquer campo que fale de
 * agenda/disponibilidade, e diz "sem acesso" ou "indefinido" quando não dá pra
 * afirmar nada. A tela mostra o que o ML respondeu, pra nunca prometer uma vigia
 * que não está vendo nada.
 */

export type RespostaDoInbound = { caminho: string; status: number; corpo: unknown };

export type EstadoDaAgenda =
  /** Achou data(s) livre(s): é o que dispara o push. */
  | "datas_liberadas"
  /** O ML respondeu e a lista de datas está vazia. */
  | "sem_datas"
  /** O ML recusou a consulta (401/403) em todos os endereços. */
  | "sem_acesso"
  /** Respondeu, mas sem nada que dê pra ler como agenda; ou só erro. */
  | "indefinido";

export type LeituraDaAgenda = {
  estado: EstadoDaAgenda;
  /** Datas livres achadas, AAAA-MM-DD, sem repetir, em ordem. */
  datas: string[];
  /** Uma linha pra tela: o que o ML respondeu em cada endereço. */
  detalhe: string;
};

const CAMPO_DE_AGENDA = /slot|availab|dispon|schedul|appointment|window|janela|agenda|dates?$|dias?$/i;
const DATA = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/;

/**
 * Lê as respostas do ML. Só conta como data livre uma data que está DENTRO de
 * uma lista de um campo de agenda — uma data solta (criação do envio, prazo)
 * não é vaga nenhuma.
 */
export function lerAgenda(respostas: readonly RespostaDoInbound[]): LeituraDaAgenda {
  const datas = new Set<string>();
  let achouListaDeAgenda = false;

  const coletarDatas = (v: unknown, profundidade: number) => {
    if (profundidade > 4 || v == null) return;
    if (typeof v === "string") { const m = v.match(DATA); if (m) datas.add(m[1]); return; }
    if (Array.isArray(v)) { v.forEach((x) => coletarDatas(x, profundidade + 1)); return; }
    if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) coletarDatas(x, profundidade + 1);
  };

  const visitar = (v: unknown, chave: string, profundidade: number) => {
    if (profundidade > 8 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      if (CAMPO_DE_AGENDA.test(chave)) {
        achouListaDeAgenda = true;
        v.forEach((x) => coletarDatas(x, 0));
      } else {
        v.forEach((x) => visitar(x, chave, profundidade + 1));
      }
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) visitar(x, k, profundidade + 1);
  };

  for (const r of respostas) if (r.status >= 200 && r.status < 300) visitar(r.corpo, "", 0);

  const detalhe = respostas.map((r) => `${r.caminho.replace(/^\/inbounds\/\d+/, "") || "/"} ${r.status}`).join(" · ");
  const ordenadas = [...datas].sort();
  if (ordenadas.length > 0) return { estado: "datas_liberadas", datas: ordenadas, detalhe };
  if (achouListaDeAgenda) return { estado: "sem_datas", datas: [], detalhe };
  const algumOk = respostas.some((r) => r.status >= 200 && r.status < 300);
  const recusas = respostas.filter((r) => r.status === 401 || r.status === 403).length;
  if (!algumOk && respostas.length > 0 && recusas === respostas.filter((r) => r.status !== 404).length && recusas > 0) {
    return { estado: "sem_acesso", datas: [], detalhe };
  }
  return { estado: "indefinido", datas: [], detalhe };
}

/** Número do envio como o ML mostra (#80517703): só dígitos, 5 a 15. */
export function inboundValido(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/^#/, "");
  return /^\d{5,15}$/.test(s) ? s : null;
}

/** A data em texto curto pro aviso: "30/10" ou "30/10, 31/10 e 03/11". */
export function datasPorExtenso(datas: readonly string[]): string {
  const curtas = datas.slice(0, 4).map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
  const extra = datas.length > 4 ? ` (+${datas.length - 4})` : "";
  if (curtas.length <= 1) return (curtas[0] ?? "") + extra;
  return `${curtas.slice(0, -1).join(", ")} e ${curtas[curtas.length - 1]}${extra}`;
}
