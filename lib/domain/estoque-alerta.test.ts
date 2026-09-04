import { describe, expect, it } from "vitest";
import {
  ESTOQUE_MINIMO_PADRAO,
  detectarEstoqueBaixo,
  diasDeCobertura,
  type ProdutoEstoque,
} from "./estoque-alerta";

function prod(over: Partial<ProdutoEstoque> = {}): ProdutoEstoque {
  return { id: "p1", nome: "Menta Stronger", full: 100, casa: 0, ehFull: true, ...over };
}
const nenhum = new Set<string>();

describe("detectarEstoqueBaixo — o gatilho é o Full, não o total", () => {
  it("avisa quando o Full chega exatamente em 25", () => {
    const r = detectarEstoqueBaixo([prod({ full: 25 })], nenhum);
    expect(r.avisar).toHaveLength(1);
    expect(r.avisar[0].full).toBe(25);
  });

  it("não avisa com o Full acima do mínimo", () => {
    expect(detectarEstoqueBaixo([prod({ full: 26 })], nenhum).avisar).toEqual([]);
  });

  it("estoque em casa NÃO segura o aviso — é ele que permite a coleta", () => {
    // O ponto do módulo: 300 em casa é o motivo pra agendar coleta, não pra
    // silenciar. Somar os dois esconderia o aviso justo quando dá pra agir.
    const r = detectarEstoqueBaixo([prod({ full: 10, casa: 300 })], nenhum);
    expect(r.avisar).toHaveLength(1);
    expect(r.avisar[0].corpo).toMatch(/agende a coleta/i);
    expect(r.avisar[0].casa).toBe(300);
  });

  it("produto FORA do Full nunca gera aviso de coleta", () => {
    expect(detectarEstoqueBaixo([prod({ full: 0, ehFull: false })], nenhum).avisar).toEqual([]);
  });
});

describe("detectarEstoqueBaixo — avisa na travessia, não no estado", () => {
  it("NÃO repete enquanto continua baixo — é o que evita push a cada 15min", () => {
    const r = detectarEstoqueBaixo([prod({ full: 20 })], new Set(["p1"]));
    expect(r.avisar).toEqual([]);
  });

  it("depois da coleta chegar, volta a ficar elegível", () => {
    const r = detectarEstoqueBaixo([prod({ full: 200 })], new Set(["p1"]));
    expect(r.rearmar).toEqual(["p1"]);
    expect(r.avisar).toEqual([]);
  });

  it("reabasteceu e caiu de novo: avisa outra vez (ciclo completo)", () => {
    expect(detectarEstoqueBaixo([prod({ full: 200 })], new Set(["p1"])).rearmar).toEqual(["p1"]);
    expect(detectarEstoqueBaixo([prod({ full: 10 })], nenhum).avisar).toHaveLength(1);
  });

  it("não rearma quem nunca foi avisado", () => {
    expect(detectarEstoqueBaixo([prod({ full: 500 })], nenhum).rearmar).toEqual([]);
  });
});

describe("detectarEstoqueBaixo — a ação depende de ter estoque em casa", () => {
  it("com estoque em casa, manda agendar coleta", () => {
    const r = detectarEstoqueBaixo([prod({ full: 5, casa: 120 })], nenhum);
    expect(r.avisar[0].podeColetar).toBe(true);
    expect(r.avisar[0].corpo).toMatch(/120 un em casa/);
  });

  it("sem estoque em casa, a ação é comprar — não adianta mandar coletar", () => {
    const r = detectarEstoqueBaixo([prod({ full: 5, casa: 0 })], nenhum);
    expect(r.avisar[0].podeColetar).toBe(false);
    expect(r.avisar[0].corpo).toMatch(/precisa comprar/i);
    expect(r.avisar[0].corpo).not.toMatch(/agende a coleta/i);
  });

  it("Full zerado tem tratamento próprio no título", () => {
    const r = detectarEstoqueBaixo([prod({ full: 0, casa: 50 })], nenhum);
    expect(r.avisar[0].titulo).toMatch(/ZEROU no Full/);
  });

  it("quantidade negativa não vira crédito", () => {
    const r = detectarEstoqueBaixo([prod({ full: -5, casa: -3 })], nenhum);
    expect(r.avisar[0].full).toBe(0);
    expect(r.avisar[0].casa).toBe(0);
  });
});

describe("detectarEstoqueBaixo — cobertura e texto", () => {
  it("cita os dias de cobertura do FULL quando há média de venda", () => {
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

/**
 * O gatilho por DIAS, e não por unidades.
 *
 * Números reais desta conta: Menta Stronger vende 7,9/dia e Abacaxi &
 * Hortelã vende 1,5/dia. Pelo limite de 25 unidades, as duas avisariam no
 * mesmo momento — e uma estaria em emergência enquanto a outra tem duas
 * semanas de folga.
 */
describe("cobertura em dias substitui o limite de unidades", () => {
  it("produto de giro RÁPIDO avisa muito antes das 25 unidades", () => {
    // 7,9/dia com 60 un = 7 dias. Pelo critério antigo, 60 > 25: nada.
    const r = detectarEstoqueBaixo([prod({ full: 60, mediaDiaria: 7.9 })], nenhum);
    expect(r.avisar).toHaveLength(1);
    expect(r.avisar[0].diasRestantes).toBe(7);
  });

  it("produto de giro LENTO não avisa nas 25, porque tem folga", () => {
    // 1,5/dia com 22 un = 14 dias. Pelo critério antigo avisaria — ruído.
    const r = detectarEstoqueBaixo([prod({ full: 22, mediaDiaria: 1.5 })], nenhum);
    expect(r.avisar).toEqual([]);
  });

  it("o mesmo giro lento avisa quando os dias caem", () => {
    // 1,5/dia com 12 un = 8 dias, abaixo dos 10.
    const r = detectarEstoqueBaixo([prod({ full: 12, mediaDiaria: 1.5 })], nenhum);
    expect(r.avisar).toHaveLength(1);
    expect(r.avisar[0].diasRestantes).toBe(8);
  });

  it("exatamente no limite de dias avisa", () => {
    // 2/dia com 20 un = 10 dias.
    expect(detectarEstoqueBaixo([prod({ full: 20, mediaDiaria: 2 })], nenhum).avisar).toHaveLength(1);
  });

  it("um dia acima do limite não avisa", () => {
    // 2/dia com 22 un = 11 dias.
    expect(detectarEstoqueBaixo([prod({ full: 22, mediaDiaria: 2 })], nenhum).avisar).toEqual([]);
  });

  it("SEM ritmo conhecido volta pro limite de unidades — é o único sinal que sobra", () => {
    expect(detectarEstoqueBaixo([prod({ full: 25, mediaDiaria: null })], nenhum).avisar).toHaveLength(1);
    expect(detectarEstoqueBaixo([prod({ full: 26, mediaDiaria: null })], nenhum).avisar).toEqual([]);
  });

  it("o limite de dias é configurável", () => {
    const p = [prod({ full: 30, mediaDiaria: 2 })]; // 15 dias
    expect(detectarEstoqueBaixo(p, nenhum, ESTOQUE_MINIMO_PADRAO, 10).avisar).toEqual([]);
    expect(detectarEstoqueBaixo(p, nenhum, ESTOQUE_MINIMO_PADRAO, 20).avisar).toHaveLength(1);
  });

  it("o título leva os DIAS, que é o que diz se é urgente", () => {
    const r = detectarEstoqueBaixo([prod({ full: 20, mediaDiaria: 2 })], nenhum);
    expect(r.avisar[0].titulo).toMatch(/dura 10 dia/);
  });

  it("Full zerado continua com título próprio, mais forte que os dias", () => {
    const r = detectarEstoqueBaixo([prod({ full: 0, mediaDiaria: 2 })], nenhum);
    expect(r.avisar[0].titulo).toMatch(/ZEROU/);
  });

  it("o corpo diz o ritmo — sem isso o número de dias não se explica", () => {
    const r = detectarEstoqueBaixo([prod({ full: 20, mediaDiaria: 2 })], nenhum);
    expect(r.avisar[0].corpo).toMatch(/2\.0\/dia/);
  });

  it("rearma quando volta a ter cobertura, não quando passa das 25 un", () => {
    // 7,9/dia com 100 un = 12 dias: acima do limite, então rearma.
    const r = detectarEstoqueBaixo([prod({ full: 100, mediaDiaria: 7.9 })], new Set(["p1"]));
    expect(r.rearmar).toEqual(["p1"]);
  });
});
