import { describe, expect, it } from "vitest";
import { metricasDeQualidade } from "./proxima-medalha";


/**
 * Numeros reais da conta em 01/09/2026: 937 vendas concluidas em 60 dias,
 * reclamacoes 0% (0 casos), canceladas 0% (0), envios com atraso 0,22% (2).
 */
describe("metricasDeQualidade", () => {
  const m = {
    claims: { rate: 0, value: 0 },
    cancellations: { rate: 0, value: 0 },
    delayed_handling_time: { rate: 0.0022, value: 2 },
  };

  it("traduz a taxa em CASOS que ainda cabem — o que da pra agir", () => {
    /**
     * "0,22% de envios com atraso" nao diz se e perto do limite. "2 de 909, e
     * cabem mais 52" diz.
     *
     * A folga era 54, calculada como 6% de 937 menos os 2 usados. Mas 937 e a
     * contagem de PEDIDOS do app; a formula oficial do atraso divide por
     * "vendas enviadas com ME2", que e outro numero. A propria resposta do ML
     * revela qual: 2 casos a 0,22% implicam ~909 envios. 6% de 909 = 54,5;
     * menos os 2 ja usados = 52.
     *
     * Dois casos de diferenca num numero que a tela apresenta como acionavel —
     * e a base errada era sempre a maior, entao a folga saia otimista.
     */
    const envios = metricasDeQualidade(m, 937).find((x) => x.id === "envios")!;
    expect(envios.casos).toBe(2);
    expect(envios.folgaEmCasos).toBe(52);
    expect(envios.ok).toBe(true);
  });

  it("reclamacoes zeradas tem a folga inteira", () => {
    // Zero casos: a taxa e zero e nao revela denominador nenhum. Reclamacoes
    // dividem por vendas totais (doc oficial), entao a contagem serve.
    // 1% de 937 = 9,37 -> cabem 9.
    const r = metricasDeQualidade(m, 937).find((x) => x.id === "reclamacoes")!;
    expect(r.folgaEmCasos).toBe(9);
  });

  it("cancelamentos usam limite proprio, mais apertado", () => {
    // 0,5% de 937 = 4,685 -> cabem 4.
    const c = metricasDeQualidade(m, 937).find((x) => x.id === "cancelamentos")!;
    expect(c.limite).toBe(0.005);
    expect(c.folgaEmCasos).toBe(4);
  });

  it("EXATAMENTE no limite ainda e ok — teto inclusivo, como o ML publica", () => {
    /**
     * A tabela oficial do MLB marca a faixa vermelha como "> 8%", ou seja, 8%
     * ainda e laranja. Aqui o comparador era `taxa < limite`, que reprovava a
     * igualdade, enquanto o ReputacaoPanel ao lado aprovava. Mesma taxa, dois
     * veredictos, na mesma aba.
     */
    const noLimite = metricasDeQualidade(
      { ...m, claims: { rate: 0.01, value: 9 } }, 937,
    ).find((x) => x.id === "reclamacoes")!;
    expect(noLimite.ok).toBe(true);
  });

  it("acima do limite marca como NAO ok", () => {
    const acima = metricasDeQualidade(
      { ...m, claims: { rate: 0.02, value: 19 } }, 937,
    ).find((x) => x.id === "reclamacoes")!;
    expect(acima.ok).toBe(false);
  });

  it("estourado nao tem folga NEGATIVA, tem zero", () => {
    const est = metricasDeQualidade(
      { ...m, claims: { rate: 0.05, value: 47 } }, 937,
    ).find((x) => x.id === "reclamacoes")!;
    expect(est.folgaEmCasos).toBe(0);
  });

  it("a folga informada sempre sobrevive ao proprio comparador", () => {
    // O bug era a folga prometer um caso que o `ok` ao lado ia recusar.
    for (const casos of [0, 1, 5, 9]) {
      const r = metricasDeQualidade(
        { ...m, claims: { rate: casos / 937, value: casos } }, 937,
      ).find((x) => x.id === "reclamacoes")!;
      if (r.folgaEmCasos == null || r.ok !== true) continue;
      const depois = metricasDeQualidade(
        { ...m, claims: { rate: (casos + r.folgaEmCasos) / 937, value: casos + r.folgaEmCasos } }, 937,
      ).find((x) => x.id === "reclamacoes")!;
      expect(depois.ok, `com ${casos} casos, a folga ${r.folgaEmCasos} deveria continuar ok`).toBe(true);
    }
  });

  it("sem dado nao vira zero — vira indisponivel", () => {
    const sem = metricasDeQualidade({ claims: null }, 937).find((x) => x.id === "reclamacoes")!;
    expect(sem.taxa).toBeNull();
    expect(sem.ok).toBeNull();
    expect(sem.folgaEmCasos).toBeNull();
  });

  it("atraso no envio sem base implicita NAO inventa denominador", () => {
    /**
     * Com zero atrasos a taxa e zero e nao revela a base. A formula oficial
     * divide por "vendas enviadas com ME2", numero que nao vem na resposta —
     * usar o total de vendas produziria um "cabem mais X" que nao corresponde
     * a nada. Era o que a tela fazia.
     */
    const semBase = metricasDeQualidade(
      { ...m, delayed_handling_time: { rate: 0, value: 0 } }, 937,
    ).find((x) => x.id === "envios")!;
    expect(semBase.folgaEmCasos).toBeNull();
  });

  it("sem a contagem do app, a base implicita do ML ainda resolve", () => {
    // 2 casos a 0,22% implicam ~909 envios — o numero e do ML, nao nosso.
    expect(metricasDeQualidade(m, 0).find((x) => x.id === "envios")!.folgaEmCasos).toBe(52);
  });

  it("sem base nenhuma, reclamacoes tambem ficam sem folga", () => {
    const r = metricasDeQualidade(m, 0).find((x) => x.id === "reclamacoes")!;
    expect(r.folgaEmCasos).toBeNull();
  });

  it("prefere sales.completed do ML a contagem de pedidos do app", () => {
    /**
     * A taxa vem da janela do ML (60 ou 365 dias, conforme o volume) e a
     * contagem do app e feita sobre a janela da TELA. Misturar as duas produz
     * uma folga que nao corresponde a nenhuma das duas.
     */
    const r = metricasDeQualidade({ ...m, sales: { completed: 500 } }, 937)
      .find((x) => x.id === "reclamacoes")!;
    // 1% de 500 = 5.
    expect(r.folgaEmCasos).toBe(5);
  });

  it("carrega o periodo que o ML usou, em vez de assumir 60 dias", () => {
    /**
     * No MLB o periodo vira 365 dias pra quem teve menos de 60 vendas nos
     * ultimos 60 dias — justamente a conta em recuperacao, que mais precisa
     * ler o numero certo. A tela dizia "ultimos 60 dias" fixo.
     */
    const r = metricasDeQualidade(
      { ...m, claims: { rate: 0, value: 0, period: "365 days" } }, 937,
    ).find((x) => x.id === "reclamacoes")!;
    expect(r.periodo).toBe("365 days");
  });

  it("vendedor protegido mostra o numero real, nao o zero da protecao", () => {
    /**
     * Protegido recebe rate/value ZERADOS e os verdadeiros em `excluded`. O
     * zero e confortavel e falso: a protecao termina numa data conhecida, e ai
     * o real aparece de uma vez.
     */
    const r = metricasDeQualidade(
      { ...m, claims: { rate: 0, value: 0, excluded: { real_rate: 0.0912, real_value: 24 } } }, 937,
    ).find((x) => x.id === "reclamacoes")!;
    expect(r.protegida).toBe(true);
    expect(r.taxa).toBeCloseTo(0.0912);
    expect(r.ok).toBe(false);
  });

  it("metrics nulo devolve as tres, todas indisponiveis", () => {
    const r = metricasDeQualidade(null, 937);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.ok === null)).toBe(true);
  });
});
