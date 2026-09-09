import { describe, expect, it } from "vitest";
import {
  lerODoMes,
  montarCascata,
  residuoDaCascata,
  type DadosDre,
} from "./dre-apresentacao";

/**
 * Um mês que fecha: receita menos todas as saídas dá exatamente o resultado
 * líquido. Os números seguem a ordem de grandeza da conta real.
 */
const MES: DadosDre = {
  pedidos: 500,
  receitaBruta: 52_000,
  canceladas: 2_000,
  receitaLiquida: 50_000,
  taxasML: 8_000,
  frete: 6_000,
  receitaOperacional: 36_000,
  cmv: 20_000,
  lucroBruto: 16_000,
  imposto: 2_000,
  ads: 3_000,
  despesasOperacionais: 1_000,
  resultadoOperacional: 10_000,
  despesasEmpresa: [{ nome: "Pró-labore", valor: 4_000 }, { nome: "Contador", valor: 500 }],
  coletaFull: 500,
  resultadoLiquido: 5_000,
};

describe("montarCascata", () => {
  it("abre na receita LÍQUIDA — cancelamento não é custo, é venda que não houve", () => {
    const [primeiro] = montarCascata(MES);
    expect(primeiro.id).toBe("receita");
    expect(primeiro.valor).toBe(50_000);
    expect(primeiro.pctDaReceita).toBe(100);
  });

  it("fecha no resultado líquido", () => {
    const blocos = montarCascata(MES);
    const ultimo = blocos[blocos.length - 1];
    expect(ultimo.id).toBe("resultado");
    expect(ultimo.valor).toBe(5_000);
    expect(ultimo.pctDaReceita).toBeCloseTo(10, 5);
  });

  it("cada saída sabe de onde sai e onde para — é o que desenha a barra flutuante", () => {
    const taxas = montarCascata(MES).find((b) => b.id === "taxas")!;
    expect(taxas.antes).toBe(50_000);
    expect(taxas.depois).toBe(42_000);
    expect(taxas.pctDaReceita).toBeCloseTo(16, 5);
  });

  it("as saídas encadeiam: o `depois` de uma é o `antes` da próxima", () => {
    const saidas = montarCascata(MES).filter((b) => b.tipo === "saida");
    for (let i = 1; i < saidas.length; i++) {
      expect(saidas[i].antes).toBeCloseTo(saidas[i - 1].depois, 2);
    }
  });

  it("soma as despesas da empresa numa barra só — o detalhe fica na tabela", () => {
    const empresa = montarCascata(MES).find((b) => b.id === "empresa")!;
    expect(empresa.valor).toBe(4_500);
  });

  it("custo zerado não vira barra — altura zero só ocuparia espaço", () => {
    const semAds = montarCascata({ ...MES, ads: 0 });
    expect(semAds.find((b) => b.id === "ads")).toBeUndefined();
  });

  it("valor negativo entra como zero, não inverte a barra", () => {
    // Custo negativo é dado sujo; desenhar uma barra pra cima ali diria que a
    // linha DEU dinheiro, que é a leitura mais cara possível de errar.
    const blocos = montarCascata({ ...MES, coletaFull: -100 });
    expect(blocos.find((b) => b.id === "coleta")).toBeUndefined();
  });
});

describe("residuoDaCascata", () => {
  it("mês que fecha tem resíduo zero", () => {
    expect(residuoDaCascata(montarCascata(MES))).toBe(0);
  });

  it("linha faltando aparece como resíduo, em vez de sumir na figura", () => {
    /**
     * Se a apresentação apenas desenhasse as barras, um custo esquecido
     * viraria uma figura bonita e errada. O resíduo existe pra tela poder
     * dizer que não fecha.
     */
    const quebrado = { ...MES, resultadoLiquido: 7_000 };
    expect(residuoDaCascata(montarCascata(quebrado))).toBe(-2_000);
  });
});

describe("lerODoMes — a conversa que o sócio espera", () => {
  it("começa dizendo se o mês foi bom, em dinheiro", () => {
    const [primeiro] = lerODoMes(MES);
    expect(primeiro.id).toBe("resultado");
    expect(primeiro.tom).toBe("bom");
    expect(primeiro.titulo).toMatch(/azul/);
  });

  it("mês negativo troca o tom e a frase — nada de 'sobraram -R$ 3.000'", () => {
    const ruim = lerODoMes({ ...MES, resultadoLiquido: -3_000 })[0];
    expect(ruim.tom).toBe("ruim");
    expect(ruim.titulo).toMatch(/vermelho/);
    expect(ruim.texto).toMatch(/Faltaram/);
  });

  it("aponta o maior custo e o traduz em ponto percentual", () => {
    const maior = lerODoMes(MES).find((x) => x.id === "maior-custo")!;
    expect(maior.titulo).toMatch(/Custo da mercadoria/);
    expect(maior.texto).toMatch(/40,0%/);
  });

  it("dá o ticket médio com a contagem de pedidos", () => {
    const t = lerODoMes(MES).find((x) => x.id === "ticket")!;
    expect(t.titulo).toMatch(/100,00/);
  });

  it("sem pedidos não inventa ticket médio", () => {
    expect(lerODoMes({ ...MES, pedidos: 0 }).find((x) => x.id === "ticket")).toBeUndefined();
  });

  it("sem mês anterior, não há frase de direção — comparação inventada é pior", () => {
    const ids = lerODoMes(MES).map((x) => x.id);
    expect(ids).not.toContain("direcao");
    expect(ids).not.toContain("mudou");
  });
});

describe("lerODoMes — comparando com o período anterior", () => {
  const ANTERIOR: DadosDre = { ...MES, receitaLiquida: 40_000, resultadoLiquido: 2_000, pedidos: 450 };

  it("diz a direção do resultado e da margem", () => {
    const d = lerODoMes(MES, ANTERIOR).find((x) => x.id === "direcao")!;
    expect(d.tom).toBe("bom");
    // 5% pra 10%: a margem dobrou.
    expect(d.texto).toMatch(/5,0% para 10,0%/);
  });

  it("resultado que piora vira tom ruim", () => {
    const d = lerODoMes(MES, { ...ANTERIOR, resultadoLiquido: 9_000 })
      .find((x) => x.id === "direcao")!;
    expect(d.tom).toBe("ruim");
    expect(d.titulo).toMatch(/Pior/);
  });

  it("o custo que mais mudou é medido em PESO, não em reais", () => {
    /**
     * Mês que vende o dobro gasta o dobro em tudo. "ADS subiu R$ 3.000" só
     * repetiria o crescimento; o que informa é a linha que passou a comer
     * fatia diferente da receita.
     *
     * Aqui o CMV é o mesmo R$ 20.000 nos dois meses, mas sobre R$ 40.000 ele
     * pesava 50% e sobre R$ 50.000 pesa 40% — caiu 10 pontos sem mudar um
     * centavo.
     */
    const mudou = lerODoMes(MES, ANTERIOR).find((x) => x.id === "mudou")!;
    expect(mudou.titulo).toMatch(/Custo da mercadoria pesou menos/);
    expect(mudou.tom).toBe("bom");
    expect(mudou.texto).toMatch(/50,0% para 40,0%/);
  });

  it("mudança abaixo de meio ponto não vira destaque — é ruído de borda", () => {
    const quaseIgual = lerODoMes(MES, { ...MES, pedidos: 500 }).find((x) => x.id === "mudou");
    expect(quaseIgual).toBeUndefined();
  });
});
