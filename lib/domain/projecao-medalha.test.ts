import { describe, expect, it } from "vitest";
import { coberturaDaSerie, projetarMedalha } from "./projecao-medalha";
import { METAS_MERCADOLIDER, janelaDaMedalha } from "./mercadolider-metas";
import type { DiaDeVendas } from "./reputacao-vendas";

const GOLD = METAS_MERCADOLIDER.find((m) => m.nivel === "gold")!;

/** Série sintética: `porDia` vendas e `faturaPorDia` reais, todo dia da janela. */
function serieUniforme(hojeISO: string, porDia: number, faturaPorDia: number): DiaDeVendas[] {
  const j = janelaDaMedalha(hojeISO);
  const out: DiaDeVendas[] = [];
  const [ay, am, ad] = j.de.split("-").map(Number);
  const d = new Date(ay, am - 1, ad);
  for (;;) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (iso > j.ate) break;
    out.push({ dia: iso, concluidas: porDia, faturado: faturaPorDia });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

describe("coberturaDaSerie", () => {
  it("série que cobre a janela inteira é suficiente", () => {
    const r = coberturaDaSerie(serieUniforme("2026-09-05", 5, 400), "2026-09-05");
    expect(r.suficiente).toBe(true);
    expect(r.diasCobertos).toBe(r.diasNecessarios);
  });

  it("série vazia não cobre nada", () => {
    const r = coberturaDaSerie([], "2026-09-05");
    expect(r.suficiente).toBe(false);
    expect(r.diasCobertos).toBe(0);
  });

  it("série que começa no meio da janela não serve", () => {
    /**
     * Se a série começa no meio, o que vai SAIR da janela é desconhecido — e
     * a simulação viraria chute com cara de precisão.
     */
    const inteira = serieUniforme("2026-09-05", 5, 400);
    const metade = inteira.slice(Math.floor(inteira.length / 2));
    expect(coberturaDaSerie(metade, "2026-09-05").suficiente).toBe(false);
  });

  it("tolera alguns dias sem venda no começo", () => {
    // Dia sem venda legitimamente não aparece na série; até uma semana disso
    // é silêncio de vendas, não falta de dado.
    const inteira = serieUniforme("2026-09-05", 5, 400);
    expect(coberturaDaSerie(inteira.slice(4), "2026-09-05").suficiente).toBe(true);
  });
});

describe("projetarMedalha — a janela que anda", () => {
  it("quem já fechou os dois eixos não precisa de projeção", () => {
    const r = projetarMedalha(serieUniforme("2026-09-05", 5, 400), GOLD, "2026-09-05",
      { vendasPorDia: 5, faturamentoPorDia: 400 },
      { vendas: GOLD.vendas, faturamento: GOLD.faturamento });
    expect(r.tipo).toBe("ja_fechou");
  });

  it("sem cobertura NÃO inventa data", () => {
    const r = projetarMedalha([], GOLD, "2026-09-05",
      { vendasPorDia: 5, faturamentoPorDia: 400 }, { vendas: 100, faturamento: 20000 });
    expect(r.tipo).toBe("sem_cobertura");
  });

  it("a data projetada é MAIS TARDE do que a conta linear dizia", () => {
    /**
     * O coração do bug. A projeção linear fazia:
     *
     *   diasNoRitmo = ceil(falta / porDia)
     *
     * e nunca subtraía o que sai da janela na virada do mês. Aqui a simulação
     * subtrai, então a mesma situação leva MAIS dias — e a diferença é o mês
     * que desaparece do acumulado.
     */
    const hoje = "2026-09-05";
    const serie = serieUniforme(hoje, 5, 400);
    const atual = { vendas: 400, faturamento: 90000 };
    const ritmo = { vendasPorDia: 5, faturamentoPorDia: 400 };

    const linearVendas = Math.ceil((GOLD.vendas - atual.vendas) / ritmo.vendasPorDia);
    const linearFatura = Math.ceil((GOLD.faturamento - atual.faturamento) / ritmo.faturamentoPorDia);
    const linear = Math.max(linearVendas, linearFatura);

    const r = projetarMedalha(serie, GOLD, hoje, ritmo, atual);
    expect(r.tipo).toBe("chega");
    if (r.tipo !== "chega") return;
    expect(r.dias).toBeGreaterThan(linear);
    expect(r.atravessaViradaDeMes).toBe(true);
    expect(r.vendasQueSaem).toBeGreaterThan(0);
  });

  it("projeção que NÃO atravessa virada de mês bate com a linear", () => {
    /**
     * Quando falta pouco e a data cai antes do dia 1º, não há nada saindo —
     * e aí as duas contas têm que concordar. É o controle que prova que a
     * diferença acima vem da janela móvel, não de outra coisa.
     */
    const hoje = "2026-09-05";
    const serie = serieUniforme(hoje, 5, 400);
    const atual = { vendas: GOLD.vendas - 10, faturamento: GOLD.faturamento - 800 };
    const ritmo = { vendasPorDia: 5, faturamentoPorDia: 400 };

    const r = projetarMedalha(serie, GOLD, hoje, ritmo, atual);
    expect(r.tipo).toBe("chega");
    if (r.tipo !== "chega") return;
    expect(r.atravessaViradaDeMes).toBe(false);
    expect(r.dias).toBe(2); // 10 vendas / 5 por dia
  });

  it("ritmo que não compensa o que sai devolve 'nao_chega', não uma data longínqua", () => {
    /**
     * Com a janela móvel, um ritmo fraco pode NUNCA fechar: o que entra não
     * cobre o mês que sai. A projeção linear sempre produzia uma data — basta
     * dividir — e essa data era ficção.
     */
    const hoje = "2026-09-05";
    const serie = serieUniforme(hoje, 10, 900);
    const r = projetarMedalha(serie, GOLD, hoje, { vendasPorDia: 1, faturamentoPorDia: 50 },
      { vendas: 300, faturamento: 60000 });
    expect(r.tipo).toBe("nao_chega");
  });

  it("ritmo zero não fecha nunca", () => {
    const hoje = "2026-09-05";
    const r = projetarMedalha(serieUniforme(hoje, 5, 400), GOLD, hoje,
      { vendasPorDia: 0, faturamentoPorDia: 0 }, { vendas: 100, faturamento: 20000 });
    expect(r.tipo).toBe("nao_chega");
  });

  it("os dois eixos precisam fechar — não basta o adiantado", () => {
    // Vendas já batidas, faturamento longe: a data tem que seguir o faturamento.
    const hoje = "2026-09-05";
    const serie = serieUniforme(hoje, 5, 400);
    const r = projetarMedalha(serie, GOLD, hoje, { vendasPorDia: 5, faturamentoPorDia: 400 },
      { vendas: GOLD.vendas + 50, faturamento: GOLD.faturamento - 4000 });
    expect(r.tipo).toBe("chega");
    if (r.tipo !== "chega") return;
    expect(r.dias).toBeGreaterThanOrEqual(10); // 4000 / 400
  });

  it("o que sai é contado e devolvido, pra a tela poder explicar", () => {
    const hoje = "2026-09-05";
    const serie = serieUniforme(hoje, 5, 400);
    const r = projetarMedalha(serie, GOLD, hoje, { vendasPorDia: 6, faturamentoPorDia: 500 },
      { vendas: 300, faturamento: 70000 });
    if (r.tipo !== "chega") return;
    // Junho tem 30 dias a 5 vendas/dia = 150 saindo na virada de setembro->outubro.
    expect(r.vendasQueSaem).toBeGreaterThanOrEqual(150);
    expect(r.faturamentoQueSai).toBeGreaterThanOrEqual(30 * 400);
  });

  it("data inválida não quebra", () => {
    const r = projetarMedalha(serieUniforme("2026-09-05", 5, 400), GOLD, "ontem",
      { vendasPorDia: 5, faturamentoPorDia: 400 }, { vendas: 100, faturamento: 20000 });
    expect(["sem_cobertura", "nao_chega"]).toContain(r.tipo);
  });
});
