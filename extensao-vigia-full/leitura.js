/**
 * Lê a página de agendamento de um envio pro Full (o HTML que o ML entrega pra
 * quem está logado) e diz se abriu data.
 *
 * O sinal (medido em 28/10/2026, envio sem data): nos dados embutidos da página,
 * `availableShipmentTypes` lista as formas de envio (pickup, ftl, ftlp,
 * supplier) e TODAS vêm `enabled: false` — por isso a lista "Escolha como você
 * deseja enviá-los" fica vazia e aparece "Não temos datas disponíveis". A frase
 * em si NÃO serve de sinal: ela está no dicionário de traduções da página, com
 * ou sem data.
 *
 * Usado pela extensão (background.js) e pelos testes do app
 * (lib/domain/leitura-agenda-extensao.test.ts).
 *
 * @param {string} html
 * @param {string|number} id número do envio
 * @param {string} urlFinal endereço depois dos redirecionamentos
 * @returns {{ estado: "datas" | "sem_datas" | "login" | "indefinido", tipos: string[] }}
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
  const habilitados = Array.isArray(tipos) ? tipos.filter((t) => t && t.enabled === true).map((t) => String(t.type)) : [];

  // Qualquer disponibilidade preenchida também é data aberta.
  const campos = ["pickupScheduleAvailability", "ftlFtlpSupplierScheduleAvailability", "initialSelectedNodeAvailability", "selectedNodeAvailability"];
  const comDisponibilidade = campos.some((c) => {
    const r = texto.match(new RegExp(`"${c}":(null|\\{|\\[)`));
    return r && r[1] !== "null";
  });

  if (habilitados.length > 0 || comDisponibilidade) return { estado: "datas", tipos: habilitados };
  if (Array.isArray(tipos)) return { estado: "sem_datas", tipos: [] };
  return { estado: "indefinido", tipos: [] };
}
