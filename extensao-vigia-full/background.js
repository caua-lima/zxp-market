import { caminhoDasDatasDaColeta, ESCOLHA_O_ENDERECO, lerRespostaDaColeta } from "./leitura.js";
import { proximoHorario } from "./horario.js";

/**
 * Vigia da agenda do Full — o trabalho em segundo plano da extensão.
 *
 * Em horários fixos de 2 em 2 minutos (12:00, 12:02, 12:04…), com o Chrome
 * aberto; com data aberta, todo minuto cheio — é o que faz o celular tocar de novo.: busca no app a lista de envios
 * vigiados (aba Full › "Avise quando abrir data"), abre a página de agendamento
 * de cada um COM O LOGIN DO ML DESTE CHROME (em segundo plano, sem abrir aba) e
 * lê se abriu data (leitura.js). Abriu: notificação e ALARME aqui no PC e aviso
 * ao app, que faz o celular tocar a cada ~1 min até alguém parar. Nada da conta
 * do ML sai deste navegador.
 */

const ALARME = "vigia-agenda-full";
const MINUTOS = 2;
/** Com data aberta o alarme do celular toca a cada volta: aí confere de 1 em 1 minuto. */
const MINUTOS_COM_DATA = 1;
/**
 * O "ainda sem data" no celular é só pra saber que a vigia está viva: UM por
 * hora, na primeira conferência de cada hora cheia (13:00, 14:00…). Data aberta
 * não espera nada disso: avisa na mesma conferência em que aparece.
 */
const HORA_MS = 60 * 60_000;
const horaDe = (ms) => Math.floor(ms / HORA_MS);
const ML = "https://vendedores.mercadolivre.com.br/shipping/inbounds/";
const SITE_DO_VENDEDOR = "https://vendedores.mercadolivre.com.br";

/**
 * Lê um envio: pergunta ao ML as datas da COLETA A DOMICÍLIO (o mesmo endereço
 * que a página de agendamento usa) e só diz "datas" com horário livre de
 * verdade. Veículo particular, transportadora e fornecedor não contam. Ver
 * leitura.js — inclusive o porquê de a página não ser mais lida.
 */
async function lerEnvio(id) {
  const resp = await fetch(SITE_DO_VENDEDOR + caminhoDasDatasDaColeta(id), {
    credentials: "include", cache: "no-store", headers: { Accept: "application/json" },
  });
  let json = null;
  try { json = await resp.json(); } catch { json = null; }
  // Só os endereços de coleta marcados na janelinha valem (leitura.js conta por quê).
  const { enderecosColeta = [], enderecosConhecidos = {} } = await chrome.storage.local.get(["enderecosColeta", "enderecosConhecidos"]);
  const leitura = lerRespostaDaColeta(resp.status, resp.url, json, enderecosColeta);
  if (leitura.enderecos.length) {
    let mudou = false;
    for (const e of leitura.enderecos) if (enderecosConhecidos[e.id] !== e.rotulo) { enderecosConhecidos[e.id] = e.rotulo; mudou = true; }
    if (mudou) await chrome.storage.local.set({ enderecosConhecidos });
  }
  if (leitura.trecho === ESCOLHA_O_ENDERECO) {
    const { avisouEscolher = false } = await chrome.storage.local.get("avisouEscolher");
    if (!avisouEscolher) {
      notificar("escolher", "Vigia do Full: escolha o endereço da coleta", "Abra a extensão e marque o endereço onde o ML busca. Sem isso o alarme não toca.");
      await chrome.storage.local.set({ avisouEscolher: true });
    }
  }
  return leitura;
}

async function config() {
  const { endereco = "", estados = {} } = await chrome.storage.local.get(["endereco", "estados"]);
  return { endereco, estados };
}

function notificar(id, titulo, corpo) {
  chrome.notifications.create(`vigia-${id}-${Date.now()}`, {
    type: "basic", iconUrl: "icone.png", title: titulo, message: corpo, priority: 2, requireInteraction: true,
  });
}

/**
 * ALARME DO PC: com data aberta, o PC bipa alto sem parar (documento invisível
 * offscreen.html) até alguém parar — aqui na janelinha, no clique da
 * notificação ou no app ("Parar o alarme", que também cala o celular).
 */
const PAGINA_DO_ALARME = "offscreen.html";

async function alarmeTocando() {
  const docs = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
  return docs.length > 0;
}

async function tocarAlarmePc() {
  if (await alarmeTocando()) return;
  try {
    await chrome.offscreen.createDocument({
      url: PAGINA_DO_ALARME, reasons: ["AUDIO_PLAYBACK"], justification: "Alarme: abriu data na agenda do Full.",
    });
  } catch { /* já existe (duas voltas ao mesmo tempo) */ }
}

export async function pararAlarmePc() {
  if (await alarmeTocando()) await chrome.offscreen.closeDocument().catch(() => {});
}

/** Parar daqui também cala o celular (o app marca o alarme como parado). */
async function silenciarTudo() {
  await pararAlarmePc();
  const { endereco, estados } = await config();
  const { alarmeParado = {} } = await chrome.storage.local.get("alarmeParado");
  for (const [id, estado] of Object.entries(estados)) {
    if (estado !== "datas") continue;
    alarmeParado[id] = true;
    if (endereco) {
      await fetch(endereco, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ silenciar: true, inboundId: id }),
      }).catch(() => {});
    }
  }
  await chrome.storage.local.set({ alarmeParado });
}

/**
 * TESTE COMPLETO: faz tudo o que acontece quando abre data — notificação e
 * alarme aqui no PC e o push crítico no celular (pelo app, mesmo caminho) — sem
 * mexer na vigia de verdade. Só a leitura da página do ML fica de fora.
 */
async function simularVaga() {
  const { endereco } = await config();
  if (!endereco) return { ok: false, texto: "Salve o endereço da vigia primeiro." };
  notificar("teste", "TESTE · Abriu data no Full", "Simulação. Se o PC está bipando e o celular tocou, está tudo funcionando. Clique pra parar.");
  await tocarAlarmePc();
  try {
    const r = await fetch(endereco, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teste: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, texto: "O app não aceitou o teste (endereço vencido?). O alarme do PC funcionou." };
    return { ok: true, texto: j.enviados ? `PC bipando. Push mandado pra ${j.enviados} aparelho(s): confira o celular.` : "PC bipando, mas nenhum celular com notificação ligada no app." };
  } catch {
    return { ok: false, texto: "Sem conexão com o app. O alarme do PC funcionou." };
  }
}

async function contarAoApp(endereco, id, estado, trecho) {
  try {
    await fetch(endereco, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboundId: String(id), estado, trecho: String(trecho || "").slice(0, 300) }),
    });
  } catch { /* sem rede: na próxima volta tenta de novo */ }
}

export async function conferir() {
  const { endereco, estados } = await config();
  if (!endereco) return { ok: false, motivo: "sem_endereco" };

  let ids = [];
  let silenciados = [];
  try {
    const r = await fetch(endereco, { cache: "no-store" });
    if (r.status === 401) {
      await chrome.storage.local.set({ ultimo: { em: Date.now(), erro: "O endereço da vigia não vale mais. No app (aba Full), copie o endereço do cartão, cole aqui e Salvar." } });
      return { ok: false, motivo: "codigo_invalido" };
    }
    const j = await r.json();
    ids = j.ids || [];
    silenciados = (j.silenciados || []).map(String);
  } catch {
    await chrome.storage.local.set({ ultimo: { em: Date.now(), erro: "Sem conexão com o app." } });
    return { ok: false, motivo: "sem_rede" };
  }

  const linhas = [];
  for (const id of ids.slice(0, 5)) {
    let leitura = { estado: "indefinido", tipos: [], datas: [], trecho: "" };
    try {
      leitura = await lerEnvio(id);
    } catch { /* rede: indefinido */ }

    const antes = estados[id];
    if (leitura.estado === "datas" && antes !== "datas") {
      const quando = leitura.datas.length ? ` Datas: ${leitura.datas.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)).join(", ")}.` : "";
      notificar(id, `Agenda do Full liberada · envio #${id}`, `Tem horário livre pra agendar.${quando} Abra o Mercado Livre e agende já.`);
    }
    if (leitura.estado === "login" && antes !== "login") {
      notificar(id, "Vigia do Full: entre no Mercado Livre", "Este Chrome saiu da conta do ML. Entre de novo pra vigia continuar.");
    }
    // Toda volta conta ao app: o cartão mostra a MESMA hora da extensão (e, com data, o celular toca de novo).
    await contarAoApp(endereco, id, leitura.estado, leitura.trecho);
    estados[id] = leitura.estado;
    linhas.push({ id, estado: leitura.estado });
  }

  const algumaData = linhas.some((l) => l.estado === "datas");

  // Alarme do PC: toca enquanto houver data que ninguém parou (aqui ou no app).
  const { alarmeParado = {} } = await chrome.storage.local.get("alarmeParado");
  for (const l of linhas) if (l.estado !== "datas") delete alarmeParado[l.id]; // fechou: a próxima abertura toca de novo
  for (const id of silenciados) alarmeParado[id] = true;
  await chrome.storage.local.set({ alarmeParado });
  const deveTocar = linhas.some((l) => l.estado === "datas" && !alarmeParado[l.id]);
  if (deveTocar) await tocarAlarmePc(); else await pararAlarmePc();

  // Sinal de vida: tudo conferido e ainda sem data → "ainda sem data" no celular, uma vez por hora.
  const { pulso = true, ultimoPulso = 0 } = await chrome.storage.local.get(["pulso", "ultimoPulso"]);
  const semData = linhas.filter((l) => l.estado === "sem_datas").map((l) => String(l.id));
  if (pulso && !algumaData && semData.length > 0 && horaDe(Date.now()) !== horaDe(ultimoPulso)) {
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
  const periodo = algumaData ? MINUTOS_COM_DATA : MINUTOS;
  await agendar(periodo);
  await chrome.storage.local.set({ estados, ultimo: { em: Date.now(), linhas, periodo } });
  return { ok: true, linhas };
}

/**
 * Abriu a página de agendamento de um envio neste Chrome e ele está sem data:
 * passa a vigiar sozinho (não precisa digitar o número no app).
 */
const PAGINA_DO_ENVIO = /^https:\/\/vendedores\.mercadolivre\.com\.br\/shipping\/inbounds\/(\d{5,15})\/appointment/;
const vistosAgora = new Set();

/**
 * Passa a vigiar um envio. Pela aba aberta (automático) ou pelo campo da
 * janelinha (`manual`, que responde o que aconteceu com cada número).
 */
async function vigiarEnvio(id, { manual = false } = {}) {
  if (!manual) {
    if (vistosAgora.has(id)) return { ok: false };
    vistosAgora.add(id);
    setTimeout(() => vistosAgora.delete(id), 60_000);
  }
  const { endereco, estados } = await config();
  if (!endereco) return { ok: false, texto: "Salve o endereço da vigia primeiro." };
  try {
    const lista = await fetch(endereco, { cache: "no-store" });
    if (!lista.ok) return { ok: false, texto: "O endereço da vigia não vale mais: copie o do app e Salvar." };
    if (((await lista.json()).ids || []).includes(id)) return { ok: true, texto: `#${id}: já está sendo vigiado.` };
    const leitura = await lerEnvio(id);
    if (leitura.estado === "datas") return { ok: false, texto: `#${id}: JÁ TEM DATA na coleta do seu endereço — agende agora no ML.` };
    if (leitura.estado === "login") return { ok: false, texto: `#${id}: entre no Mercado Livre neste Chrome e tente de novo.` };
    if (leitura.trecho === ESCOLHA_O_ENDERECO) return { ok: false, texto: `#${id}: marque primeiro o endereço da coleta aqui embaixo.` };
    if (leitura.estado !== "sem_datas") return { ok: false, texto: `#${id}: não consegui ler esse envio no ML. Confira o número e tente de novo.` };
    const resp = await fetch(endereco, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboundId: id, estado: "sem_datas", trecho: "", novo: true }),
    });
    if (resp.status === 409) {
      if (!manual) notificar(id, "Vigia do Full: limite de 5 envios", `Pare um envio no app (aba Full) pra vigiar o #${id}.`);
      return { ok: false, texto: `#${id}: já são 5 envios vigiados. Pare um no app (aba Full).` };
    }
    if (!resp.ok) return { ok: false, texto: `#${id}: o app recusou. Tente de novo.` };
    estados[id] = "sem_datas";
    await chrome.storage.local.set({ estados });
    if (!manual) notificar(id, `Vigiando o envio #${id}`, "Está sem data. Quando o ML abrir agenda, chega o aviso aqui e no celular.");
    return { ok: true, texto: `#${id}: vigiando.` };
  } catch {
    vistosAgora.delete(id);
    return { ok: false, texto: `#${id}: sem conexão. Tente de novo.` };
  }
}

async function vigiarSeEstiverSemData(id) {
  const r = await vigiarEnvio(id);
  if (r.ok && r.texto && r.texto.endsWith("vigiando.")) conferir();
}

/** O campo da janelinha: vários números de uma vez ("80517703, 80517704 80517705"). */
async function vigiarVarios(texto) {
  const ids = [...new Set(String(texto || "").match(/\d{5,15}/g) || [])].slice(0, 5);
  if (ids.length === 0) return { linhas: ["Digite o número do envio (ex.: 80517703)."] };
  const linhas = [];
  for (const id of ids) linhas.push((await vigiarEnvio(id, { manual: true })).texto);
  await conferir();
  return { linhas };
}

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status !== "complete") return;
  const m = PAGINA_DO_ENVIO.exec(tab.url || "");
  if (m) vigiarSeEstiverSemData(m[1]);
});

/**
 * Marca a PRÓXIMA volta no próximo horário redondo (horario.js). É um alarme de
 * uma vez só, remarcado a cada volta: um alarme repetido do Chrome vai
 * escorregando uns segundos e sai do horário redondo.
 */
async function agendar(periodo = MINUTOS) {
  await chrome.alarms.create(ALARME, { when: proximoHorario(periodo) });
}

chrome.runtime.onInstalled.addListener(() => agendar());
chrome.runtime.onStartup.addListener(() => agendar());
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARME) return;
  await agendar(); // já deixa a próxima marcada (se a volta falhar no meio, a vigia não para)
  conferir();
});
chrome.notifications.onClicked.addListener((nid) => {
  silenciarTudo();
  const id = String(nid).split("-")[1];
  if (/^\d+$/.test(id)) chrome.tabs.create({ url: `${ML}${id}/appointment-v2` });
});
// A janelinha pede "conferir agora".
chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (msg && msg.tipo === "conferir") { conferir().then(responder); return true; }
  if (msg && msg.tipo === "simular") { simularVaga().then(responder); return true; }
  if (msg && msg.tipo === "vigiar") { vigiarVarios(msg.texto).then(responder); return true; }
  if (msg && msg.tipo === "parar_alarme") { silenciarTudo().then(() => responder({ ok: true })); return true; }
  if (msg && msg.tipo === "proxima") { chrome.alarms.get(ALARME).then((a) => responder({ em: a ? a.scheduledTime : 0 })); return true; }
  if (msg && msg.tipo === "alarme_tocando") { alarmeTocando().then((t) => responder({ tocando: t })); return true; }
  return false;
});
