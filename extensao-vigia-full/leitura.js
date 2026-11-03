/**
 * Lê a página de agendamento de um envio pro Full (o HTML que o ML entrega pra
 * quem está logado) e diz se pode haver data — e, depois, se HÁ data.
 *
 * DUAS ETAPAS, porque "forma de envio liberada" NÃO é "tem data":
 *
 * 1. A página (`lerPaginaDeAgendamento`). Nos dados embutidos,
 *    `availableShipmentTypes` lista as formas de envio (pickup, ftl, ftlp,
 *    supplier, spd). Todas `enabled: false` = "Não temos datas disponíveis"
 *    (conferido no código da página do ML, chunk 7177, 29/10/2026). Alguma
 *    ligada = "conferir": a forma está liberada, mas a data pode não existir.
 *
 * 2. As datas (`temHorarioLivre`). Em 03/11/2026 a "Coleta a domicílio" ligou e
 *    a tela dizia "Os centros de distribuição próximos não têm datas
 *    disponíveis" — o alarme tocou à toa. A página pede as datas de verdade a
 *    /api/shipping/inbounds/{id}/appointment-v2/schedule-availability?shipment_type=X
 *    e a resposta traz, por endereço (coleta) ou por centro (ftl/ftlp/supplier),
 *    `schedule_slots: [{ date, available_slots: [...] }]`. Data de verdade =
 *    algum `available_slots` com pelo menos um horário. Sem nenhum, o endereço
 *    vem com `errors: ["address_slots_not_available"]` — é exatamente o aviso
 *    do print.
 *
 * 3. Qual forma conta (background.js › FORMAS_DO_ALARME): só a COLETA A
 *    DOMICÍLIO. Em 03/11 veículo particular/transportadora/fornecedor
 *    (ftl/ftlp/supplier) tinham horário em Araçariguama e a coleta estava
 *    "Indisponível no momento"; o resto não importa pro dono.
 *
 * A frase "Não temos datas" em si NÃO serve de sinal: está no dicionário de
 * traduções da página, com ou sem data.
 *
 * Usado pela extensão (background.js) e pelos testes do app
 * (lib/domain/leitura-agenda-extensao.test.ts).
 */

/** As formas de envio que a página aceita perguntar (as mesmas constantes do ML). */
export const FORMAS_DE_ENVIO = ["pickup", "ftl", "ftlp", "supplier", "spd"];

/**
 * @param {string} html
 * @param {string|number} id número do envio
 * @param {string} urlFinal endereço depois dos redirecionamentos
 * @returns {{ estado: "conferir" | "sem_datas" | "login" | "indefinido", tipos: string[] }}
 */
export function lerPaginaDeAgendamento(html, id, urlFinal) {
  const texto = String(html || "");
  if (/\/login|identification|authorization/i.test(String(urlFinal || ""))) return { estado: "login", tipos: [] };
  if (!texto.includes(`"inboundId":${Number(id)}`)) {
    // Sem os dados do envio: ou caiu no login, ou o ML mudou a página.
    return { estado: /iniciar sess[aã]o|login/i.test(texto.slice(0, 5000)) ? "login" : "indefinido", tipos: [] };
  }

  let tipos = null;
  const m = texto.match(/"availableShipmentTypes":(\[[^\]]*\])/);
  if (m) {
    try { tipos = JSON.parse(m[1]); } catch { tipos = null; }
  }
  if (!Array.isArray(tipos)) return { estado: "indefinido", tipos: [] };
  const habilitados = tipos
    .filter((t) => t && t.enabled === true && FORMAS_DE_ENVIO.includes(String(t.type)))
    .map((t) => String(t.type));
  return habilitados.length > 0 ? { estado: "conferir", tipos: habilitados } : { estado: "sem_datas", tipos: [] };
}

/**
 * A resposta de schedule-availability tem algum horário livre? Procura em
 * qualquer profundidade um `available_slots` com pelo menos um item — vale pros
 * dois formatos (por endereço na coleta, por centro no ftl/ftlp/supplier).
 *
 * @param {unknown} resposta o JSON da resposta
 * @returns {{ livre: boolean, datas: string[] }} as datas com horário livre (as primeiras 5)
 */
export function temHorarioLivre(resposta) {
  const datas = new Set();
  let livre = false;
  const visitar = (no, profundidade) => {
    if (!no || typeof no !== "object" || profundidade > 12) return;
    if (Array.isArray(no)) { for (const x of no) visitar(x, profundidade + 1); return; }
    if (Array.isArray(no.available_slots) && no.available_slots.length > 0) {
      livre = true;
      if (typeof no.date === "string") datas.add(no.date.slice(0, 10));
    }
    for (const v of Object.values(no)) visitar(v, profundidade + 1);
  };
  visitar(resposta, 0);
  return { livre, datas: [...datas].sort().slice(0, 5) };
}
