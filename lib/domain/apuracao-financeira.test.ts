import { describe, it, expect } from "vitest";
import {
  coberturaDaConferencia,
  toleranciaDaConferencia,
  lerConferencia,
  pendenciasDaColetaFull,
  pendenciaDeCadastro,
  pendenciaDeProjecao,
  estadoGeral,
  rotuloDoEstado,
  rotuloDoResultado,
  cabecalhoDeExportacao,
  COBERTURA_MINIMA,
} from "./apuracao-financeira";

describe("coberturaDaConferencia", () => {
  it("é a fração do período conferida", () => {
    expect(coberturaDaConferencia(50, 100)).toBe(0.5);
    expect(coberturaDaConferencia(100, 100)).toBe(1);
  });

  it("devolve null sem denominador — e null não é zero", () => {
    expect(coberturaDaConferencia(0, 0)).toBeNull();
    expect(coberturaDaConferencia(5, -1)).toBeNull();
    expect(coberturaDaConferencia(5, NaN)).toBeNull();
  });

  it("não passa de 1 se vierem mais conferidos que o total", () => {
    expect(coberturaDaConferencia(120, 100)).toBe(1);
  });

  it("trata conferidos negativos como zero", () => {
    expect(coberturaDaConferencia(-3, 100)).toBe(0);
  });
});

describe("toleranciaDaConferencia", () => {
  it("é R$ 5 em período pequeno", () => {
    expect(toleranciaDaConferencia(100)).toBe(5);
  });

  it("vira 1% em período grande", () => {
    expect(toleranciaDaConferencia(50000)).toBe(500);
  });

  it("usa o módulo — líquido negativo não zera a tolerância", () => {
    expect(toleranciaDaConferencia(-50000)).toBe(500);
  });
});

describe("lerConferencia", () => {
  const base = { conferidos: 100, total: 100, estimado: 10000, recebido: 10000 };

  it("conciliado quando cobre o período e bate", () => {
    const r = lerConferencia(base);
    expect(r.estado).toBe("conciliado");
    expect(r.podeAfirmarQueBate).toBe(true);
    expect(r.pendencias).toHaveLength(0);
  });

  it("NÃO afirma que bate com 3 de 464 pedidos — era o bug do painel", () => {
    const r = lerConferencia({ conferidos: 3, total: 464, estimado: 300, recebido: 300 });
    expect(r.dentroDaTolerancia).toBe(true);   // nesses 3, bate
    expect(r.podeAfirmarQueBate).toBe(false);  // mas não fala pelo período
    expect(r.estado).toBe("parcial");
    expect(r.pendencias.map((p) => p.chave)).toContain("conferencia-parcial");
  });

  it("estimado quando nada foi conferido", () => {
    const r = lerConferencia({ conferidos: 0, total: 50, estimado: 0, recebido: 0 });
    expect(r.estado).toBe("estimado");
    expect(r.podeAfirmarQueBate).toBe(false);
    expect(r.pendencias[0].chave).toBe("conferencia-sem-dados");
  });

  it("divergência a mais retido é otimista — há custo escapando", () => {
    const r = lerConferencia({ ...base, estimado: 11000, recebido: 10000 });
    expect(r.diferenca).toBe(1000);
    expect(r.dentroDaTolerancia).toBe(false);
    const d = r.pendencias.find((p) => p.chave === "conferencia-divergente");
    expect(d?.efeito).toBe("otimista");
  });

  it("divergência a menos retido é pessimista — dedução contada duas vezes", () => {
    const r = lerConferencia({ ...base, estimado: 9000, recebido: 10000 });
    expect(r.diferenca).toBe(-1000);
    expect(r.pendencias.find((p) => p.chave === "conferencia-divergente")?.efeito).toBe("pessimista");
  });

  it("diferença por pedido é o que dá pra projetar no resto", () => {
    const r = lerConferencia({ conferidos: 10, total: 10, estimado: 1100, recebido: 1000 });
    expect(r.diferencaPorPedido).toBe(10);
  });

  it("não divide por zero sem pedido conferido", () => {
    const r = lerConferencia({ conferidos: 0, total: 10, estimado: 0, recebido: 0 });
    expect(r.diferencaPorPedido).toBe(0);
  });

  it("exatamente na cobertura mínima já fala pelo período", () => {
    const r = lerConferencia({ conferidos: COBERTURA_MINIMA * 100, total: 100, estimado: 100, recebido: 100 });
    expect(r.podeAfirmarQueBate).toBe(true);
  });

  it("cobertura alta mas divergente continua parcial", () => {
    const r = lerConferencia({ conferidos: 100, total: 100, estimado: 12000, recebido: 10000 });
    expect(r.estado).toBe("parcial");
    expect(r.podeAfirmarQueBate).toBe(false);
  });
});

describe("pendenciasDaColetaFull", () => {
  it("fora da janela é otimista — o custo existe e não entrou", () => {
    const [p] = pendenciasDaColetaFull({ foraDaJanela: true, parcial: false, remessas: 0, pendentes: 0 });
    expect(p.chave).toBe("coleta-fora-da-janela");
    expect(p.efeito).toBe("otimista");
  });

  it("parcial diz quantas faltam", () => {
    const [p] = pendenciasDaColetaFull({ foraDaJanela: false, parcial: true, remessas: 8, pendentes: 3 });
    expect(p.titulo).toContain("3 de 8");
    expect(p.efeito).toBe("otimista");
  });

  it("completa não gera pendência", () => {
    expect(pendenciasDaColetaFull({ foraDaJanela: false, parcial: false, remessas: 8, pendentes: 0 })).toHaveLength(0);
  });

  it("fora da janela ganha da parcial — não há o que ser parcial", () => {
    const ps = pendenciasDaColetaFull({ foraDaJanela: true, parcial: true, remessas: 5, pendentes: 5 });
    expect(ps).toHaveLength(1);
    expect(ps[0].chave).toBe("coleta-fora-da-janela");
  });
});

describe("pendenciaDeCadastro", () => {
  it("produto sem custo infla o lucro", () => {
    const [p] = pendenciaDeCadastro(4);
    expect(p.efeito).toBe("otimista");
    expect(p.titulo).toContain("4 produto");
  });

  it("nenhum, nenhuma pendência", () => {
    expect(pendenciaDeCadastro(0)).toHaveLength(0);
    expect(pendenciaDeCadastro(-1)).toHaveLength(0);
  });
});

describe("pendenciaDeProjecao", () => {
  it("período em curso é parcial, não resultado do mês", () => {
    const [p] = pendenciaDeProjecao("2026-09-30", "2026-09-15");
    expect(p.chave).toBe("periodo-em-curso");
    expect(p.efeito).toBe("pessimista");
  });

  it("período encerrado hoje não é projeção", () => {
    expect(pendenciaDeProjecao("2026-09-15", "2026-09-15")).toHaveLength(0);
  });

  it("período passado não é projeção", () => {
    expect(pendenciaDeProjecao("2026-08-31", "2026-09-15")).toHaveLength(0);
  });
});

describe("estadoGeral", () => {
  it("sem pendência, manda o estado da conferência", () => {
    expect(estadoGeral([], "conciliado")).toBe("conciliado");
  });

  it("QUALQUER pendência tira o conciliado — não existe conciliado com ressalva", () => {
    const p = pendenciaDeCadastro(1);
    expect(estadoGeral(p, "conciliado")).toBe("parcial");
  });

  it("sem nenhuma conferência, continua estimado mesmo com pendência", () => {
    expect(estadoGeral(pendenciaDeCadastro(1), "estimado")).toBe("estimado");
  });
});

describe("rótulos", () => {
  it("o nome da linha final muda com o estado", () => {
    expect(rotuloDoResultado("conciliado")).toBe("Resultado da empresa");
    expect(rotuloDoResultado("parcial")).toContain("parcial");
    expect(rotuloDoResultado("estimado")).toContain("estimado");
  });

  it("parcial e estimado não usam eufemismo", () => {
    expect(rotuloDoEstado("parcial")).toContain("falta informação");
    expect(rotuloDoEstado("estimado")).toContain("sem conferência");
  });
});

describe("cabecalhoDeExportacao", () => {
  const ctx = {
    de: "2026-09-01",
    ate: "2026-09-30",
    apuradoEm: "2026-09-15 14:30",
    filtros: [] as string[],
    estado: "conciliado" as const,
    pendencias: [],
  };

  it("leva período, momento da apuração, filtros e estado", () => {
    const l = cabecalhoDeExportacao(ctx);
    const plano = l.map((c) => c.join("|")).join("\n");
    expect(plano).toContain("01/09/2026 a 30/09/2026");
    expect(plano).toContain("2026-09-15 14:30");
    expect(plano).toContain("nenhum");
    expect(plano).toContain("Conciliado");
  });

  it("lista os filtros aplicados", () => {
    const l = cabecalhoDeExportacao({ ...ctx, filtros: ["só Full", "SKU ABC"] });
    expect(l.map((c) => c.join("|")).join("\n")).toContain("só Full · SKU ABC");
  });

  it("lista cada pendência com o efeito no resultado", () => {
    const l = cabecalhoDeExportacao({
      ...ctx,
      estado: "parcial",
      pendencias: pendenciasDaColetaFull({ foraDaJanela: false, parcial: true, remessas: 8, pendentes: 3 }),
    });
    const plano = l.map((c) => c.join("|")).join("\n");
    expect(plano).toContain("Pendências de informação|1");
    expect(plano).toContain("efeito no resultado: otimista");
  });

  it("vem antes dos números e termina em branco, pra não colar na tabela", () => {
    const l = cabecalhoDeExportacao(ctx);
    expect(l[0][0]).toBe("Período");
    expect(l[l.length - 1]).toEqual([""]);
  });
});
