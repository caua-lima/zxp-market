// Service Worker do Firebase Messaging, servido em /firebase-messaging-sw.js
// (é o caminho padrão que o SDK espera). Gerado dinamicamente porque o
// Service Worker não lê variáveis de ambiente do Next em runtime — só assim
// dá pra reaproveitar o mesmo código em projetos com Firebase diferente
// (este app roda em mais de um deploy, cada um com seu próprio Firebase).
import { CACHE_DO_LOG_DE_PUSH, CHAVE_DO_LOG_DE_PUSH, SW_VERSAO } from "@/lib/push-sw-versao";
import { escolherJanela, juntarParametro, validarDeepLink } from "@/lib/domain/deep-link";

export const dynamic = "force-static";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function GET() {
  const body = `
/**
 * ─── ESTE SERVICE WORKER ASSUME NA HORA, SEM ESPERAR ────────────────────
 *
 * Sem skipWaiting/claim, um Service Worker novo baixado num deploy fica em
 * estado "waiting": o navegador o instala e o deixa PARADO, enquanto o
 * ANTIGO continua tratando os pushes. Ele só troca quando todas as janelas
 * do app fecham — e num PWA instalado no celular, que fica vivo em segundo
 * plano, isso pode não acontecer por dias.
 *
 * O efeito prático era o pior possível pra diagnosticar: a correção era
 * publicada, o app atualizava a tela normalmente (a página é servida pela
 * rede), e o push continuava passando pelo código velho e quebrado. Parecia
 * que o conserto não tinha funcionado.
 *
 * skipWaiting ativa o novo imediatamente; clients.claim faz ele assumir as
 * janelas que já estão abertas, sem exigir que o usuário feche o app.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Marca de versão — o diagnóstico pergunta isto ao Service Worker ativo pra
 * provar QUAL código está tratando os pushes. Sem isso, "já publiquei a
 * correção" e "a correção está rodando" eram indistinguíveis.
 */
const SW_VERSAO = ${JSON.stringify(SW_VERSAO)};
self.addEventListener("message", (event) => {
  if (event.data && event.data.tipo === "versao" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ versao: SW_VERSAO });
  }
});

/**
 * As regras de PRA ONDE ir e QUAL janela usar (lib/domain/deep-link.ts). Vêm do
 * mesmo código que os testes exercitam — o texto das funções é incorporado aqui,
 * então o que roda no aparelho é o que foi testado.
 */
const validarDeepLink = ${validarDeepLink.toString()};
const juntarParametro = ${juntarParametro.toString()};
const escolherJanela = ${escolherJanela.toString()};

/**
 * O registro do que este aparelho RECEBEU, no Cache API (a página e o Service
 * Worker enxergam o mesmo cache). É o único jeito de o app saber que o push
 * chegou e foi exibido: o servidor só sabe que o Firebase aceitou. O diagnóstico
 * e o botão "Testar" leem daqui.
 */
async function registrarRecebimento(registro) {
  try {
    const cache = await caches.open(${JSON.stringify(CACHE_DO_LOG_DE_PUSH)});
    const atual = await cache.match(${JSON.stringify(CHAVE_DO_LOG_DE_PUSH)});
    let lista = [];
    if (atual) { try { lista = await atual.json(); } catch (e) { lista = []; } }
    lista.unshift(registro);
    await cache.put(
      ${JSON.stringify(CHAVE_DO_LOG_DE_PUSH)},
      new Response(JSON.stringify(lista.slice(0, 10)), { headers: { "Content-Type": "application/json" } }),
    );
  } catch (e) { /* sem cache: o push já foi exibido, o registro é só diagnóstico */ }
}

/**
 * ─── A EXIBIÇÃO VEM PRIMEIRO, E SEM DEPENDER DE REDE ────────────────────
 *
 * Este handler é registrado ANTES de qualquer importScripts, de propósito.
 *
 * Antes, o arquivo começava importando o SDK do Firebase de um CDN
 * (gstatic.com) e só então registrava \`onBackgroundMessage\`. Se aquele
 * download falhasse — rede ruim no celular, CDN bloqueado, o Service Worker
 * acordando offline pra tratar o push — o script inteiro lançava e NENHUM
 * handler chegava a existir. Resultado exato do que foi relatado: a
 * notificação aparecia dentro do app (que usa o SDK da PÁGINA, carregado
 * junto com ela) e nunca na barra do sistema.
 *
 * O evento "push" é da própria plataforma; não precisa de Firebase nenhum
 * pra ser tratado. Registrando aqui em cima, a notificação da barra passa a
 * ser a parte MAIS confiável da cadeia em vez da mais frágil.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let d = {};
  try {
    const json = event.data.json();
    // O envio manda tudo em "data" (ver lib/notification-outbox.ts); o fallback cobre
    // qualquer mensagem que chegue no formato "notification".
    d = json.data || json.notification || json || {};
  } catch {
    try { d = { title: "Novo aviso", body: event.data.text() }; } catch { d = {}; }
  }

  // Sem título, "Novo aviso": o antigo "Nova venda!" chamava de venda uma tarefa, um marco e um teste.
  const title = d.title || "Novo aviso";
  const recebidoEm = Date.now();
  const options = {
    body: d.body || "",
    icon: d.icon || "/manifest-icon-192",
    badge: d.badge || "/manifest-icon-192",
    // A "tag" faz o sistema SUBSTITUIR um aviso já existente do mesmo pedido
    // em vez de empilhar outro — rede de segurança contra push duplicado.
    tag: d.tag || undefined,
    renotify: false,
    /**
     * A notificação FICA na barra até o usuário tocar. Venda é dinheiro: um
     * aviso que some sozinho enquanto o celular está no bolso é um aviso que
     * não aconteceu.
     */
    requireInteraction: true,
    // O clique não recebe o payload de novo, só este objeto: leva o destino e o
    // eventId (que liga o clique ao aviso, pro recibo de clique).
    data: { deepLink: d.deepLink || "/", eventId: d.eventId || "", tipo: d.type || "" },
  };

  /**
   * Mostra SEMPRE, inclusive com o app aberto.
   *
   * Antes a barra era pulada quando havia aba visível, porque o toast dentro
   * do app já avisava. Só que o toast some sozinho e não deixa registro: com
   * o celular na mão mas a tela em outra aba, ou com o app aberto e o
   * aparelho no bolso, a venda passava sem deixar rastro nenhum. O \`tag\`
   * garante que isso nunca vira duas notificações empilhadas pro mesmo pedido.
   */
  event.waitUntil((async () => {
    let erro = null;
    try {
      await self.registration.showNotification(title, options);
    } catch (e) {
      erro = String((e && e.name) || "erro");
    }
    await registrarRecebimento({
      eventId: d.eventId || "", tipo: d.type || "", recebidoEm,
      exibidoEm: erro ? null : Date.now(), erro,
    });
  })());
});

/**
 * ─── O CLIQUE ───────────────────────────────────────────────────────────
 *
 * Três decisões, e nenhuma delas é "navegar a primeira janela pro que veio":
 *
 *  1. PRA ONDE: o endereço passa por validarDeepLink — só a raiz do app, da mesma
 *     origem, com parâmetros conhecidos.
 *  2. QUAL JANELA: a que a pessoa está olhando (foco, depois visível), e UMA só —
 *     com várias abas, as outras ficam quietas.
 *  3. COMO: com o app aberto, NÃO se chama client.navigate() — ele recarrega a
 *     página e destrói um formulário em edição. O Service Worker entrega uma
 *     mensagem ao app, que decide (e, com uma janela de edição aberta, pergunta).
 *     Com o app fechado, abre uma janela já no destino, levando o eventId no
 *     endereço pra o app registrar o clique quando carregar.
 *
 * O clique é registrado pelo APP (que tem a sessão), não pelo Service Worker, e é
 * um recibo separado de "lido": tocar na notificação não a marca como lida na
 * Central, nem o contrário.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const dados = event.notification.data || {};
  const alvo = validarDeepLink(dados.deepLink, self.location.origin);
  const eventId = String(dados.eventId || "");

  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const i = escolherJanela(janelas);
    if (i >= 0) {
      const janela = janelas[i];
      try { await janela.focus(); } catch (e) { /* focar pode ser recusado; a mensagem ainda vale */ }
      janela.postMessage({ tipo: "abrir", deepLink: alvo, eventId });
      return;
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(eventId ? juntarParametro(alvo, "ev", eventId) : alvo);
    }
  })());
});

/**
 * ─── FIREBASE VEM POR ÚLTIMO, E NÃO PODE DERRUBAR NADA ──────────────────
 *
 * O SDK só é necessário para UMA coisa aqui: repassar a mensagem pra página
 * quando o app está aberto, que é o que alimenta o toast interno
 * (onMessage em lib/firebase/push.ts). A notificação da barra já foi tratada
 * acima, sem depender dele.
 *
 * O try/catch é o ponto central: importScripts busca na rede, e Service
 * Worker roda em momentos em que a rede não está garantida — acordando pra
 * tratar um push com o celular em conexão ruim, por exemplo. Sem a proteção,
 * essa falha lançava no topo do arquivo e o Service Worker inteiro morria,
 * levando junto o handler de push que nem precisava do Firebase.
 *
 * NÃO registramos onBackgroundMessage: quem mostra a notificação é o handler
 * nativo acima, sempre. Registrar os dois exibiria o mesmo aviso duas vezes.
 */
try {
  importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js");
  firebase.initializeApp(${JSON.stringify(firebaseConfig)});
  firebase.messaging();
} catch (e) {
  // Sem o SDK, o app aberto deixa de receber o toast interno — a notificação
  // da barra, que é a que importa com o celular no bolso, segue funcionando.
}
`.trim();

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      // Sem isto o SW registrado a partir da rota fica limitado ao escopo
      // implícito do caminho — que já é "/" por ele estar na raiz, mas o
      // header deixa explícito e evita surpresa em algum navegador mais estrito.
      "Service-Worker-Allowed": "/",
    },
  });
}
