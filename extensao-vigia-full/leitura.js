/**
 * Diz se a COLETA A DOMICÍLIO de um envio pro Full tem data de verdade.
 *
 * O dono só usa a coleta ("o restante não importa"): veículo particular,
 * transportadora e fornecedor ficam de fora.
 *
 * DE ONDE VEM A RESPOSTA: o mesmo endereço que a página de agendamento do ML
 * usa pra buscar as datas —
 *   /api/shipping/inbounds/{id}/appointment-v2/schedule-availability?shipment_type=pickup
 * (achado no código da página, chunk 7177 do fbm-inb-xp-appointment-fe). A
 * resposta traz, por endereço de coleta,
 *   { address: { errors: [...] }, schedule_slots: [{ date, available_slots: [...] }] }
 * e data de verdade é algum `available_slots` com pelo menos um horário. Sem
 * horário, o endereço vem com `errors: ["address_slots_not_available"]` — o
 * aviso "Os centros de distribuição próximos não têm datas disponíveis".
 *
 * HISTÓRICO (03/11/2026), pra ninguém repetir:
 *  - "forma de envio liberada" (`availableShipmentTypes` com `enabled: true`)
 *    NÃO é data: a coleta ligou e não tinha horário — tocou à toa;
 *  - veículo particular/transportadora/fornecedor tinham horário em
 *    Araçariguama com a coleta "Indisponível no momento" — tocou à toa de novo;
 *  - a página de agendamento passou a dar "Algo salió mal" (404) enquanto o
 *    endereço de datas seguia respondendo — por isso a página não é mais lida;
 *  - a coleta tinha horário num endereço ANTIGO em São Paulo, e nenhum nos de
 *    Mogi Guaçu — tocou à toa pela terceira vez. Por isso só valem os endereços
 *    que o dono marca na janelinha da extensão (sem nenhum marcado, não toca).
 *
 * Usado pela extensão (background.js) e pelos testes do app
 * (lib/domain/leitura-agenda-extensao.test.ts).
 */

/** A pergunta das datas da coleta de um envio (caminho relativo ao site do vendedor). */
export function caminhoDasDatasDaColeta(id) {
  return `/api/shipping/inbounds/${encodeURIComponent(String(id))}/appointment-v2/schedule-availability?shipment_type=pickup`;
}

/**
 * Alguma parte da resposta tem horário livre? Procura em qualquer profundidade
 * um `available_slots` com pelo menos um item.
 *
 * @param {unknown} resposta o JSON da resposta
 * @returns {{ livre: boolean, datas: string[] }} as datas com horário livre (as primeiras 5)
 */
export function temHorarioLivre(resposta) {
  const datas = new Set();
  let livre = false;
  let amostra = "";
  const visitar = (no, profundidade) => {
    if (!no || typeof no !== "object" || profundidade > 12) return;
    if (Array.isArray(no)) { for (const x of no) visitar(x, profundidade + 1); return; }
    if (Array.isArray(no.available_slots) && no.available_slots.length > 0) {
      livre = true;
      if (typeof no.date === "string") datas.add(no.date.slice(0, 10));
      // O primeiro horário como o ML mandou: se tocar à toa de novo, mostra o porquê.
      if (!amostra) { try { amostra = JSON.stringify(no.available_slots[0]).slice(0, 120); } catch { amostra = "?"; } }
    }
    for (const v of Object.values(no)) visitar(v, profundidade + 1);
  };
  visitar(resposta, 0);
  return { livre, datas: [...datas].sort().slice(0, 5), amostra };
}

/** Os endereços de coleta que a resposta lista: id e um rótulo legível ("Rua X 81 · Cidade"). */
export function enderecosDaResposta(json) {
  const lista = json && Array.isArray(json.availability) ? json.availability : [];
  return lista
    .map((a) => a && a.address)
    .filter((e) => e && e.id != null)
    .map((e) => ({
      id: String(e.id),
      rotulo: [[e.street_name, e.street_number].filter(Boolean).join(" "), e.city_name].filter(Boolean).join(" · ") || `endereço ${e.id}`,
    }));
}

/** Texto de "precisa escolher o endereço" — a janelinha e o background reconhecem por ele. */
export const ESCOLHA_O_ENDERECO = "escolha o endereço da coleta na extensão";

/**
 * Lê a resposta da pergunta das datas da coleta, olhando SÓ os endereços
 * escolhidos.
 *
 * @param {number} status o código HTTP
 * @param {string} urlFinal o endereço depois dos redirecionamentos
 * @param {unknown} json o corpo já lido como JSON (null se não era JSON)
 * @param {string[]} escolhidos ids dos endereços de coleta que valem pro alarme
 * @returns {{ estado: "datas" | "sem_datas" | "login" | "indefinido", datas: string[], trecho: string, enderecos: {id: string, rotulo: string}[] }}
 */
export function lerRespostaDaColeta(status, urlFinal, json, escolhidos = []) {
  if (/\/login|identification|authorization/i.test(String(urlFinal || "")) || status === 401 || status === 403) {
    return { estado: "login", datas: [], trecho: "", enderecos: [] };
  }
  if (status !== 200) return { estado: "indefinido", datas: [], trecho: `o ML respondeu ${status}`, enderecos: [] };
  // Só confia numa resposta com a lista de endereços: qualquer outra coisa não é "sem data".
  if (!json || typeof json !== "object" || !Array.isArray(json.availability)) {
    return { estado: "indefinido", datas: [], trecho: "resposta do ML sem agenda", enderecos: [] };
  }
  const enderecos = enderecosDaResposta(json);
  const valem = new Set((escolhidos || []).map(String));
  if (valem.size === 0) return { estado: "indefinido", datas: [], trecho: ESCOLHA_O_ENDERECO, enderecos };
  const meus = json.availability.filter((a) => a && a.address && valem.has(String(a.address.id)));
  if (meus.length === 0) {
    return { estado: "indefinido", datas: [], trecho: "o endereço escolhido não aparece mais na coleta deste envio", enderecos };
  }
  const achado = temHorarioLivre(meus);
  if (achado.livre) {
    return { estado: "datas", datas: achado.datas, trecho: `com horário: coleta no endereço escolhido${achado.datas.length ? ` · ${achado.datas.join(", ")}` : ""}${achado.amostra ? ` · ${achado.amostra}` : ""}`, enderecos };
  }
  return { estado: "sem_datas", datas: [], trecho: "sem horário na coleta (endereço escolhido)", enderecos };
}
