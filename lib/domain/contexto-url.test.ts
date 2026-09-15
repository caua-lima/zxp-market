import { describe, it, expect } from "vitest";
import {
  lerContexto, escreverContexto, ehNavegacao, mesmoContexto, CONTEXTO_VAZIO, sincronizarUrl,
} from "./contexto-url";

const ABAS = ["dashboard", "pedidos", "ads", "dre", "estoque", "tarefas"];

describe("lerContexto", () => {
  it("lê aba, período e filtros", () => {
    const c = lerContexto("?tab=dre&de=2026-09-01&ate=2026-09-30&f=full,semcusto", ABAS);
    expect(c.aba).toBe("dre");
    expect(c.de).toBe("2026-09-01");
    expect(c.ate).toBe("2026-09-30");
    expect(c.filtros).toEqual(["full", "semcusto"]);
  });

  it("aceita a query sem o '?'", () => {
    expect(lerContexto("tab=ads", ABAS).aba).toBe("ads");
  });

  it("aba desconhecida vira null, não quebra o app", () => {
    expect(lerContexto("?tab=coisaqueNaoExiste", ABAS).aba).toBeNull();
  });

  it("data que não é ISO é descartada — melhor o padrão que uma janela inventada", () => {
    const c = lerContexto("?de=ontem&ate=30/09/2026", ABAS);
    expect(c.de).toBeNull();
    expect(c.ate).toBeNull();
  });

  it("URL vazia devolve o contexto vazio", () => {
    expect(lerContexto("", ABAS)).toEqual(CONTEXTO_VAZIO);
  });

  it("filtros com espaço e vazios são limpos", () => {
    expect(lerContexto("?f=a, b ,,c", ABAS).filtros).toEqual(["a", "b", "c"]);
  });

  it("aceita um URLSearchParams direto", () => {
    expect(lerContexto(new URLSearchParams("tab=pedidos"), ABAS).aba).toBe("pedidos");
  });
});

describe("compatibilidade com os links já enviados", () => {
  it("?order= de notificação antiga continua abrindo o pedido", () => {
    const c = lerContexto("?tab=pedidos&order=123", ABAS);
    expect(c.item).toBe("123");
    expect(c.tipoDoItem).toBe("pedido");
  });

  it("?task= de notificação antiga continua abrindo a tarefa", () => {
    const c = lerContexto("?tab=tarefas&task=abc", ABAS);
    expect(c.item).toBe("abc");
    expect(c.tipoDoItem).toBe("tarefa");
  });

  it("o formato novo ganha do antigo quando os dois vêm", () => {
    const c = lerContexto("?item=999&tipo=produto&order=123", ABAS);
    expect(c.item).toBe("999");
    expect(c.tipoDoItem).toBe("produto");
  });

  it("mas escreve sempre no formato novo", () => {
    const c = lerContexto("?tab=pedidos&order=123", ABAS);
    const q = escreverContexto(c, "dashboard");
    expect(q).toContain("item=123");
    expect(q).toContain("tipo=pedido");
    expect(q).not.toContain("order=");
  });
});

describe("escreverContexto", () => {
  it("omite o que é padrão", () => {
    expect(escreverContexto({ ...CONTEXTO_VAZIO, aba: "dashboard" }, "dashboard")).toBe("");
  });

  it("vazio devolve string vazia, não '?'", () => {
    expect(escreverContexto(CONTEXTO_VAZIO, "dashboard")).toBe("");
  });

  it("período só entra inteiro — metade não reconstrói nada", () => {
    expect(escreverContexto({ ...CONTEXTO_VAZIO, de: "2026-09-01" }, "dashboard")).toBe("");
    expect(escreverContexto({ ...CONTEXTO_VAZIO, de: "2026-09-01", ate: "2026-09-30" }, "dashboard"))
      .toContain("de=2026-09-01");
  });

  it("item sem tipo ainda é escrito — o id é o que importa", () => {
    expect(escreverContexto({ ...CONTEXTO_VAZIO, item: "42" }, "dashboard")).toBe("?item=42");
  });

  it("dá a volta: ler o que foi escrito devolve o mesmo contexto", () => {
    const ctx = {
      aba: "dre", de: "2026-09-01", ate: "2026-09-30",
      filtros: ["full", "semcusto"], item: "77", tipoDoItem: "produto",
    };
    expect(lerContexto(escreverContexto(ctx, "dashboard"), ABAS)).toEqual(ctx);
  });
});

describe("ehNavegacao", () => {
  const base = { ...CONTEXTO_VAZIO, aba: "dre" };

  it("trocar de aba é navegar — Voltar tem que voltar pro Dashboard", () => {
    expect(ehNavegacao(base, { ...base, aba: "ads" })).toBe(true);
  });

  it("abrir um item é navegar — fechar com Voltar é o gesto natural no celular", () => {
    expect(ehNavegacao(base, { ...base, item: "12" })).toBe(true);
    expect(ehNavegacao({ ...base, item: "12" }, base)).toBe(true);
  });

  it("mexer em filtro NÃO é navegar — Voltar não é Desfazer", () => {
    expect(ehNavegacao(base, { ...base, filtros: ["full"] })).toBe(false);
  });

  it("trocar o período também não empilha", () => {
    expect(ehNavegacao(base, { ...base, de: "2026-01-01", ate: "2026-01-31" })).toBe(false);
  });
});

describe("mesmoContexto", () => {
  const c = { aba: "dre", de: "2026-09-01", ate: "2026-09-30", filtros: ["a"], item: null, tipoDoItem: null };

  it("igual é igual", () => {
    expect(mesmoContexto(c, { ...c, filtros: ["a"] })).toBe(true);
  });

  it("filtro a mais é diferente", () => {
    expect(mesmoContexto(c, { ...c, filtros: ["a", "b"] })).toBe(false);
  });

  it("ordem de filtro conta — a tela reconstrói na ordem que recebeu", () => {
    expect(mesmoContexto({ ...c, filtros: ["a", "b"] }, { ...c, filtros: ["b", "a"] })).toBe(false);
  });

  it("aba diferente é diferente", () => {
    expect(mesmoContexto(c, { ...c, aba: "ads" })).toBe(false);
  });
});

describe("sincronizarUrl", () => {
  function historicoFalso() {
    const chamadas: { metodo: string; url: string }[] = [];
    return {
      chamadas,
      pushState: (_e: unknown, _t: string, url: string) => chamadas.push({ metodo: "push", url }),
      replaceState: (_e: unknown, _t: string, url: string) => chamadas.push({ metodo: "replace", url }),
    };
  }

  const base = { ...CONTEXTO_VAZIO, aba: "dashboard" };
  const sync = (anterior: typeof base, atual: typeof base) => {
    const h = historicoFalso();
    const r = sincronizarUrl({ historico: h, caminho: "/", anterior, atual, abaPadrao: "dashboard" });
    return { ...r, chamadas: h.chamadas };
  };

  it("trocar de aba EMPILHA — é isso que faz o Voltar voltar pro Dashboard", () => {
    const r = sync(base, { ...base, aba: "dre" });
    expect(r.acao).toBe("empilhou");
    expect(r.chamadas).toEqual([{ metodo: "push", url: "/?tab=dre" }]);
  });

  it("voltar pra aba padrão limpa a query em vez de deixar '?'", () => {
    const r = sync({ ...base, aba: "dre" }, base);
    expect(r.url).toBe("/");
  });

  it("mexer em filtro SUBSTITUI — Voltar não pode virar Desfazer", () => {
    const r = sync(base, { ...base, filtros: ["ruptura"] });
    expect(r.acao).toBe("substituiu");
    expect(r.chamadas[0].metodo).toBe("replace");
  });

  it("período também substitui", () => {
    expect(sync(base, { ...base, de: "2026-09-01", ate: "2026-09-30" }).acao).toBe("substituiu");
  });

  it("abrir item empilha — fechar com Voltar é o gesto do celular", () => {
    const r = sync(base, { ...base, item: "77", tipoDoItem: "pedido" });
    expect(r.acao).toBe("empilhou");
    expect(r.url).toBe("/?item=77&tipo=pedido");
  });

  it("nada mudou, nada é escrito — senão o Voltar precisaria de dois toques", () => {
    const r = sync(base, { ...base });
    expect(r.acao).toBe("nada");
    expect(r.chamadas).toEqual([]);
  });

  it("respeita o caminho atual, não assume a raiz", () => {
    const h = historicoFalso();
    sincronizarUrl({ historico: h, caminho: "/app", anterior: base, atual: { ...base, aba: "ads" }, abaPadrao: "dashboard" });
    expect(h.chamadas[0].url).toBe("/app?tab=ads");
  });

  it("o que foi escrito é relido igual — a ida e a volta fecham", () => {
    const atual = { aba: "estoque", de: "2026-08-01", ate: "2026-08-31", filtros: ["ruptura", "semcusto"], item: "P1", tipoDoItem: "produto" };
    const r = sync(base, atual);
    expect(lerContexto(r.url.slice(r.url.indexOf("?")), ABAS)).toEqual(atual);
  });
});
