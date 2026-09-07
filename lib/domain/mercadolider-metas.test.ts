import { describe, expect, it } from "vitest";
import {
  METAS_MERCADOLIDER,
  janelaDaMedalha,
  progressoMercadoLider,
  proximaMeta,
} from "./mercadolider-metas";

/**
 * A tabela da página oficial "Tudo sobre ser MercadoLíder", lida em
 * 07/09/2026. Estes testes travam os números: se alguém encostar neles sem
 * conferir a fonte, o app volta a planejar compra em cima de chute.
 */
describe("a tabela oficial", () => {
  it("MercadoLíder: 230 vendas e R$ 37.000", () => {
    expect(METAS_MERCADOLIDER[0]).toMatchObject({ nivel: "silver", vendas: 230, faturamento: 37_000 });
  });

  it("Gold: 575 vendas e R$ 118.400", () => {
    expect(METAS_MERCADOLIDER[1]).toMatchObject({ nivel: "gold", vendas: 575, faturamento: 118_400 });
  });

  it("Platinum: 1.725 vendas e R$ 296.000", () => {
    expect(METAS_MERCADOLIDER[2]).toMatchObject({ nivel: "platinum", vendas: 1_725, faturamento: 296_000 });
  });
});

describe("proximaMeta", () => {
  it("sem selo, o próximo degrau é o MercadoLíder simples", () => {
    expect(proximaMeta(null)?.nivel).toBe("silver");
    expect(proximaMeta("")?.nivel).toBe("silver");
  });

  it("silver mira Gold, gold mira Platinum", () => {
    expect(proximaMeta("silver")?.nivel).toBe("gold");
    expect(proximaMeta("gold")?.nivel).toBe("platinum");
  });

  it("no Platinum não há próximo — a pergunta vira outra", () => {
    expect(proximaMeta("platinum")).toBeNull();
  });

  it("aceita o status como o ML manda, em qualquer caixa", () => {
    expect(proximaMeta("GOLD")?.nivel).toBe("platinum");
    expect(proximaMeta(" gold ")?.nivel).toBe("platinum");
  });
});

/**
 * "Os 3 meses mais os dias do mês vigente" — a redação da própria página.
 */
describe("janelaDaMedalha", () => {
  it("em 05/09/2026 vai de 01/06 a 05/09 — 97 dias", () => {
    const j = janelaDaMedalha("2026-09-05");
    expect(j.de).toBe("2026-06-01");
    expect(j.ate).toBe("2026-09-05");
    expect(j.dias).toBe(97);
  });

  it("no dia 1º a janela ainda pega os 3 meses cheios", () => {
    const j = janelaDaMedalha("2026-09-01");
    expect(j.de).toBe("2026-06-01");
    expect(j.dias).toBe(93);
  });

  it("vira o ano sem quebrar: fevereiro volta pra novembro", () => {
    expect(janelaDaMedalha("2026-02-10").de).toBe("2025-11-01");
  });

  it("é maior que os 60 dias da reputação — as janelas são diferentes", () => {
    // Confundir as duas foi o que fez R$ 76.490 parecer meta quando era
    // progresso acumulado. O teste existe pra não voltar a acontecer.
    expect(janelaDaMedalha("2026-09-05").dias).toBeGreaterThan(60);
  });
});

describe("progressoMercadoLider — a conta real desta conta", () => {
  /**
   * Faturamento medido em ~120 dias na conta: R$ 77.218. Contra o Gold
   * (R$ 118.400) isso é 65% — e o painel antigo, medindo 60 dias, mostrava
   * pouco mais da metade disso.
   */
  const p = progressoMercadoLider(520, 77_218, "silver", "2026-09-05")!;

  it("mira o Gold quando o selo atual é o simples", () => {
    expect(p.meta.nivel).toBe("gold");
  });

  it("o faturamento sai como percentual do alvo oficial", () => {
    expect(p.faturamento.alvo).toBe(118_400);
    expect(Math.round(p.faturamento.pct)).toBe(65);
    expect(Math.round(p.faturamento.falta)).toBe(41_182);
  });

  it("as vendas viajam junto — metade do critério mora nelas", () => {
    expect(p.vendas.alvo).toBe(575);
    expect(p.vendas.falta).toBe(55);
  });

  it("aponta o eixo que está travando", () => {
    // 520/575 = 90,4% contra 77.218/118.400 = 65,2%: o dinheiro está atrás.
    expect(p.gargalo).toBe("faturamento");
  });

  it("projeta pelo gargalo, não pelo eixo adiantado", () => {
    // R$ 77.218 / 97 dias = R$ 796/dia; R$ 41.182 restantes = 52 dias.
    expect(p.diasNoRitmo).toBe(52);
    expect(p.chegaEm).toBe("2026-10-27");
  });
});

describe("progressoMercadoLider — os casos que enganam", () => {
  it("faturamento fechado e vendas atrás: o gargalo são as vendas", () => {
    // O caso que o painel antigo escondia: só media dinheiro, e ali a barra
    // apareceria 100% cheia com a medalha travada.
    const p = progressoMercadoLider(300, 150_000, "silver", "2026-09-05")!;
    expect(p.faturamento.ok).toBe(true);
    expect(p.vendas.ok).toBe(false);
    expect(p.gargalo).toBe("vendas");
    expect(p.ambosOk).toBe(false);
  });

  it("os dois fechados: sem gargalo e sem dias a esperar", () => {
    const p = progressoMercadoLider(600, 120_000, "silver", "2026-09-05")!;
    expect(p.ambosOk).toBe(true);
    expect(p.gargalo).toBeNull();
    expect(p.diasNoRitmo).toBe(0);
  });

  it("sem venda nenhuma não há projeção — null, nunca 'chega hoje'", () => {
    const p = progressoMercadoLider(0, 0, "silver", "2026-09-05")!;
    expect(p.diasNoRitmo).toBeNull();
    expect(p.chegaEm).toBeNull();
  });

  it("no Platinum não há progresso a calcular", () => {
    expect(progressoMercadoLider(2000, 400_000, "platinum", "2026-09-05")).toBeNull();
  });

  it("número negativo ou lixo entra como zero, não contamina a conta", () => {
    const p = progressoMercadoLider(-5, Number.NaN, "silver", "2026-09-05")!;
    expect(p.vendas.atual).toBe(0);
    expect(p.faturamento.atual).toBe(0);
  });
});
