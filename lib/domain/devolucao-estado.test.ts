import { describe, expect, it } from "vitest";
import { devolucaoConcluida, devolucaoEmAndamento, ehDevolucao, estadoDaDevolucao } from "./devolucao-estado";

describe("estadoDaDevolucao — aberta nao e concluida", () => {
  it("devolucao ABERTA nao tira a venda do faturamento", () => {
    /**
     * A rota de Ads fazia `if (tipo === "devolucao") devolIds.add(id)` — so o
     * tipo. Bastava o comprador ABRIR a solicitacao pra a venda sair do
     * faturamento e do lucro ALI, enquanto o Dashboard, que checava o status,
     * continuava contando a mesma venda. Dois numeros pro mesmo pedido.
     *
     * No Ads essa receita e o DENOMINADOR do ROAS: a campanha aparecia pior do
     * que e enquanto a disputa corria, e o ajuste seria feito em cima de um
     * numero que voltaria ao normal sozinho.
     */
    const r = { tipo: "devolucao", status: "opened" };
    expect(estadoDaDevolucao(r)).toBe("em_andamento");
    expect(devolucaoConcluida(r)).toBe(false);
    expect(devolucaoEmAndamento(r)).toBe(true);
  });

  it("devolucao FECHADA reverte a venda", () => {
    expect(devolucaoConcluida({ tipo: "devolucao", status: "closed" })).toBe(true);
    expect(devolucaoConcluida({ tipo: "devolucao", status: "resolved" })).toBe(true);
  });

  it("o vocabulario de claim viva e reconhecido em status OU stage", () => {
    /**
     * O ML distribui a informacao entre os dois campos: `status: "opened"` com
     * `stage: "dispute"`, `status: "closed"` com `stage: "recontact"`. Olhar so
     * um deixa passar metade dos casos.
     */
    for (const s of ["opened", "in_process", "pending", "in_progress", "under_review"]) {
      expect(devolucaoConcluida({ tipo: "devolucao", status: s }), s).toBe(false);
    }
    for (const st of ["dispute", "recontact", "in_mediation", "review"]) {
      expect(devolucaoConcluida({ tipo: "devolucao", status: "closed", stage: st }), st).toBe(false);
    }
  });

  it("caixa alta nao engana", () => {
    expect(devolucaoConcluida({ tipo: "devolucao", status: "OPENED" })).toBe(false);
  });
});

describe("estadoDaDevolucao — o legado sem status", () => {
  it("registro antigo sem status continua contando como concluido", () => {
    /**
     * Escolha deliberada, ja em producao na rota de metricas: registros
     * gravados antes de o sync guardar `status` vieram do caminho baseado em
     * CANCELAMENTO, em que a venda de fato ja nao existia. Trata-los como em
     * andamento faria o faturamento historico SALTAR de repente.
     */
    expect(devolucaoConcluida({ tipo: "devolucao" })).toBe(true);
    expect(devolucaoConcluida({ tipo: "devolucao", status: "" })).toBe(true);
  });

  it("vocabulario novo do ML nao para o desconto de devolucao real", () => {
    expect(devolucaoConcluida({ tipo: "devolucao", status: "algo_que_o_ml_inventou" })).toBe(true);
  });
});

describe("ehDevolucao", () => {
  it("reconhece o tipo gravado pelo sync e as variantes do ML", () => {
    expect(ehDevolucao({ tipo: "devolucao" })).toBe(true);
    expect(ehDevolucao({ tipo: "returns" })).toBe(true);
    expect(ehDevolucao({ tipo: "return" })).toBe(true);
  });

  it("cancelamento NAO e devolucao", () => {
    // Os dois saem do faturamento, mas so devolucao devolve produto ao estoque.
    expect(ehDevolucao({ tipo: "cancelamento" })).toBe(false);
    expect(ehDevolucao({})).toBe(false);
  });

  it("nao-devolucao nunca conta como concluida nem em andamento", () => {
    expect(devolucaoConcluida({ tipo: "cancelamento", status: "closed" })).toBe(false);
    expect(devolucaoEmAndamento({ tipo: "cancelamento", status: "opened" })).toBe(false);
    expect(estadoDaDevolucao({ tipo: "cancelamento" })).toBe("nao_e_devolucao");
  });
});
