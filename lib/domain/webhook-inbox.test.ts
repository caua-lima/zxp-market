import { describe, expect, it } from "vitest";
import {
  APAGAR,
  CONCESSAO_MS,
  ESPERAS_MIN,
  MAX_TENTATIVAS,
  aoConcluir,
  aoReceber,
  aoReivindicar,
  idDoItem,
  pedidoEhDoVendedor,
  podeReivindicar,
  type ItemInbox,
} from "./webhook-inbox";

const AGORA = 1_790_000_000_000;
const NOVA = { topic: "orders_v2", orderId: "2000001", sellerId: "999" };

function item(over: Partial<ItemInbox> = {}): ItemInbox {
  return {
    ...NOVA, estado: "pendente", geracao: 1, recebidas: 1, primeiraEm: AGORA - 1000, ultimaEm: AGORA - 1000,
    tentativas: 0, elegivelEm: AGORA - 1000, ...over,
  };
}

describe("aoReceber — um item por pedido, sem deduplicar pra sempre", () => {
  it("primeira notificação cria o item pendente, elegível já", () => {
    expect(aoReceber(undefined, NOVA, AGORA)).toMatchObject({
      estado: "pendente", geracao: 1, recebidas: 1, tentativas: 0, elegivelEm: AGORA, primeiraEm: AGORA,
    });
  });

  it("notificação repetida antes do processamento COALESCE: sobe a geração, continua um item", () => {
    const a = aoReceber(item({ geracao: 3, recebidas: 3 }), NOVA, AGORA);
    expect(a).toMatchObject({ geracao: 4, recebidas: 4, estado: "pendente", elegivelEm: AGORA });
  });

  it("item já processado VOLTA a pendente — pedido recebe mudança legítima depois (pago, depois cancelado)", () => {
    const a = aoReceber(item({ estado: "feito", elegivelEm: null, geracao: 2 }), NOVA, AGORA);
    expect(a).toMatchObject({ estado: "pendente", geracao: 3, elegivelEm: AGORA, tentativas: 0 });
  });

  it("item na fila de falhas é revivido por notificação nova, com as tentativas zeradas", () => {
    const a = aoReceber(item({ estado: "falhou", tentativas: MAX_TENTATIVAS, ultimoErro: "x" }), NOVA, AGORA);
    expect(a).toMatchObject({ estado: "pendente", tentativas: 0, ultimoErro: APAGAR });
  });

  it("pendente esperando nova tentativa: notificação nova antecipa, mas não zera a contagem de falhas", () => {
    const a = aoReceber(item({ tentativas: 2, elegivelEm: AGORA + 900_000 }), NOVA, AGORA);
    expect(a).toMatchObject({ elegivelEm: AGORA });
    expect(a).not.toHaveProperty("tentativas");
  });

  it("processando: só sobe a geração — não muda estado nem concessão (dois processos no mesmo item, não)", () => {
    const a = aoReceber(item({ estado: "processando", leaseDono: "A", elegivelEm: AGORA + CONCESSAO_MS }), NOVA, AGORA);
    expect(a).toEqual({ geracao: 2, recebidas: 2, ultimaEm: AGORA, sellerId: "999" });
  });
});

describe("podeReivindicar / aoReivindicar", () => {
  it("pendente vencido: sim; pendente no futuro: não", () => {
    expect(podeReivindicar(item(), AGORA)).toBe(true);
    expect(podeReivindicar(item({ elegivelEm: AGORA + 1 }), AGORA)).toBe(false);
  });

  it("processando com concessão viva: não; vencida (processo morreu): sim", () => {
    expect(podeReivindicar(item({ estado: "processando", elegivelEm: AGORA + 1 }), AGORA)).toBe(false);
    expect(podeReivindicar(item({ estado: "processando", elegivelEm: AGORA - 1 }), AGORA)).toBe(true);
  });

  it("encerrado nunca é reivindicado, mesmo com lixo em elegivelEm", () => {
    for (const estado of ["feito", "descartado", "falhou"] as const) {
      expect(podeReivindicar(item({ estado, elegivelEm: AGORA - 1 }), AGORA)).toBe(false);
    }
    expect(podeReivindicar(item({ elegivelEm: null }), AGORA)).toBe(false);
    expect(podeReivindicar(undefined, AGORA)).toBe(false);
  });

  it("reivindicar guarda a geração em processo e empurra a elegibilidade pro fim da concessão", () => {
    expect(aoReivindicar(item({ geracao: 5 }), "A", AGORA)).toEqual({
      estado: "processando", leaseDono: "A", geracaoEmProcesso: 5, elegivelEm: AGORA + CONCESSAO_MS,
    });
  });
});

describe("aoConcluir", () => {
  const emProcesso = (over: Partial<ItemInbox> = {}) =>
    item({ estado: "processando", leaseDono: "A", geracao: 2, geracaoEmProcesso: 2, ...over });

  it("sucesso sem notificação nova no meio: feito, fora da varredura, concessão solta", () => {
    expect(aoConcluir(emProcesso(), "A", { tipo: "feito", resultado: "notificada" }, AGORA)).toMatchObject({
      estado: "feito", elegivelEm: APAGAR, leaseDono: APAGAR, geracaoEmProcesso: APAGAR, resultado: "notificada", concluidoEm: AGORA,
    });
  });

  it("notificação chegou ENQUANTO processava: volta a pendente, elegível já — ela não se perde", () => {
    expect(aoConcluir(emProcesso({ geracao: 3 }), "A", { tipo: "feito", resultado: "x" }, AGORA)).toMatchObject({
      estado: "pendente", elegivelEm: AGORA,
    });
  });

  it("descartado é definitivo (pedido de outro vendedor, sandbox)", () => {
    expect(aoConcluir(emProcesso(), "A", { tipo: "descartado", resultado: "nao_e_do_vendedor" }, AGORA))
      .toMatchObject({ estado: "descartado", elegivelEm: APAGAR });
  });

  it("falha agenda nova tentativa com espera crescente", () => {
    const a1 = aoConcluir(emProcesso(), "A", { tipo: "falha", erro: "ML orders 500" }, AGORA)!;
    expect(a1).toMatchObject({ estado: "pendente", tentativas: 1, ultimoErro: "ML orders 500", elegivelEm: AGORA + ESPERAS_MIN[0] * 60_000 });
    const a3 = aoConcluir(emProcesso({ tentativas: 2 }), "A", { tipo: "falha", erro: "x" }, AGORA)!;
    expect(a3).toMatchObject({ tentativas: 3, elegivelEm: AGORA + ESPERAS_MIN[2] * 60_000 });
  });

  it("esgotou as tentativas: fila de falhas, fora da varredura, com o motivo à vista", () => {
    expect(aoConcluir(emProcesso({ tentativas: MAX_TENTATIVAS - 1 }), "A", { tipo: "falha", erro: "token" }, AGORA))
      .toMatchObject({ estado: "falhou", tentativas: MAX_TENTATIVAS, ultimoErro: "token", elegivelEm: APAGAR });
  });

  it("falha com notificação nova no meio: tenta de novo JÁ, mesmo no limite — a mudança é outra", () => {
    expect(aoConcluir(emProcesso({ tentativas: MAX_TENTATIVAS - 1, geracao: 3 }), "A", { tipo: "falha", erro: "x" }, AGORA))
      .toMatchObject({ estado: "pendente", elegivelEm: AGORA });
  });

  it("não é mais o dono (concessão venceu e outro assumiu): não toca", () => {
    expect(aoConcluir(emProcesso({ leaseDono: "B" }), "A", { tipo: "feito", resultado: "x" }, AGORA)).toBeNull();
    expect(aoConcluir(item({ estado: "feito" }), "A", { tipo: "feito", resultado: "x" }, AGORA)).toBeNull();
    expect(aoConcluir(undefined, "A", { tipo: "feito", resultado: "x" }, AGORA)).toBeNull();
  });

  it("erro longo é cortado — o motivo vai pro documento, não um dump", () => {
    const a = aoConcluir(emProcesso(), "A", { tipo: "falha", erro: "x".repeat(1000) }, AGORA)!;
    expect(String(a.ultimoErro)).toHaveLength(300);
  });
});

describe("pedidoEhDoVendedor — o recurso canônico prova a posse", () => {
  it("vendedor do pedido igual ao da conexão: sim (número ou texto)", () => {
    expect(pedidoEhDoVendedor({ seller: { id: 999 } }, "999")).toBe(true);
    expect(pedidoEhDoVendedor({ seller: { id: "999" } }, "999")).toBe(true);
  });

  it("pedido em que a conta foi COMPRADORA: não — nosso token lê, mas não é venda nossa", () => {
    expect(pedidoEhDoVendedor({ seller: { id: 123 }, buyer: { id: 999 } }, "999")).toBe(false);
  });

  it("sem vendedor no pedido, não há o que provar: não", () => {
    expect(pedidoEhDoVendedor({}, "999")).toBe(false);
    expect(pedidoEhDoVendedor({ seller: {} }, "999")).toBe(false);
    expect(pedidoEhDoVendedor({ seller: { id: "" } }, "999")).toBe(false);
  });
});

it("id do item: um por tópico e pedido", () => {
  expect(idDoItem("orders_v2", "123")).toBe("orders_v2:123");
});
