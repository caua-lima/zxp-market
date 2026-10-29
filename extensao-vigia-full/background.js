import { lerPaginaDeAgendamento } from "./leitura.js";

/**
 * Vigia da agenda do Full — o trabalho em segundo plano da extensão.
 *
 * A cada 1 minuto (com o Chrome aberto): busca no app a lista de envios
 * vigiados (aba Full › "Avise quando abrir data"), abre a página de agendamento
 * de cada um COM O LOGIN DO ML DESTE CHROME (em segundo plano, sem abrir aba) e
 * lê se abriu data (leitura.js). Abriu: notificação aqui no PC e aviso ao app,
 * que manda o push pro celular. Nada da conta do ML sai deste navegador.
 */

const ALARME = "vigia-agenda-full";
const MINUTOS = 1;
/** O "ainda sem data" no celular: no máximo um a cada ~5 min (o app troca o anterior pelo novo). */
const PULSO_MS = 4.5 * 60_000;
const ML = "https://vendedores.mercadolivre.com.br/shipping/inbounds/";

async function config() {
  const { endereco = "", estados = {} } = await chrome.storage.local.get(["endereco", "estados"]);
  return { endereco, estados };
}

function notificar(id, titulo, corpo) {
  chrome.notifications.create(`vigia-${id}-${Date.now()}`, {
    type: "basic", iconUrl: "icone.png", title: titulo, message: corpo, priority: 2, requireInteraction: true,
  });
}

async function contarAoApp(endereco, id, estado, tipos) {
  try {
    await fetch(endereco, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboundId: String(id), estado, trecho: tipos.length ? `formas liberadas: ${tipos.join(", ")}` : "" }),
    });
  } catch { /* sem rede: na próxima volta tenta de novo */ }
}

export async function conferir() {
  const { endereco, estados } = await config();
  if (!endereco) return { ok: false, motivo: "sem_endereco" };

  let ids = [];
  try {
    const r = await fetch(endereco, { cache: "no-store" });
    if (r.status === 401) {
      await chrome.storage.local.set({ ultimo: { em: Date.now(), erro: "O endereço da vigia não vale mais. Gere outro no app (aba Full)." } });
      return { ok: false, motivo: "codigo_invalido" };
    }
    ids = (await r.json()).ids || [];
  } catch {
    await chrome.storage.local.set({ ultimo: { em: Date.now(), erro: "Sem conexão com o app." } });
    return { ok: false, motivo: "sem_rede" };
  }

  const linhas = [];
  for (const id of ids.slice(0, 5)) {
    let leitura = { estado: "indefinido", tipos: [] };
    try {
      const r = await fetch(`${ML}${id}/appointment-v2`, { credentials: "include", cache: "no-store" });
      leitura = lerPaginaDeAgendamento(await r.text(), id, r.url);
    } catch { /* rede: indefinido */ }

    const antes = estados[id];
    if (leitura.estado === "datas" && antes !== "datas") {
      notificar(id, `Agenda do Full liberada · envio #${id}`, "Abriu data pra agendar. Abra o Mercado Livre e agende já.");
    }
    if (leitura.estado === "login" && antes !== "login") {
      notificar(id, "Vigia do Full: entre no Mercado Livre", "Este Chrome saiu da conta do ML. Entre de novo pra vigia continuar.");
    }
    // O app só precisa saber quando muda (e sempre que há data, pra não perder o aviso).
    if (leitura.estado !== antes || leitura.estado === "datas") await contarAoApp(endereco, id, leitura.estado, leitura.tipos);
    estados[id] = leitura.estado;
    linhas.push({ id, estado: leitura.estado });
  }

  const algumaData = linhas.some((l) => l.estado === "datas");

  // Sinal de vida: tudo conferido e ainda sem data → "ainda sem data" no celular, a cada ~5 min.
  const { pulso = true, ultimoPulso = 0 } = await chrome.storage.local.get(["pulso", "ultimoPulso"]);
  const semData = linhas.filter((l) => l.estado === "sem_datas").map((l) => String(l.id));
  if (pulso && !algumaData && semData.length > 0 && Date.now() - ultimoPulso >= PULSO_MS) {
    try {
      await fetch(endereco, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pulso: true, ids: semData }),
      });
      await chrome.storage.local.set({ ultimoPulso: Date.now() });
    } catch { /* sem rede: tenta na próxima volta */ }
  }

  chrome.action.setBadgeText({ text: algumaData ? "!" : "" });
  chrome.action.setBadgeBackgroundColor({ color: algumaData ? "#36B37E" : "#15150f" });
  await chrome.storage.local.set({ estados, ultimo: { em: Date.now(), linhas } });
  return { ok: true, linhas };
}

/**
 * Abriu a página de agendamento de um envio neste Chrome e ele está sem data:
 * passa a vigiar sozinho (não precisa digitar o número no app).
 */
const PAGINA_DO_ENVIO = /^https:\/\/vendedores\.mercadolivre\.com\.br\/shipping\/inbounds\/(\d{5,15})\/appointment/;
const vistosAgora = new Set();

async function vigiarSeEstiverSemData(id) {
  if (vistosAgora.has(id)) return;
  vistosAgora.add(id);
  setTimeout(() => vistosAgora.delete(id), 60_000);
  const { endereco, estados } = await config();
  if (!endereco) return;
  try {
    const lista = await fetch(endereco, { cache: "no-store" });
    if (!lista.ok) return;
    if (((await lista.json()).ids || []).includes(id)) return; // já vigiado
    const r = await fetch(`${ML}${id}/appointment-v2`, { credentials: "include", cache: "no-store" });
    const leitura = lerPaginaDeAgendamento(await r.text(), id, r.url);
    if (leitura.estado !== "sem_datas") return;
    const resp = await fetch(endereco, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboundId: id, estado: "sem_datas", trecho: "", novo: true }),
    });
    if (resp.status === 409) {
      notificar(id, "Vigia do Full: limite de 5 envios", `Pare um envio no app (aba Full) pra vigiar o #${id}.`);
      return;
    }
    if (!resp.ok) return;
    estados[id] = "sem_datas";
    await chrome.storage.local.set({ estados });
    notificar(id, `Vigiando o envio #${id}`, "Está sem data. Quando o ML abrir agenda, chega o aviso aqui e no celular.");
    conferir();
  } catch {
    vistosAgora.delete(id);
  }
}

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status !== "complete") return;
  const m = PAGINA_DO_ENVIO.exec(tab.url || "");
  if (m) vigiarSeEstiverSemData(m[1]);
});

function agendar() {
  chrome.alarms.create(ALARME, { periodInMinutes: MINUTOS, delayInMinutes: 0.1 });
}

chrome.runtime.onInstalled.addListener(agendar);
chrome.runtime.onStartup.addListener(agendar);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARME) conferir(); });
chrome.notifications.onClicked.addListener((nid) => {
  const id = String(nid).split("-")[1];
  if (/^\d+$/.test(id)) chrome.tabs.create({ url: `${ML}${id}/appointment-v2` });
});
// A janelinha pede "conferir agora".
chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (msg && msg.tipo === "conferir") { conferir().then(responder); return true; }
  return false;
});
