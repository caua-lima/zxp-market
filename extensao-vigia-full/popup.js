const ROTULO = { datas: "DATA LIBERADA — agende já", sem_datas: "sem data", login: "entre no ML neste Chrome", indefinido: "não deu pra ler" };
const $ = (id) => document.getElementById(id);

function mostrar(ultimo) {
  const lista = $("lista");
  lista.textContent = "";
  if (!ultimo) { $("quando").textContent = "Ainda não conferiu."; return; }
  if (ultimo.erro) { $("msg").textContent = ultimo.erro; $("msg").className = "erro"; }
  for (const l of ultimo.linhas || []) {
    const li = document.createElement("li");
    const a = document.createElement("span");
    a.textContent = `#${l.id}`;
    const b = document.createElement("span");
    b.textContent = ROTULO[l.estado] || l.estado;
    b.className = l.estado;
    li.append(a, b);
    lista.append(li);
  }
  if (ultimo.linhas && ultimo.linhas.length === 0) { $("quando").textContent = "Nenhum envio vigiado no app (aba Full)."; return; }
  $("quando").textContent = `conferido às ${relogio(ultimo.em)}`;
  mostrarProxima();
}

const relogio = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

async function mostrarProxima() {
  const r = await chrome.runtime.sendMessage({ tipo: "proxima" }).catch(() => null);
  if (r && r.em) $("quando").textContent = `${$("quando").textContent.split(" · ")[0]} · próxima às ${relogio(r.em)}`;
}

// A janelinha aberta acompanha cada conferência (antes ficava com a hora de quando abriu).
chrome.storage.onChanged.addListener((mudou, area) => {
  if (area === "local" && mudou.ultimo) { $("msg").textContent = ""; mostrar(mudou.ultimo.newValue); }
});

async function iniciar() {
  const { endereco = "", ultimo = null, pulso = true } = await chrome.storage.local.get(["endereco", "ultimo", "pulso"]);
  $("endereco").value = endereco;
  $("pulso").checked = pulso;
  mostrar(ultimo);
}

$("salvar").addEventListener("click", async () => {
  const valor = $("endereco").value.trim();
  let url;
  try { url = new URL(valor); } catch { url = null; }
  if (!url || url.protocol !== "https:" || !url.pathname.endsWith("/api/widget/vigias") || !url.searchParams.get("t")) {
    $("msg").textContent = "Cole o endereço da vigia que o app mostra (aba Full).";
    $("msg").className = "erro";
    return;
  }
  // A extensão só fala com o SEU app: pede permissão pra este endereço e nenhum outro.
  const ok = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
  if (!ok) { $("msg").textContent = "Sem a permissão a extensão não consegue falar com o app."; $("msg").className = "erro"; return; }
  await chrome.storage.local.set({ endereco: url.toString(), estados: {} });
  $("msg").textContent = "Salvo. Conferindo…";
  $("msg").className = "mudo";
  const r = await chrome.runtime.sendMessage({ tipo: "conferir" });
  $("msg").textContent = r && r.ok ? "Vigia ligada." : "Salvo, mas a primeira conferência falhou — veja abaixo.";
  mostrar((await chrome.storage.local.get("ultimo")).ultimo);
});

$("agora").addEventListener("click", async () => {
  $("msg").textContent = "Conferindo…";
  $("msg").className = "mudo";
  await chrome.runtime.sendMessage({ tipo: "conferir" });
  $("msg").textContent = "";
  mostrar((await chrome.storage.local.get("ultimo")).ultimo);
});

$("pulso").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ pulso: e.target.checked, ultimoPulso: 0 });
});

async function mostrarAlarme() {
  const r = await chrome.runtime.sendMessage({ tipo: "alarme_tocando" }).catch(() => null);
  $("pararAlarme").hidden = !(r && r.tocando);
}
$("pararAlarme").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ tipo: "parar_alarme" });
  $("pararAlarme").hidden = true;
  $("msg").textContent = "Alarme parado (aqui e no celular).";
  $("msg").className = "mudo";
});

iniciar();
mostrarAlarme();
