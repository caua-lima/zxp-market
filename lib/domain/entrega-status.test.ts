import { describe, expect, it } from "vitest";
import { statusDeEntrega, textoDaData, type EnvioParaStatus } from "./entrega-status";

const HOJE = "2026-09-01";
const envio = (o: Partial<EnvioParaStatus> = {}): EnvioParaStatus => ({
  status: "ready_to_ship", substatus: "in_warehouse", logistica: "fulfillment",
  estimadaEm: "2026-09-03", ...o,
});

describe("textoDaData", () => {
  it("dia próximo vira 'hoje' e 'amanhã' — é o que dá pra agir", () => {
    expect(textoDaData("2026-09-01", HOJE)).toBe("hoje");
    expect(textoDaData("2026-09-02", HOJE)).toBe("amanhã");
  });

  it("dia distante ganha nome e data, como o ML escreve", () => {
    expect(textoDaData("2026-09-03", HOJE)).toBe("quinta-feira dia 3 de setembro");
  });

  it("yyyy-mm-dd é lido como data LOCAL, não UTC", () => {
    // new Date("2026-09-03") seria meia-noite UTC e voltaria pro dia 2 no Brasil.
    expect(textoDaData("2026-09-03", HOJE)).toContain("dia 3");
  });

  it("data inválida ou vazia não vira texto quebrado", () => {
    expect(textoDaData("", HOJE)).toBe("");
    expect(textoDaData("sei lá", HOJE)).toBe("");
    expect(textoDaData(null, HOJE)).toBe("");
  });
});

describe("os estados que o painel do ML mostra", () => {
  it("Full processando: 'Processando no centro de distribuição'", () => {
    const r = statusDeEntrega(envio(), HOJE);
    expect(r.titulo).toBe("Processando no centro de distribuição");
    expect(r.prazo).toBe("Chega quinta-feira dia 3 de setembro");
    expect(r.pedeAcao).toBe(false);
  });

  it("a caminho, com faixa de dias: 'entre os dias 2 e 3 de setembro'", () => {
    const r = statusDeEntrega(
      envio({ status: "shipped", estimadaEm: "2026-09-02", estimadaAte: "2026-09-03" }), HOJE,
    );
    expect(r.titulo).toBe("A caminho");
    expect(r.prazo).toBe("Chega entre os dias 2 e 3 de setembro");
  });

  it("faixa cruzando o mês nomeia os dois meses", () => {
    const r = statusDeEntrega(
      envio({ status: "shipped", estimadaEm: "2026-09-30", estimadaAte: "2026-10-02" }), HOJE,
    );
    expect(r.prazo).toBe("Chega entre 30 de setembro e 2 de outubro");
  });

  it("entregue mostra a data REAL, não a estimativa", () => {
    const r = statusDeEntrega(
      envio({ status: "delivered", estimadaEm: "2026-09-03", entregueEm: "2026-09-01" }), HOJE,
    );
    expect(r.titulo).toBe("Entregue");
    expect(r.prazo).toBe("Entregue hoje");
    expect(r.tom).toBe("ok");
  });
});

/**
 * `ready_to_ship` significa coisas OPOSTAS conforme a logística: no Full o
 * centro de distribuição cuida, fora dele a etiqueta espera o vendedor.
 * Tratar igual faz ignorar justamente o que precisa despachar.
 */
describe("ready_to_ship: Full x fora do Full", () => {
  it("no Full não pede ação nenhuma", () => {
    expect(statusDeEntrega(envio({ logistica: "fulfillment" }), HOJE).pedeAcao).toBe(false);
  });

  it("FORA do Full pede ação — a etiqueta espera você", () => {
    const r = statusDeEntrega(envio({ logistica: "drop_off", substatus: null }), HOJE);
    expect(r.titulo).toBe("Pronto pra despachar");
    expect(r.pedeAcao).toBe(true);
    expect(r.tom).toBe("acao");
  });

  it("etiqueta impressa e não despachada é o caso mais esquecido", () => {
    const r = statusDeEntrega(envio({ logistica: "xd_drop_off", substatus: "printed" }), HOJE);
    expect(r.titulo).toMatch(/despachar/);
    expect(r.pedeAcao).toBe(true);
  });
});

describe("problemas", () => {
  it("não entregue pede ação e sai como problema", () => {
    const r = statusDeEntrega(envio({ status: "not_delivered" }), HOJE);
    expect(r.tom).toBe("problema");
    expect(r.pedeAcao).toBe(true);
  });

  it("envio cancelado é problema, mas não pede ação do vendedor", () => {
    const r = statusDeEntrega(envio({ status: "cancelled" }), HOJE);
    expect(r.titulo).toBe("Envio cancelado");
    expect(r.pedeAcao).toBe(false);
  });
});

describe("robustez", () => {
  it("sem envio nenhum não inventa status", () => {
    const r = statusDeEntrega({ status: null }, HOJE);
    expect(r.titulo).toBe("Sem envio");
    expect(r.prazo).toBe("");
  });

  it("status novo do ML mostra o prazo em vez de uma frase inventada", () => {
    const r = statusDeEntrega(envio({ status: "estado_que_o_ml_criou_ontem" }), HOJE);
    expect(r.titulo).toBe("Em andamento");
    expect(r.prazo).toBe("Chega quinta-feira dia 3 de setembro");
  });

  it("sem prazo estimado, o título sozinho ainda serve", () => {
    const r = statusDeEntrega(envio({ estimadaEm: null }), HOJE);
    expect(r.titulo).toBe("Processando no centro de distribuição");
    expect(r.prazo).toBe("");
  });

  it("faixa com as duas datas iguais vira um dia só, não 'entre 3 e 3'", () => {
    const r = statusDeEntrega(
      envio({ status: "shipped", estimadaEm: "2026-09-03", estimadaAte: "2026-09-03" }), HOJE,
    );
    expect(r.prazo).toBe("Chega quinta-feira dia 3 de setembro");
  });

  it("ISO completo funciona igual a yyyy-mm-dd", () => {
    const r = statusDeEntrega(envio({ estimadaEm: "2026-09-03T00:00:00.000-03:00" }), HOJE);
    expect(r.prazo).toBe("Chega quinta-feira dia 3 de setembro");
  });
});
