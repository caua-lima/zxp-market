import { describe, expect, it } from "vitest";
import { RECORDES_VAZIOS, avaliarRecordes, semear, type Recordes } from "./recordes";

const base = (): Recordes => ({
  melhorDia: { dia: "2026-08-07", valor: 3_480 },
  melhorMes: { mes: "2026-08", valor: 28_618 },
  maisPedidosNumDia: { dia: "2026-08-07", quantidade: 41 },
  primeiraVezMensal: { "10000": "2026-06", "20000": "2026-07" },
});

describe("melhor dia da história", () => {
  it("dia maior que o recorde vira marco, com o número que foi superado", () => {
    const { novos, marcos } = avaliarRecordes(base(), {
      dias: [{ dia: "2026-09-09", valor: 4_100 }],
      mes: "2026-09", faturamentoMes: 11_331,
    });
    expect(novos.melhorDia).toEqual({ dia: "2026-09-09", valor: 4_100 });
    const m = marcos.find((x) => x.chave === "recorde_dia:2026-09-09")!;
    expect(m.titulo).toMatch(/Melhor dia/);
    // A metade boa da notícia é o que foi batido.
    expect(m.corpo).toMatch(/3\.480,00/);
    expect(m.corpo).toMatch(/07\/08/);
  });

  it("dia menor não mexe em nada", () => {
    const { novos, marcos } = avaliarRecordes(base(), {
      dias: [{ dia: "2026-09-09", valor: 900 }],
      mes: "2026-09", faturamentoMes: 11_331,
    });
    expect(novos.melhorDia).toEqual({ dia: "2026-08-07", valor: 3_480 });
    expect(marcos.filter((m) => m.chave.startsWith("recorde_dia"))).toHaveLength(0);
  });

  it("sem recorde anterior, registra mas NÃO comemora", () => {
    /**
     * "Melhor dia da história" no primeiro dia medido é frase vazia — e seria
     * o que sairia em toda instalação nova.
     */
    const { novos, marcos } = avaliarRecordes(RECORDES_VAZIOS, {
      dias: [{ dia: "2026-09-09", valor: 4_100 }],
      mes: "2026-09", faturamentoMes: 11_331,
    });
    expect(novos.melhorDia).toEqual({ dia: "2026-09-09", valor: 4_100 });
    expect(marcos.filter((m) => m.chave.startsWith("recorde_dia"))).toHaveLength(0);
  });

  it("a chave leva o dia — anuncia uma vez, não a cada verificação", () => {
    const { marcos } = avaliarRecordes(base(), {
      dias: [{ dia: "2026-09-09", valor: 4_100 }],
      mes: "2026-09", faturamentoMes: 11_331,
    });
    expect(marcos.some((m) => m.chave === "recorde_dia:2026-09-09")).toBe(true);
  });
});

describe("mais pedidos num dia", () => {
  it("supera a contagem e diz qual era", () => {
    const { novos, marcos } = avaliarRecordes(base(), {
      dias: [{ dia: "2026-09-09", valor: 2_000, pedidos: 55 }],
      mes: "2026-09", faturamentoMes: 11_331,
    });
    expect(novos.maisPedidosNumDia).toEqual({ dia: "2026-09-09", quantidade: 55 });
    expect(marcos.find((m) => m.chave === "recorde_pedidos:2026-09-09")!.corpo).toMatch(/41/);
  });

  it("sem contagem de pedidos, o recorde antigo fica de pé", () => {
    const { novos } = avaliarRecordes(base(), {
      dias: [{ dia: "2026-09-09", valor: 9_999 }],
      mes: "2026-09", faturamentoMes: 11_331,
    });
    expect(novos.maisPedidosNumDia).toEqual({ dia: "2026-08-07", quantidade: 41 });
  });
});

describe("melhor mês da história", () => {
  it("mês novo que supera o recorde vira marco", () => {
    const { novos, marcos } = avaliarRecordes(base(), {
      dias: [], mes: "2026-09", faturamentoMes: 30_000,
    });
    expect(novos.melhorMes).toEqual({ mes: "2026-09", valor: 30_000 });
    expect(marcos.find((m) => m.chave === "recorde_mes:2026-09")!.corpo).toMatch(/agosto/);
  });

  it("o próprio mês recordista crescendo NÃO gera marco novo", () => {
    /**
     * Setembro já é o melhor mês; cada venda a mais não é uma conquista nova,
     * é o mesmo mês continuando. Sem isso, viria um aviso por sync.
     */
    const atual = { ...base(), melhorMes: { mes: "2026-09", valor: 30_000 } };
    const { novos, marcos } = avaliarRecordes(atual, {
      dias: [], mes: "2026-09", faturamentoMes: 31_500,
    });
    expect(novos.melhorMes).toEqual({ mes: "2026-09", valor: 31_500 });
    expect(marcos.filter((m) => m.chave.startsWith("recorde_mes"))).toHaveLength(0);
  });

  it("mês abaixo do recorde não mexe em nada", () => {
    const { novos, marcos } = avaliarRecordes(base(), {
      dias: [], mes: "2026-09", faturamentoMes: 11_331,
    });
    expect(novos.melhorMes).toEqual({ mes: "2026-08", valor: 28_618 });
    expect(marcos.filter((m) => m.chave.startsWith("recorde_mes"))).toHaveLength(0);
  });
});

describe("primeira vez em cada degrau histórico", () => {
  it("30 mil inédito vira marco de primeira vez", () => {
    const { novos, marcos } = avaliarRecordes(base(), {
      dias: [], mes: "2026-09", faturamentoMes: 31_000,
    });
    expect(novos.primeiraVezMensal["30000"]).toBe("2026-09");
    const m = marcos.find((x) => x.chave === "primeira_vez:30000")!;
    expect(m.titulo).toMatch(/Primeira vez/);
    expect(m.corpo).toMatch(/setembro/);
  });

  it("degrau já batido antes não repete nunca mais", () => {
    const { marcos } = avaliarRecordes(base(), {
      dias: [], mes: "2026-09", faturamentoMes: 25_000,
    });
    // 10k e 20k já constam em primeiraVezMensal.
    expect(marcos.filter((m) => m.chave.startsWith("primeira_vez"))).toHaveLength(0);
  });

  it("salto grande dispara todos os degraus inéditos de uma vez", () => {
    const { marcos } = avaliarRecordes(base(), {
      dias: [], mes: "2026-09", faturamentoMes: 55_000,
    });
    const chaves = marcos.filter((m) => m.chave.startsWith("primeira_vez")).map((m) => m.chave);
    expect(chaves).toEqual([
      "primeira_vez:30000", "primeira_vez:40000", "primeira_vez:50000",
    ]);
  });
});

describe("semear", () => {
  it("registra o passado sem comemorar nada", () => {
    const r = semear(
      {
        dias: [
          { dia: "2026-08-07", valor: 3_480, pedidos: 41 },
          { dia: "2026-08-08", valor: 1_200, pedidos: 18 },
        ],
        mes: "2026-09", faturamentoMes: 11_331,
      },
      [{ mes: "2026-07", valor: 22_000 }, { mes: "2026-08", valor: 28_618 }],
    );
    expect(r.melhorDia).toEqual({ dia: "2026-08-07", valor: 3_480 });
    expect(r.maisPedidosNumDia).toEqual({ dia: "2026-08-07", quantidade: 41 });
    expect(r.melhorMes).toEqual({ mes: "2026-08", valor: 28_618 });
  });

  it("a primeira vez de um degrau é o mês MAIS ANTIGO que o bateu", () => {
    const r = semear({ dias: [], mes: "2026-09", faturamentoMes: 11_331 }, [
      { mes: "2026-08", valor: 28_618 },
      { mes: "2026-06", valor: 21_000 },
    ]);
    expect(r.primeiraVezMensal["10000"]).toBe("2026-06");
    expect(r.primeiraVezMensal["20000"]).toBe("2026-06");
    expect(r.primeiraVezMensal["30000"]).toBeUndefined();
  });

  it("semeado, a próxima avaliação não gera marco do que já era conhecido", () => {
    const r = semear({ dias: [{ dia: "2026-08-07", valor: 3_480 }], mes: "2026-08", faturamentoMes: 28_618 });
    const { marcos } = avaliarRecordes(r, {
      dias: [{ dia: "2026-08-07", valor: 3_480 }], mes: "2026-08", faturamentoMes: 28_618,
    });
    expect(marcos).toEqual([]);
  });
});

describe("o selo do MercadoLíder fecha todo recorde", () => {
  it("entra na mensagem e muda com o nível", () => {
    const gold = avaliarRecordes(base(), {
      dias: [{ dia: "2026-09-09", valor: 4_100 }], mes: "2026-09", faturamentoMes: 11_331,
    }, "gold").marcos[0];
    expect(gold.corpo).toMatch(/MercadoLíder Gold/);

    const sem = avaliarRecordes(base(), {
      dias: [{ dia: "2026-09-09", valor: 4_100 }], mes: "2026-09", faturamentoMes: 11_331,
    }, null).marcos[0];
    expect(sem.corpo).toMatch(/Rumo ao MercadoLíder/);
  });
});
