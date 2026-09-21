import { beforeEach, describe, expect, it } from "vitest";
import vm from "node:vm";
import { GET } from "@/app/firebase-messaging-sw.js/route";
import { SW_VERSAO } from "@/lib/push-sw-versao";

/**
 * O Service Worker GERADO, executado num sandbox.
 *
 * O Service Worker é um texto montado por template — o único jeito de saber que
 * o que vai pro aparelho funciona é executá-lo. Aqui o texto que a rota devolve
 * (com as funções de lib/domain/deep-link incorporadas por `toString`) roda com um
 * `self`, um cache e janelas simulados, e o teste confere o que o clique e o push
 * fazem de fato. Não substitui o teste em aparelho real (exibição, foco de janela e
 * economia de bateria são do sistema operacional), mas pega o que quebraria o
 * script inteiro: um erro de sintaxe, uma função que dependia do módulo.
 */

const ORIGEM = "https://briefing-master.vercel.app";

type Ouvinte = (e: unknown) => void;
type JanelaSimulada = {
  nome: string; focused: boolean; visibilityState: string;
  focus: () => Promise<void>; postMessage: (m: unknown) => void; navigate: () => never;
};

function montar() {
  const ouvintes: Record<string, Ouvinte[]> = {};
  const cache = new Map<string, string>();
  const postadas: { janela: string; m: Record<string, unknown> }[] = [];
  const abertas: string[] = [];
  const exibidas: { titulo: string; opcoes: Record<string, unknown> }[] = [];
  const focadas: string[] = [];
  let janelas: JanelaSimulada[] = [];

  const self = {
    location: { origin: ORIGEM },
    addEventListener: (tipo: string, fn: Ouvinte) => { (ouvintes[tipo] ??= []).push(fn); },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => janelas,
      openWindow: async (url: string) => { abertas.push(url); },
    },
    registration: {
      showNotification: async (titulo: string, opcoes: Record<string, unknown>) => { exibidas.push({ titulo, opcoes }); },
    },
  };
  const caches = {
    open: async () => ({
      match: async (k: string) => (cache.has(k) ? { json: async () => JSON.parse(cache.get(k)!) } : undefined),
      put: async (k: string, r: { text: () => Promise<string> }) => { cache.set(k, await r.text()); },
    }),
  };

  return {
    self, caches, ouvintes, cache, postadas, abertas, exibidas, focadas,
    janela(nome: string, opc: { focused?: boolean; visible?: boolean } = {}): JanelaSimulada {
      return {
        nome, focused: !!opc.focused, visibilityState: opc.visible ? "visible" : "hidden",
        focus: async () => { focadas.push(nome); },
        postMessage: (m) => postadas.push({ janela: nome, m: m as Record<string, unknown> }),
        navigate: () => { throw new Error("client.navigate() não pode ser chamado: recarrega a página e destrói formulário em edição"); },
      };
    },
    definirJanelas: (j: JanelaSimulada[]) => { janelas = j; },
  };
}

let sw: ReturnType<typeof montar>;

async function carregar() {
  const corpo = await GET().text();
  sw = montar();
  const contexto = vm.createContext({
    self: sw.self, caches: sw.caches, URL, Response, JSON, Date, String, Promise, console,
    // A falha de rede do importScripts NÃO pode derrubar o script (era o defeito original do SW).
    importScripts: () => { throw new Error("rede indisponível"); },
    firebase: undefined,
  });
  vm.runInContext(corpo, contexto);
}

async function receberPush(dados: Record<string, string>) {
  let pendente: Promise<unknown> = Promise.resolve();
  sw.ouvintes.push[0]({ data: { json: () => ({ data: dados }), text: () => "" }, waitUntil: (p: Promise<unknown>) => { pendente = p; } });
  await pendente;
}

async function clicar(deepLink: string, eventId = "e1") {
  let pendente: Promise<unknown> = Promise.resolve();
  sw.ouvintes.notificationclick[0]({ notification: { close: () => {}, data: { deepLink, eventId } }, waitUntil: (p: Promise<unknown>) => { pendente = p; } });
  await pendente;
}

beforeEach(carregar);

describe("o script gerado carrega e registra os handlers", () => {
  it("push, clique e mensagem — mesmo com o importScripts do Firebase falhando", () => {
    expect(sw.ouvintes.push).toHaveLength(1);
    expect(sw.ouvintes.notificationclick).toHaveLength(1);
    expect(sw.ouvintes.message).toHaveLength(1);
  });

  it("responde a versão publicada", () => {
    let resposta: { versao?: string } | null = null;
    sw.ouvintes.message[0]({ data: { tipo: "versao" }, ports: [{ postMessage: (m: { versao: string }) => { resposta = m; } }] });
    expect(resposta).toEqual({ versao: SW_VERSAO });
  });
});

describe("push", () => {
  it("exibe, leva o eventId no dado nativo e REGISTRA o recebimento", async () => {
    await receberPush({ eventId: "sale_paid:1", type: "sale_paid", title: "Nova venda confirmada", body: "Menta", tag: "sale-1", deepLink: "/?tab=pedidos&order=1" });
    expect(sw.exibidas).toHaveLength(1);
    expect(sw.exibidas[0].titulo).toBe("Nova venda confirmada");
    expect((sw.exibidas[0].opcoes.data as { eventId: string }).eventId).toBe("sale_paid:1");
    const log = JSON.parse(sw.cache.get("/__push-log")!);
    expect(log[0]).toMatchObject({ eventId: "sale_paid:1", tipo: "sale_paid", erro: null });
    expect(log[0].exibidoEm).toBeGreaterThan(0);
  });

  it("sem título: 'Novo aviso' — não 'Nova venda!'", async () => {
    await receberPush({ eventId: "x", body: "corpo" });
    expect(sw.exibidas[0].titulo).toBe("Novo aviso");
  });

  it("falha ao exibir fica registrada com o erro, sem derrubar o handler", async () => {
    sw.self.registration.showNotification = async () => { const e = new Error("x"); e.name = "NotAllowedError"; throw e; };
    await receberPush({ eventId: "falha", title: "t" });
    const log = JSON.parse(sw.cache.get("/__push-log")!);
    expect(log[0]).toMatchObject({ eventId: "falha", erro: "NotAllowedError", exibidoEm: null });
  });

  it("o registro guarda só os 10 mais recentes", async () => {
    for (let i = 0; i < 15; i++) await receberPush({ eventId: `e${i}`, title: "t" });
    const log = JSON.parse(sw.cache.get("/__push-log")!);
    expect(log).toHaveLength(10);
    expect(log[0].eventId).toBe("e14");
  });
});

describe("clique", () => {
  it("com várias abas: foca a que está EM FOCO, avisa UMA só e nunca chama navigate()", async () => {
    sw.definirJanelas([sw.janela("velha"), sw.janela("atual", { focused: true, visible: true }), sw.janela("outra")]);
    await clicar("/?tab=pedidos&order=2000123456", "sale_paid:2000123456");
    expect(sw.focadas).toEqual(["atual"]);
    expect(sw.postadas).toHaveLength(1);
    expect(sw.postadas[0]).toEqual({ janela: "atual", m: { tipo: "abrir", deepLink: "/?tab=pedidos&order=2000123456", eventId: "sale_paid:2000123456" } });
  });

  it("sem nenhuma em foco, a VISÍVEL — não uma aba esquecida em segundo plano", async () => {
    sw.definirJanelas([sw.janela("esquecida"), sw.janela("olhando", { visible: true })]);
    await clicar("/?tab=tarefas&task=t1");
    expect(sw.postadas[0].janela).toBe("olhando");
  });

  it("origem estranha e esquema perigoso viram '/'", async () => {
    sw.definirJanelas([sw.janela("a", { focused: true, visible: true })]);
    await clicar("https://evil.example/roubar");
    await clicar("javascript:alert(1)");
    await clicar("//evil.example/x");
    expect(sw.postadas.map((p) => p.m.deepLink)).toEqual(["/", "/", "/"]);
  });

  it("rota que o app não tem vira '/'", async () => {
    sw.definirJanelas([sw.janela("a", { focused: true, visible: true })]);
    await clicar("/api/push/test");
    expect(sw.postadas[0].m.deepLink).toBe("/");
  });

  it("app FECHADO: abre uma janela já no destino, com o eventId no endereço pra registrar o clique", async () => {
    sw.definirJanelas([]);
    await clicar("/?tab=tarefas&task=t1", "task_assigned:t1:1");
    expect(sw.abertas).toEqual(["/?tab=tarefas&task=t1&ev=task_assigned%3At1%3A1"]);
  });

  it("app fechado e link estranho: abre a raiz", async () => {
    sw.definirJanelas([]);
    await clicar("https://evil.example/", "");
    expect(sw.abertas).toEqual(["/"]);
  });

  it("focar recusado não impede a mensagem", async () => {
    const j = sw.janela("a", { focused: true, visible: true });
    j.focus = async () => { throw new Error("recusado"); };
    sw.definirJanelas([j]);
    await clicar("/?tab=pedidos&order=1", "e");
    expect(sw.postadas).toHaveLength(1);
  });
});
