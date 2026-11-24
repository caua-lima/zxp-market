import { describe, expect, it } from "vitest";
import { lerReais, margemDaPromocao, mlbDaLinha, oportunidadeDeMargem, pct, reais, repasseParaMeta, situacaoDaPromocao, statusDaMargem } from "../../extensao-vigia-full/margem-promocao.js";
import { simularPreco } from "./preco-simulacao";

describe("leitura dos números da página de promoções", () => {
  it("pega o PRIMEIRO valor, mesmo com o detalhe de custos colado depois", () => {
    // Texto real da coluna "Você recebe" (22/11/2026), com o tooltip junto.
    expect(lerReais("R$ 18,27 Preço*Preço original R$ 39,90R$ 21,31Tarifa de venda**Clássico -R$ 0,64")).toBe(18.27);
  });

  it("milhar, negativo e sem centavos", () => {
    expect(lerReais("R$ 1.234,56")).toBe(1234.56);
    expect(lerReais("-R$ 2,40")).toBe(-2.4);
    expect(lerReais("R$ 40")).toBe(40);
    expect(lerReais("sem preço")).toBeNull();
  });

  it("MLB da linha: '#4662183905'", () => {
    expect(mlbDaLinha("SKU MentaStronger #4662183905 R$ 39,90")).toBe("MLB4662183905");
    expect(mlbDaLinha("nada")).toBeNull();
  });
});

describe("margem da promoção", () => {
  // Menta Stronger, "Com redução de tarifas" 23 a 30/nov: preço R$ 21,31, você recebe R$ 18,27.
  const comReducao = { recebe: 18.27, precoFinal: 21.31, custo: 13.19, impostoPct: 4 };

  it("lucro = você recebe − custo − imposto sobre o preço final", () => {
    const r = margemDaPromocao(comReducao)!;
    expect(r.imposto).toBeCloseTo(0.8524, 4);
    expect(r.lucro).toBeCloseTo(18.27 - 13.19 - 0.8524, 4);
    expect(r.margem).toBeCloseTo((r.lucro / 21.31) * 100, 6);
  });

  it("bate com o simulador de preço do Dash (mesma conta)", () => {
    // O simulador recebe tarifa e frete; o ML já os desconta no "você recebe".
    const sim = simularPreco({ preco: 21.31, comissao: 0.64, frete: 2.40, custo: 13.19, impostoPct: 4 });
    const r = margemDaPromocao(comReducao)!;
    expect(r.lucro).toBeCloseTo(sim.lucro, 6);
    expect(r.margem).toBeCloseTo(sim.margem, 6);
  });

  it("a proposta de Black Friday (sem redução de tarifa) rende menos — R$ 15,93", () => {
    const bf = margemDaPromocao({ ...comReducao, recebe: 15.93 })!;
    expect(bf.lucro).toBeLessThan(margemDaPromocao(comReducao)!.lucro);
  });

  it("sem custo cadastrado não inventa margem", () => {
    expect(margemDaPromocao({ ...comReducao, custo: 0 })).toBeNull();
  });

  it("repasse pra bater a meta de 10%", () => {
    expect(repasseParaMeta(21.31, 13.19, 4, 10)).toBeCloseTo(13.19 + 0.8524 + 2.131, 4);
  });
});

describe("faixas de cor iguais às do Dash", () => {
  it("prejuízo, atenção, saudável", () => {
    expect(statusDaMargem(-1, 10)).toBe("prejuizo");
    expect(statusDaMargem(5, 10)).toBe("atencao");
    expect(statusDaMargem(10, 10)).toBe("saudavel");
  });

  it("formato brasileiro", () => {
    expect(reais(1234.5)).toBe("R$ 1.234,50");
    expect(reais(-2.61)).toBe("−R$ 2,61");
    expect(pct(12.345)).toBe("12,3%");
    // Menta & Cereja a R$ 18,09: lucro −R$ 0,01 aparecia "-0,0%" (hífen e sinal perdido).
    expect(pct(-0.04)).toBe("−0,0%");
    expect(pct(-3.21)).toBe("−3,2%");
  });
});

describe("oportunidade de margem (outra promoção, preço parecido, lucro maior)", () => {
  it("exemplo do dono: 19,90 recebendo 16,17 → 19,30 recebendo 16,98 é oportunidade", () => {
    const op = oportunidadeDeMargem({ precoFinal: 19.9, recebe: 16.17 }, { precoFinal: 19.3, recebe: 16.98 }, 4)!;
    // +0,81 de repasse e o imposto ainda cai 4% × 0,60.
    expect(op.ganho).toBeCloseTo(0.81 + 0.6 * 0.04, 6);
    expect(op.difPrecoPct).toBeCloseTo(-3.015, 2);
  });

  it("preço muito diferente não conta, mesmo com repasse maior", () => {
    expect(oportunidadeDeMargem({ precoFinal: 19.9, recebe: 16.17 }, { precoFinal: 24.9, recebe: 19.5 }, 4)).toBeNull();
    expect(oportunidadeDeMargem({ precoFinal: 19.9, recebe: 16.17 }, { precoFinal: 15, recebe: 17 }, 4)).toBeNull();
  });

  it("lucro igual ou menor não é oportunidade", () => {
    // Boldo & Menta (23/11): ativa 19,90 → 16,70; relâmpago 19,69 → 15,13.
    expect(oportunidadeDeMargem({ precoFinal: 19.9, recebe: 16.7 }, { precoFinal: 19.69, recebe: 15.13 }, 4)).toBeNull();
    expect(oportunidadeDeMargem({ precoFinal: 19.9, recebe: 16.7 }, { precoFinal: 19.9, recebe: 16.72 }, 4)).toBeNull();
  });

  it("preço um pouco maior: desconta o imposto a mais", () => {
    const op = oportunidadeDeMargem({ precoFinal: 20, recebe: 16 }, { precoFinal: 21, recebe: 17 }, 10)!;
    expect(op.ganho).toBeCloseTo(1 - 0.1, 6);
  });

  it("situação pelo cabeçalho da promoção", () => {
    expect(situacaoDaPromocao("Com redução de tarifas | 23 a 30/nov | ATIVA", "Alterar")).toBe("ativa");
    expect(situacaoDaPromocao("Oferta relâmpago 27/nov PROGRAMADA", "Alterar")).toBe("programada");
    expect(situacaoDaPromocao("Nova proposta! Black Friday", "Participar")).toBe("oferecida");
    expect(situacaoDaPromocao("Oferta relâmpago", "Deixar de participar")).toBe("outra");
  });
});
