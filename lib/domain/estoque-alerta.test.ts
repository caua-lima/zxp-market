import { describe, expect, it } from "vitest";
import {
  ESTOQUE_MINIMO_PADRAO,
  detectarEstoqueBaixo,
  diasDeCobertura,
  type ProdutoEstoque,
} from "./estoque-alerta";

function prod(over: Partial<ProdutoEstoque> = {}): ProdutoEstoque {
  return { id: "p1", nome: "Menta Stronger", full: 100, casa: 0, ...over };
}
const nenhum = new Set<string>();

describe("detectarEstoqueBaixo — avisa na travessia, não no estado", () => {
  it("avisa quando chega exatamente no mínimo de 25", () => {
    const r = detectarEstoqueBaixo([prod({ full: 25 })], nenhum);
    expect(r.avisar).toHaveLength(1);
    expect(r.avisar[0].total).toBe(25);
  });

  it("não avisa acima do mínimo", () => {
    expect(detectarEstoqueBaixo([prod({ full: 26 })], nenhum).avisar).toEqual([]);
  });

  it("NÃO repete o aviso enquanto continua baixo — é o que evita o push a cada 15min", () => {
    const jaAvisado = new Set(["p1"]);
    const r = detectarEstoqueBaixo([prod({ full: 20 })], jaAvisado);
    expect(r.avisar).toEqual([]);
  });

  it("depois de repor, volta a ficar elegível", () => {
    const jaAvisado = new Set(["p1"]);
    const r = detectarEstoqueBaixo([prod({ full: 200 })], jaAvisado);
    expect(r.rearmar).toEqual(["p1"]);
    expect(r.avisar).toEqual([]);
  });

  it("repôs e caiu de novo: avisa outra vez (ciclo completo)", () => {
    const jaAvisado = new Set(["p1"]);
    // 1) repôs → rearma
    expect(detectarEstoqueBaixo([prod({ full: 200 })], jaAvisado).rearmar).toEqual(["p1"]);
    // 2) com o estado limpo, cair de novo avisa
    expect(detectarEstoqueBaixo([prod({ full: 10 })], nenhum).avisar).toHaveLength(1);
  });

  it("não rearma quem nunca foi avisado", () => {
    expect(detectarEstoqueBaixo([prod({ full: 500 })], nenhum).rearmar).toEqual([]);
  });
});

describe("detectarEstoqueBaixo — soma Full + casa", () => {
  it("Full baixo mas com estoque em casa NÃO dispara", () => {
    // 10 no Full + 300 em casa = não precisa comprar nada.
    expect(detectarEstoqueBaixo([prod({ full: 10, casa: 300 })], nenhum).avisar).toEqual([]);
  });

  it("a soma é o que conta pro limite", () => {
    const r = detectarEstoqueBaixo([prod({ full: 15, casa: 5 })], nenhum);
    expect(r.avisar[0].total).toBe(20);
  });

  it("quantidade negativa não vira crédito", () => {
    const r = detectarEstoqueBaixo([prod({ full: -5, casa: 20 })], nenhum);
    expect(r.avisar[0].total).toBe(20);
  });
});

describe("detectarEstoqueBaixo — texto do aviso", () => {
  it("zerado tem tratamento próprio", () => {
    const r = detectarEstoqueBaixo([prod({ full: 0, casa: 0 })], nenhum);
    expect(r.avisar[0].titulo).toMatch(/ZEROU/);
  });

  it("cita os dias de cobertura quando há média de venda", () => {
    const r = detectarEstoqueBaixo([prod({ full: 20, mediaDiaria: 4 })], nenhum);
    expect(r.avisar[0].diasRestantes).toBe(5);
    expect(r.avisar[0].corpo).toMatch(/5 dia/);
  });

  it("sem média de venda NÃO inventa prazo", () => {
    const r = detectarEstoqueBaixo([prod({ full: 20, mediaDiaria: null })], nenhum);
    expect(r.avisar[0].diasRestantes).toBeNull();
    expect(r.avisar[0].corpo).not.toMatch(/dia/);
  });

  it("a chave é estável — é ela que garante um push só", () => {
    const a = detectarEstoqueBaixo([prod({ full: 20 })], nenhum).avisar[0];
    const b = detectarEstoqueBaixo([prod({ full: 18 })], nenhum).avisar[0];
    expect(a.chave).toBe(b.chave);
  });
});

describe("detectarEstoqueBaixo — limite por produto e ordem", () => {
  it("produto com mínimo próprio usa o dele", () => {
    expect(detectarEstoqueBaixo([prod({ full: 40, minimo: 50 })], nenhum).avisar).toHaveLength(1);
    expect(detectarEstoqueBaixo([prod({ full: 40, minimo: 10 })], nenhum).avisar).toEqual([]);
  });

  it("o padrão é 25", () => {
    expect(ESTOQUE_MINIMO_PADRAO).toBe(25);
  });

  it("mais crítico primeiro", () => {
    const r = detectarEstoqueBaixo(
      [prod({ id: "a", full: 20 }), prod({ id: "b", full: 0 }), prod({ id: "c", full: 10 })],
      nenhum,
    );
    expect(r.avisar.map((x) => x.produtoId)).toEqual(["b", "c", "a"]);
  });

  it("produto sem id é ignorado — não dá pra deduplicar sem chave", () => {
    expect(detectarEstoqueBaixo([prod({ id: "", full: 0 })], nenhum).avisar).toEqual([]);
  });
});

describe("diasDeCobertura", () => {
  it("arredonda pra baixo — 3,9 dias é 3", () => {
    expect(diasDeCobertura(39, 10)).toBe(3);
  });

  it("sem média não estima", () => {
    expect(diasDeCobertura(100, 0)).toBeNull();
    expect(diasDeCobertura(100, null)).toBeNull();
  });
});
