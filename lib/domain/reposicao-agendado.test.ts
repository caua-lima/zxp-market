import { describe, expect, it } from "vitest";
import { planoEnvioAteData, planoEnvioParaFull, type ProdutoReposicao } from "./reposicao";

/**
 * O plano de envio pro Full tem que enxergar o que JÁ está agendado: sem isso
 * ele sugere mandar de novo as 199 que já têm dia marcado, e conta elas como
 * estoque livre em casa.
 */
const limao = (x: Partial<ProdutoReposicao & { noFull: number; ehFull: boolean }> = {}) => ({
  id: "limao", nome: "Limão caipira", estoqueTotal: 379, emCasa: 379, mediaDiaria: 10,
  custoUnitario: 5, ativo: true, noFull: 20, ehFull: true, ...x,
});

describe("planoEnvioParaFull com envio agendado", () => {
  it("sem agendamento, comportamento de sempre: manda o que falta, limitado ao galpão", () => {
    const [i] = planoEnvioParaFull([limao()], 30).itens; // precisa 300, tem 20 → falta 280
    expect(i).toMatchObject({ enviar: 280, faltaComprar: 0, agendado: 0 });
  });

  it("os 199 agendados contam como cobertura: só sugere o que falta além deles", () => {
    const [i] = planoEnvioParaFull([limao({ agendadoFull: 199 })], 30).itens; // 300 − 20 − 199 = 81
    expect(i).toMatchObject({ enviar: 81, agendado: 199, faltaComprar: 0 });
  });

  it("o agendado sai do galpão livre: com 379 em casa e 199 agendados, só 180 podem ser enviados", () => {
    // precisa 700, tem 20, 199 a caminho → falta 481; livre em casa = 379 − 199 = 180
    const [i] = planoEnvioParaFull([limao({ mediaDiaria: 23.33, agendadoFull: 199 })], 30).itens;
    expect(i.enviar).toBe(180);
    expect(i.faltaComprar).toBe(i.precisaNoFull - 20 - 199 - 180);
  });

  it("o agendado já cobre tudo: o produto nem aparece no plano de envio", () => {
    expect(planoEnvioParaFull([limao({ agendadoFull: 400 })], 30).itens).toEqual([]);
  });

  it("agendado negativo ou inválido é ignorado", () => {
    const [i] = planoEnvioParaFull([limao({ agendadoFull: -50 })], 30).itens;
    expect(i).toMatchObject({ enviar: 280, agendado: 0 });
  });
});

describe("planoEnvioAteData com envio agendado", () => {
  it("abate o agendado do que falta até a data", () => {
    // hoje 15/10 → 25/10 = 11 dias × 10 = 110 (sem trânsito). Tem 20 + 50 agendados → falta 40.
    const [i] = planoEnvioAteData([limao({ agendadoFull: 50 })], "2026-10-15", "2026-10-25", 0).itens;
    expect(i).toMatchObject({ precisaNoFull: 110, enviar: 40, agendado: 50 });
  });
  it("sem agendado, igual ao de antes", () => {
    const [i] = planoEnvioAteData([limao()], "2026-10-15", "2026-10-25", 0).itens;
    expect(i).toMatchObject({ enviar: 90, agendado: 0 });
  });
});
