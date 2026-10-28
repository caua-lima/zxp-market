/**
 * O script "Vigia Full" pro app gratuito Scriptable, no iPhone.
 *
 * Por que no iPhone: o ML só mostra a agenda do Full pra quem está LOGADO no
 * navegador — o token do app é recusado (403, medido em 28/10/2026; ver
 * lib/domain/agenda-full.ts). A pessoa entra no ML uma vez dentro do Scriptable;
 * a cada vez que o widget roda, o script abre a página de agendamento de cada
 * envio vigiado (a lista vem do app, aba Full) e lê se apareceu data.
 *
 * Abriu data: notificação no iPhone na hora, e o servidor é avisado
 * (`POST /api/widget/vigias`), que manda o push pros outros aparelhos e marca no
 * cartão. Nada da conta do ML sai do celular: o login fica no Scriptable.
 */
export function scriptDaVigiaFull(base: string, token: string): string {
  const url = JSON.stringify(`${base}/api/widget/vigias?t=${token}`);
  return `// Vigia Full — avisa quando o Mercado Livre abrir data pra agendar envio pro Full.
// Gerado pelo app (aba Full). Não compartilhe: o endereço abaixo é só seu.
const API = ${url};
const fm = FileManager.local();
const ARQ = fm.joinPath(fm.documentsDirectory(), "vigia-full.json");

function lerMemoria() {
  try { return fm.fileExists(ARQ) ? JSON.parse(fm.readString(ARQ)) : {}; } catch (e) { return {}; }
}
function gravarMemoria(m) { try { fm.writeString(ARQ, JSON.stringify(m)); } catch (e) {} }

// O que a página de agendamento diz. Roda DENTRO da página do ML.
const LEITURA = "(() => { try {" +
  " const href = location.href;" +
  " if (/login|identification|authorization/i.test(href)) return JSON.stringify({ estado: 'login' });" +
  " const txt = document.body ? document.body.innerText : '';" +
  " if (/N[aã]o temos datas dispon[ií]veis/i.test(txt)) return JSON.stringify({ estado: 'sem_datas' });" +
  " let d = null; try { d = window._n.ctx.r.appProps.pageProps.data; } catch (e) {}" +
  " if (!d && !/agend/i.test(txt)) return JSON.stringify({ estado: 'indefinido', trecho: txt.slice(0, 200) });" +
  " return JSON.stringify({ estado: 'datas', trecho: txt.slice(0, 300) });" +
  " } catch (e) { return JSON.stringify({ estado: 'indefinido', trecho: String(e).slice(0, 120) }); } })()";

async function lerEnvio(id) {
  const wv = new WebView();
  await wv.loadURL("https://vendedores.mercadolivre.com.br/shipping/inbounds/" + id + "/appointment-v2");
  try { await wv.waitForLoad(); } catch (e) {}
  // A página termina de montar depois do load: uma folga curta.
  // Com useCallback, o Scriptable espera a página chamar completion().
  try { await wv.evaluateJavaScript("setTimeout(() => completion(1), 2500)", true); } catch (e) {}
  try { return JSON.parse(await wv.evaluateJavaScript(LEITURA)); } catch (e) { return { estado: "indefinido" }; }
}

async function entrarNoML() {
  const wv = new WebView();
  await wv.loadURL("https://vendedores.mercadolivre.com.br/shipping/inbounds");
  await wv.present(true);
}

async function avisarServidor(id, r) {
  try {
    const req = new Request(API);
    req.method = "POST";
    req.headers = { "Content-Type": "application/json" };
    req.body = JSON.stringify({ inboundId: id, estado: r.estado, trecho: r.trecho || "" });
    req.timeoutInterval = 15;
    await req.loadJSON();
  } catch (e) {}
}

function notificar(titulo, corpo) {
  const n = new Notification();
  n.title = titulo;
  n.body = corpo;
  n.sound = "alert";
  n.openURL = "https://vendedores.mercadolivre.com.br/shipping/inbounds";
  n.schedule();
}

async function rodar() {
  const mem = lerMemoria();
  let ids = [];
  try {
    const req = new Request(API);
    req.timeoutInterval = 15;
    const j = await req.loadJSON();
    ids = Array.isArray(j.ids) ? j.ids : [];
    mem.ids = ids;
  } catch (e) {
    ids = Array.isArray(mem.ids) ? mem.ids : [];
  }
  const estados = mem.estados || {};
  const linhas = [];
  for (const id of ids.slice(0, 5)) {
    let r = await lerEnvio(id);
    if (r.estado === "login" && !config.runsInWidget) {
      await entrarNoML();
      r = await lerEnvio(id);
    }
    const antes = estados[id];
    if (r.estado === "datas" && antes !== "datas") {
      notificar("Agenda do Full liberada · envio #" + id, "Abriu data pra agendar. Abra o Mercado Livre e agende já.");
    }
    if (r.estado === "login" && antes !== "login") {
      notificar("Vigia Full: entre no Mercado Livre", "Abra o Scriptable e rode o script Vigia Full pra fazer login.");
    }
    if (r.estado !== antes || r.estado === "datas") await avisarServidor(id, r);
    estados[id] = r.estado;
    linhas.push({ id, estado: r.estado });
  }
  mem.estados = estados;
  mem.em = Date.now();
  gravarMemoria(mem);
  return linhas;
}

const ROTULO = { datas: "DATA LIBERADA", sem_datas: "sem data", login: "entrar no ML", indefinido: "não deu pra ler" };

async function widget(linhas) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#15150f");
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  w.url = "https://vendedores.mercadolivre.com.br/shipping/inbounds";
  const t = w.addText("Vigia Full");
  t.font = Font.boldSystemFont(13);
  t.textColor = new Color("#F4B942");
  if (linhas.length === 0) {
    const v = w.addText("Nenhum envio vigiado (aba Full do app).");
    v.font = Font.systemFont(11);
    v.textColor = new Color("#B9B5A6");
  }
  for (const l of linhas) {
    const x = w.addText("#" + l.id + " · " + (ROTULO[l.estado] || l.estado));
    x.font = l.estado === "datas" ? Font.heavySystemFont(13) : Font.systemFont(12);
    x.textColor = new Color(l.estado === "datas" ? "#36B37E" : l.estado === "login" ? "#EC7B69" : "#FBF8EE");
  }
  w.addSpacer();
  const h = w.addText("conferido " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  h.font = Font.systemFont(10);
  h.textColor = new Color("#8f8c7d");
  return w;
}

const linhas = await rodar();
const w = await widget(linhas);
if (config.runsInWidget) Script.setWidget(w);
else await w.presentSmall();
Script.complete();
`;
}
