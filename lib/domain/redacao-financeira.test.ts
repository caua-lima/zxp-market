import { describe, expect, it } from "vitest";
import {
  CAMPOS_FINANCEIROS,
  CAMPOS_FINANCEIROS_DA_CONCILIACAO,
  CAMPOS_FINANCEIROS_DO_DIA,
  redigirFinanceiro,
} from "./redacao-financeira";

/** Uma resposta de métricas com a mesma forma da rota real. */
const RESPOSTA = {
  faturamentoBruto: 11_478.97,
  faturamentoLiquido: 11_331.44,
  vendasCanceladas: 147.53,
  vendasDevolvidas: 0,
  totalRetorno: 8_200,
  ordersCount: 255,
  pedidosHoje: 4,
  unidadesVendidas: 300,
  totalCMV: 4_100,
  totalAds: 320,
  totalEnvio: 900,
  totalImposto: 450,
  totalTaxasML: 1_800,
  custosOperacionais: 135,
  custosDre: 250,
  custosDreDetalhe: [{ nome: "Contabilidade", valor: 250, freq: "mensal" }],
  lucroSemCustos: 1_000,
  lucroComCustos: 865,
  margemSemCustos: 8.8,
  margemComCustos: 7.6,
  reconc: { liquidoReal: 9_000 },
  anuncios: [{ title: "Erva", retorno: 500, qty: 10 }],
  devolucoesDetalhe: [{ orderId: "1", valor: 50 }],
  adsDiag: { falhou: false },
  hoje: {
    faturamentoBruto: 120,
    faturamentoLiquido: 120,
    pedidos: 4,
    unidadesVendidas: 5,
    totalCMV: 40,
    totalAds: 3,
    totalEnvio: 10,
    totalTaxasML: 20,
    totalImposto: 5,
    lucroLiquido: 42,
    vendaDiretaAds: 60,
    totalRetorno: 100,
    produtoTop: { titulo: "Erva", receita: 80, unidades: 2 },
  },
  conciliacao: {
    vendasBrutas: 11_331.44,
    quantidadeVendas: 255,
    unidadesVendidas: 300,
    precoMedioPorVenda: 44.4,
    canceladasQuantidade: 3,
    canceladasValor: 147.53,
    canceladasDetalhe: [{ orderId: "1", valor: 50 }],
    pedidosSemFrete: 2,
    valorSemFrete: 80,
  },
  serieDiaria: [{ data: "2026-09-01", faturamento: 1_100 }],
  from: "2026-09-01",
  to: "2026-09-30",
};

describe("redigirFinanceiro — o que NÃO pode sair", () => {
  const r = redigirFinanceiro(RESPOSTA);

  it("remove todo campo de custo, lucro e margem do período", () => {
    for (const campo of CAMPOS_FINANCEIROS) {
      expect(campo in r).toBe(false);
    }
  });

  it("remove os mesmos campos dentro do bloco do dia", () => {
    const hoje = r.hoje as Record<string, unknown>;
    for (const campo of CAMPOS_FINANCEIROS_DO_DIA) {
      expect(campo in hoje).toBe(false);
    }
  });

  it("remove o detalhe de cancelados e de frete pendente da conciliação", () => {
    const c = r.conciliacao as Record<string, unknown>;
    for (const campo of CAMPOS_FINANCEIROS_DA_CONCILIACAO) {
      expect(campo in c).toBe(false);
    }
  });

  it("nenhum valor de custo sobrevive em lugar nenhum do payload", () => {
    /**
     * A varredura pega o caso que a lista de campos não pega: um custo
     * aninhado num objeto que ninguém lembrou de redigir.
     */
    const texto = JSON.stringify(r);
    for (const proibido of [4_100, 865, 7.6, 1_800, 250]) {
      expect(texto).not.toContain(String(proibido));
    }
  });
});

describe("redigirFinanceiro — o que PRECISA continuar", () => {
  const r = redigirFinanceiro(RESPOSTA);

  it("mantém receita, pedidos e unidades — é o resumo que o papel acompanha", () => {
    expect(r.faturamentoBruto).toBe(11_478.97);
    expect(r.faturamentoLiquido).toBe(11_331.44);
    expect(r.ordersCount).toBe(255);
    expect(r.unidadesVendidas).toBe(300);
  });

  it("mantém a série diária e o período", () => {
    expect(r.serieDiaria).toEqual([{ data: "2026-09-01", faturamento: 1_100 }]);
    expect(r.from).toBe("2026-09-01");
    expect(r.to).toBe("2026-09-30");
  });

  it("mantém do dia o que é venda, não custo", () => {
    const hoje = r.hoje as Record<string, unknown>;
    expect(hoje.faturamentoLiquido).toBe(120);
    expect(hoje.pedidos).toBe(4);
    expect(hoje.produtoTop).toEqual({ titulo: "Erva", receita: 80, unidades: 2 });
  });

  it("mantém quantidade e preço médio na conciliação", () => {
    const c = r.conciliacao as Record<string, unknown>;
    expect(c.quantidadeVendas).toBe(255);
    expect(c.precoMedioPorVenda).toBe(44.4);
  });
});

describe("a marca de que houve redação", () => {
  it("marca financeiroOculto — ausência de dado não é zero", () => {
    /**
     * Sem a marca, o campo ausente vira `?? 0` no componente e o member leria
     * "Lucro R$ 0,00" como se fosse o resultado do mês.
     */
    expect(redigirFinanceiro(RESPOSTA).financeiroOculto).toBe(true);
  });

  it("não modifica o payload original — o cache guarda a versão completa", () => {
    const copia = JSON.parse(JSON.stringify(RESPOSTA));
    redigirFinanceiro(RESPOSTA);
    expect(RESPOSTA).toEqual(copia);
    expect(RESPOSTA.lucroComCustos).toBe(865);
  });

  it("payload vazio não quebra", () => {
    expect(redigirFinanceiro({})).toEqual({ financeiroOculto: true });
  });
});
