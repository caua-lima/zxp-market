import { describe, expect, it } from "vitest";
import { escolherJanela, juntarParametro, validarDeepLink } from "./deep-link";

const ORIGEM = "https://briefing-master.vercel.app";

/**
 * O Service Worker leva estas funções pelo TEXTO (`toString`). Cada teste roda a
 * versão reconstruída a partir do texto — se uma função dependesse de algo do
 * módulo, funcionaria como import e quebraria no aparelho, e o teste pegaria.
 */
const daTexto = <T extends (...a: never[]) => unknown>(fn: T): T => new Function(`return (${fn.toString()})`)() as T;

const validar = daTexto(validarDeepLink);
const juntar = daTexto(juntarParametro);
const escolher = daTexto(escolherJanela);

describe("validarDeepLink — só rotas do app, da mesma origem", () => {
  it("os links que o app gera passam", () => {
    expect(validar("/?tab=pedidos&order=2000123456", ORIGEM)).toBe("/?tab=pedidos&order=2000123456");
    expect(validar("/?tab=tarefas&task=t1", ORIGEM)).toBe("/?tab=tarefas&task=t1");
    expect(validar("/?tab=desempenho", ORIGEM)).toBe("/?tab=desempenho");
    expect(validar("/", ORIGEM)).toBe("/");
  });

  it("o formato novo (?item=&tipo=) também", () => {
    expect(validar("/?tab=pedidos&item=2000123456&tipo=pedido", ORIGEM)).toBe("/?tab=pedidos&item=2000123456&tipo=pedido");
  });

  it("outra ORIGEM vira '/' — nunca abre um site de fora", () => {
    for (const ruim of ["https://evil.example/?tab=pedidos", "//evil.example/x", "https://briefing-master.vercel.app.evil.example/", "http://briefing-master.vercel.app/"]) {
      expect(validar(ruim, ORIGEM), ruim).toBe("/");
    }
  });

  it("esquemas perigosos viram '/'", () => {
    for (const ruim of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "blob:https://x/y"]) {
      expect(validar(ruim, ORIGEM), ruim).toBe("/");
    }
  });

  it("caminho que o app não tem vira '/'", () => {
    for (const ruim of ["/admin", "/api/push/test", "/../../etc", "/pedidos/123", "/firebase-messaging-sw.js"]) {
      expect(validar(ruim, ORIGEM), ruim).toBe("/");
    }
  });

  it("parâmetro desconhecido é descartado, o conhecido fica", () => {
    expect(validar("/?tab=pedidos&order=1&utm=x&redirect=https://evil.example", ORIGEM)).toBe("/?tab=pedidos&order=1");
  });

  it("valor fora do formato é descartado (não navega com lixo)", () => {
    expect(validar("/?tab=<script>&order=1", ORIGEM)).toBe("/?order=1");
    expect(validar("/?order=" + "x".repeat(100), ORIGEM)).toBe("/");
    expect(validar("/?tab=PEDIDOS", ORIGEM)).toBe("/"); // aba é minúscula
  });

  it("o fragmento é descartado", () => {
    expect(validar("/?tab=pedidos#tokenroubado", ORIGEM)).toBe("/?tab=pedidos");
  });

  it("nada, vazio ou tipo estranho: '/'", () => {
    for (const v of [undefined, null, "", 0, {}, []]) expect(validar(v, ORIGEM)).toBe("/");
  });

  it("o eventId do clique passa com o formato dos ids do app", () => {
    expect(validar("/?tab=pedidos&ev=sale_paid:2000123456", ORIGEM)).toBe("/?tab=pedidos&ev=sale_paid%3A2000123456");
    expect(validar("/?ev=task_assigned:t1:1700000000000", ORIGEM)).toContain("ev=task_assigned%3At1%3A1700000000000");
  });

  it("origem inválida não lança", () => {
    expect(() => validar("/?tab=x", "isto-nao-e-uma-url")).not.toThrow();
    expect(validar("/?tab=x", "isto-nao-e-uma-url")).toBe("/");
  });
});

describe("juntarParametro", () => {
  it("acrescenta a um endereço com parâmetros", () => {
    expect(juntar("/?tab=pedidos", "ev", "e1")).toBe("/?tab=pedidos&ev=e1");
  });
  it("acrescenta a um endereço sem parâmetros", () => {
    expect(juntar("/", "ev", "e1")).toBe("/?ev=e1");
  });
  it("substitui a chave que já existe em vez de duplicar", () => {
    expect(juntar("/?ev=velho&tab=x", "ev", "novo")).toBe("/?tab=x&ev=novo");
  });
  it("codifica o valor", () => {
    expect(juntar("/", "ev", "a:b@c.d")).toBe("/?ev=a%3Ab%40c.d");
  });
});

describe("escolherJanela — a que a pessoa está olhando", () => {
  it("prefere a janela em FOCO", () => {
    expect(escolher([{ focused: false, visibilityState: "visible" }, { focused: true, visibilityState: "visible" }])).toBe(1);
  });

  it("sem foco, uma VISÍVEL — não uma aba esquecida em segundo plano", () => {
    expect(escolher([{ focused: false, visibilityState: "hidden" }, { focused: false, visibilityState: "visible" }])).toBe(1);
  });

  it("todas escondidas: a primeira", () => {
    expect(escolher([{ visibilityState: "hidden" }, { visibilityState: "hidden" }])).toBe(0);
  });

  it("nenhuma janela (app fechado): -1 — quem chama abre uma nova", () => {
    expect(escolher([])).toBe(-1);
  });

  it("múltiplas abas: escolhe UMA só", () => {
    const abas = Array.from({ length: 5 }, () => ({ focused: false, visibilityState: "hidden" }));
    abas[3] = { focused: true, visibilityState: "visible" };
    expect(escolher(abas)).toBe(3);
  });
});
