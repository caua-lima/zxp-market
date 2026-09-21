import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO,
  ajustarLimite,
  chegou,
  dispensar,
  estadoInicial,
  limpar,
  passar,
  pausar,
  prioridadeDoTipo,
  proximoPrazo,
  retomar,
  type ConfigDeToasts,
  type EstadoDeToasts,
  type NovoToast,
} from "./toast-fila";

const T0 = 1_800_000_000_000;
type D = { titulo: string };

const novo = (id: string, over: Partial<NovoToast<D>> = {}): NovoToast<D> => ({
  id, tag: `tag-${id}`, dados: { titulo: id }, prioridade: 0, duracaoMs: 8000, ...over,
});

function chegadas(ids: string[], inicio = T0, passoMs = 100, cfg = CONFIG_PADRAO, over: (i: number) => Partial<NovoToast<D>> = () => ({})) {
  let e: EstadoDeToasts<D> = estadoInicial<D>();
  ids.forEach((id, i) => { e = chegou(e, novo(id, over(i)), inicio + i * passoMs, cfg); });
  return e;
}

describe("chegada e limite de visíveis", () => {
  it("os três primeiros aparecem; o resto espera", () => {
    const e = chegadas(["a", "b", "c", "d", "e"]);
    expect(e.visiveis.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(e.fila.map((t) => t.id)).toEqual(["d", "e"]);
  });

  it("no celular (1 visível) sobra um contador: fila com o resto", () => {
    const e = chegadas(["a", "b", "c"], T0, 100, { ...CONFIG_PADRAO, maxVisiveis: 1 });
    expect(e.visiveis).toHaveLength(1);
    expect(e.fila).toHaveLength(2);
  });

  it("o prazo só começa a correr quando o toast fica VISÍVEL, não quando chega", () => {
    const e = chegadas(["a", "b", "c", "d"]);
    expect(e.fila[0].expiraEm).toBeNull();
    const depois = dispensar(e, "a", T0 + 5000);
    const d = depois.visiveis.find((t) => t.id === "d")!;
    expect(d.expiraEm).toBe(T0 + 5000 + 8000);
  });
});

describe("prazos INDIVIDUAIS — chegar um novo não reinicia os que já estão na tela", () => {
  it("o prazo de um toast visível não muda quando outros chegam", () => {
    let e = chegou(estadoInicial<D>(), novo("a"), T0);
    const prazoA = e.visiveis[0].expiraEm;
    e = chegou(e, novo("b"), T0 + 3000);
    e = chegou(e, novo("c"), T0 + 6000);
    expect(e.visiveis.find((t) => t.id === "a")!.expiraEm).toBe(prazoA);
  });

  it("cada um fecha no SEU momento, não todos juntos", () => {
    let e = chegou(estadoInicial<D>(), novo("a"), T0);
    e = chegou(e, novo("b"), T0 + 4000);
    e = passar(e, T0 + 8000);
    expect(e.visiveis.map((t) => t.id)).toEqual(["b"]);
    e = passar(e, T0 + 12_000);
    expect(e.visiveis).toEqual([]);
  });

  it("proximoPrazo aponta o MENOR prazo (um único temporizador)", () => {
    let e = chegou(estadoInicial<D>(), novo("a", { duracaoMs: 8000 }), T0);
    e = chegou(e, novo("b", { duracaoMs: 15_000 }), T0 + 1000);
    expect(proximoPrazo(e)).toBe(T0 + 8000);
  });

  it("nada em curso: sem prazo agendado", () => {
    expect(proximoPrazo(estadoInicial<D>())).toBeNull();
  });
});

describe("pausa por mouse/foco", () => {
  it("pausar congela SÓ aquele toast; o outro continua correndo", () => {
    let e = chegou(estadoInicial<D>(), novo("a"), T0);
    e = chegou(e, novo("b"), T0);
    e = pausar(e, "a", T0 + 3000);
    e = passar(e, T0 + 20_000);
    expect(e.visiveis.map((t) => t.id)).toEqual(["a"]); // b venceu; a continua na tela
  });

  it("retomar devolve o tempo que RESTAVA, não a duração cheia", () => {
    let e = chegou(estadoInicial<D>(), novo("a", { duracaoMs: 8000 }), T0);
    e = pausar(e, "a", T0 + 3000); // restam 5000
    expect(e.visiveis[0].restanteMs).toBe(5000);
    e = retomar(e, "a", T0 + 60_000);
    expect(e.visiveis[0].expiraEm).toBe(T0 + 65_000);
  });

  it("pausado não entra em proximoPrazo", () => {
    let e = chegou(estadoInicial<D>(), novo("a"), T0);
    e = pausar(e, "a", T0 + 1000);
    expect(proximoPrazo(e)).toBeNull();
  });

  it("pausar duas vezes seguidas não perde o tempo restante", () => {
    let e = chegou(estadoInicial<D>(), novo("a", { duracaoMs: 8000 }), T0);
    e = pausar(e, "a", T0 + 3000);
    e = pausar(e, "a", T0 + 9000);
    expect(e.visiveis[0].restanteMs).toBe(5000);
  });

  it("retomar um toast que não estava pausado não muda nada", () => {
    const e = chegou(estadoInicial<D>(), novo("a"), T0);
    expect(retomar(e, "a", T0 + 100)).toEqual(e);
  });
});

describe("prioridade e fila com teto", () => {
  it("o prejuízo passa na frente das vendas comuns que esperam", () => {
    let e = chegadas(["v1", "v2", "v3", "v4", "v5"]);
    e = chegou(e, novo("prejuizo", { prioridade: prioridadeDoTipo("sale_negative_margin") }), T0 + 1000);
    e = dispensar(e, "v1", T0 + 2000);
    expect(e.visiveis.map((t) => t.id)).toContain("prejuizo");
    expect(e.visiveis.map((t) => t.id)).not.toContain("v4");
  });

  it("entre iguais, ordem de chegada", () => {
    let e = chegadas(["a", "b", "c", "d", "e"]);
    e = dispensar(e, "a", T0 + 1);
    expect(e.visiveis.map((t) => t.id)).toEqual(["b", "c", "d"]);
  });

  it("RAJADA DE 100 EVENTOS: a fila NUNCA passa do teto e a tela nunca passa do limite", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `e${i}`);
    const e = chegadas(ids);
    expect(e.visiveis.length).toBeLessThanOrEqual(CONFIG_PADRAO.maxVisiveis);
    expect(e.fila.length).toBeLessThanOrEqual(CONFIG_PADRAO.maxFila);
    expect(Object.keys(e.vistos).length).toBeLessThanOrEqual(CONFIG_PADRAO.maxVistos);
  });

  it("na rajada, o que é descartado é o MENOS urgente — o prejuízo no meio dela sobrevive", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `e${i}`);
    const e = chegadas(ids, T0, 10, CONFIG_PADRAO, (i) => (i === 30 ? { prioridade: 3 } : {}));
    const todos = [...e.visiveis, ...e.fila].map((t) => t.id);
    expect(todos).toContain("e30");
  });

  it("aba parada: o que esperou além do TTL na fila é descartado (segue na Central)", () => {
    const e = chegadas(["a", "b", "c", "d", "e"]);
    const depois = passar(e, T0 + CONFIG_PADRAO.ttlNaFilaMs + 5000);
    expect(depois.fila).toEqual([]);
  });

  it("aba parada por uma hora: nenhum toast velho aparece de uma vez ao voltar", () => {
    const e = chegadas(Array.from({ length: 30 }, (_, i) => `e${i}`));
    const volta = passar(e, T0 + 3600_000);
    expect(volta.visiveis).toEqual([]);
    expect(volta.fila).toEqual([]);
  });
});

describe("dedupe com retenção limitada", () => {
  it("o mesmo id duas vezes vira um toast só", () => {
    let e = chegou(estadoInicial<D>(), novo("a", { tag: "" }), T0);
    e = chegou(e, novo("a", { tag: "" }), T0 + 100);
    expect(e.visiveis).toHaveLength(1);
  });

  it("depois da retenção o id pode voltar a aparecer", () => {
    let e = chegou(estadoInicial<D>(), novo("a", { tag: "" }), T0);
    e = dispensar(e, "a", T0 + 1);
    e = chegou(e, novo("a", { tag: "" }), T0 + CONFIG_PADRAO.retencaoDeVistosMs + 1);
    expect(e.visiveis).toHaveLength(1);
  });

  it("mesmo dispensado, o id não volta dentro da retenção (o SDK reentrega)", () => {
    let e = chegou(estadoInicial<D>(), novo("a", { tag: "" }), T0);
    e = dispensar(e, "a", T0 + 1);
    e = chegou(e, novo("a", { tag: "" }), T0 + 2000);
    expect(e.visiveis).toHaveLength(0);
  });

  it("o conjunto de ids lembrados tem TETO (antes crescia sem limite)", () => {
    let e = estadoInicial<D>();
    for (let i = 0; i < 1000; i++) e = chegou(e, novo(`e${i}`, { tag: "" }), T0 + i);
    expect(Object.keys(e.vistos).length).toBeLessThanOrEqual(CONFIG_PADRAO.maxVistos);
  });
});

describe("mesma tag substitui em vez de empilhar (resumo de rajada)", () => {
  it("abertura e fechamento do resumo viram UM toast, com o texto novo", () => {
    let e = chegou(estadoInicial<D>(), novo("abertura", { tag: "sales-summary-1", dados: { titulo: "4 vendas" } }), T0);
    e = chegou(e, novo("fechamento", { tag: "sales-summary-1", dados: { titulo: "10 vendas" } }), T0 + 60_000);
    expect(e.visiveis).toHaveLength(1);
    expect(e.visiveis[0].dados.titulo).toBe("10 vendas");
  });

  it("o toast substituído ganha prazo novo (o conteúdo é novo)", () => {
    let e = chegou(estadoInicial<D>(), novo("abertura", { tag: "t" }), T0);
    e = chegou(e, novo("fechamento", { tag: "t" }), T0 + 6000);
    expect(e.visiveis[0].expiraEm).toBe(T0 + 6000 + 8000);
  });

  it("substituir um item que ainda ESPERA na fila também não duplica", () => {
    let e = chegadas(["a", "b", "c"]);
    e = chegou(e, novo("d", { tag: "res", dados: { titulo: "d1" } }), T0 + 1000);
    e = chegou(e, novo("d2", { tag: "res", dados: { titulo: "d2" } }), T0 + 2000);
    expect(e.fila).toHaveLength(1);
    expect(e.fila[0].dados.titulo).toBe("d2");
  });

  it("tags vazias não se substituem entre si", () => {
    let e = chegou(estadoInicial<D>(), novo("a", { tag: "" }), T0);
    e = chegou(e, novo("b", { tag: "" }), T0);
    expect(e.visiveis).toHaveLength(2);
  });
});

describe("pureza — o que o Strict Mode exige", () => {
  it("executar a mesma transição duas vezes dá o MESMO resultado (atualizador reexecutado)", () => {
    const base = chegadas(["a", "b", "c", "d"]);
    const uma = chegou(base, novo("x"), T0 + 500);
    const duas = chegou(base, novo("x"), T0 + 500);
    expect(duas).toEqual(uma);
  });

  it("nenhuma função altera o estado que recebeu", () => {
    const base = chegadas(["a", "b", "c", "d"]);
    const foto = JSON.stringify(base);
    chegou(base, novo("x"), T0 + 1);
    dispensar(base, "a", T0 + 1);
    pausar(base, "a", T0 + 1);
    retomar(base, "a", T0 + 1);
    passar(base, T0 + 60_000);
    ajustarLimite(base, T0 + 1, { ...CONFIG_PADRAO, maxVisiveis: 1 });
    expect(JSON.stringify(base)).toBe(foto);
  });

  it("dispensar duas vezes o mesmo toast não promove dois da fila", () => {
    const base = chegadas(["a", "b", "c", "d", "e"]);
    const uma = dispensar(base, "a", T0 + 1);
    const duas = dispensar(uma, "a", T0 + 1);
    expect(duas.visiveis.map((t) => t.id)).toEqual(uma.visiveis.map((t) => t.id));
    expect(duas.fila.map((t) => t.id)).toEqual(uma.fila.map((t) => t.id));
  });
});

describe("ajustarLimite e troca de conta", () => {
  const cfg1: ConfigDeToasts = { ...CONFIG_PADRAO, maxVisiveis: 1 };

  it("girar pro celular (limite 3 → 1) devolve o excesso pra fila, sem perder ninguém", () => {
    const e = chegadas(["a", "b", "c"]);
    const r = ajustarLimite(e, T0 + 1, cfg1);
    expect(r.visiveis.map((t) => t.id)).toEqual(["a"]);
    expect(r.fila.map((t) => t.id).sort()).toEqual(["b", "c"]);
  });

  it("o toast devolvido à fila não carrega o prazo antigo", () => {
    const e = chegadas(["a", "b", "c"]);
    const r = ajustarLimite(e, T0 + 1, cfg1);
    expect(r.fila.every((t) => t.expiraEm === null)).toBe(true);
  });

  it("limite maior: promove da fila", () => {
    const e = ajustarLimite(chegadas(["a", "b", "c"]), T0, cfg1);
    const r = ajustarLimite(e, T0 + 1, CONFIG_PADRAO);
    expect(r.visiveis).toHaveLength(3);
  });

  it("trocar de conta esvazia tudo — nada da pessoa anterior aparece pra próxima", () => {
    expect(limpar<D>()).toEqual(estadoInicial<D>());
  });
});

describe("prioridadeDoTipo", () => {
  it("prejuízo e cancelamento são os mais urgentes; venda comum a menos", () => {
    expect(prioridadeDoTipo("sale_negative_margin")).toBeGreaterThan(prioridadeDoTipo("sale_paid"));
    expect(prioridadeDoTipo("sale_cancelled")).toBe(3);
    expect(prioridadeDoTipo("sale_paid")).toBe(0);
    expect(prioridadeDoTipo("qualquer_coisa")).toBe(0);
  });
});
