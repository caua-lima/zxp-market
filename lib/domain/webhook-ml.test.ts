import { describe, expect, it } from "vitest";
import { rotuloDaRecusa, validarNotificacao } from "./webhook-ml";

const NOSSO = { sellerId: "2420261535", appId: "1234567890123456" };

function aviso(over: Record<string, unknown> = {}) {
  return {
    resource: "/orders/2000123456",
    topic: "orders_v2",
    user_id: 2420261535,
    application_id: 1234567890123456,
    attempts: 1,
    ...over,
  };
}

describe("validarNotificacao — o que passa", () => {
  it("notificação legítima de venda passa", () => {
    const v = validarNotificacao(aviso(), NOSSO);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.orderId).toBe("2000123456");
      expect(v.tentativa).toBe(1);
    }
  });

  it("número e string do mesmo id são o mesmo vendedor", () => {
    // O ML manda user_id como número; ML_SELLER_ID é string no ambiente.
    expect(validarNotificacao(aviso({ user_id: "2420261535" }), NOSSO).ok).toBe(true);
  });

  it("retentativa do ML é aceita e o número é preservado", () => {
    const v = validarNotificacao(aviso({ attempts: 4 }), NOSSO);
    expect(v.ok && v.tentativa).toBe(4);
  });
});

describe("validarNotificacao — o que a rota aceitava e não devia", () => {
  it("notificação de OUTRO vendedor é recusada", () => {
    /**
     * A rota nem olhava `user_id`. Qualquer corpo com um resource parecido
     * disparava uma consulta à API do ML com o NOSSO token e escritas no
     * Firestore — trabalho pago por nós, sem limite e sem autenticação.
     */
    expect(validarNotificacao(aviso({ user_id: 999999 }), NOSSO))
      .toMatchObject({ ok: false, motivo: "vendedor_diferente" });
  });

  it("notificação de outra APLICAÇÃO é recusada", () => {
    expect(validarNotificacao(aviso({ application_id: 42 }), NOSSO))
      .toMatchObject({ ok: false, motivo: "aplicacao_diferente" });
  });

  it("outro tópico com resource de pedido não vira venda", () => {
    // Antes só o formato do `resource` era olhado: um aviso de envio com um
    // resource parecido entrava como se fosse venda.
    expect(validarNotificacao(aviso({ topic: "shipments" }), NOSSO))
      .toMatchObject({ ok: false, motivo: "topico_nao_tratado" });
  });

  it("resource com sufixo não passa", () => {
    // "/orders/123/../../users/me" batia no match antigo, que não era ancorado.
    expect(validarNotificacao(aviso({ resource: "/orders/123/feedback" }), NOSSO))
      .toMatchObject({ ok: false, motivo: "recurso_invalido" });
    expect(validarNotificacao(aviso({ resource: "/orders/123/../../users/me" }), NOSSO))
      .toMatchObject({ ok: false, motivo: "recurso_invalido" });
  });

  it("corpo vazio, nulo ou torto não passa", () => {
    expect(validarNotificacao(null, NOSSO)).toMatchObject({ ok: false, motivo: "corpo_invalido" });
    expect(validarNotificacao(undefined, NOSSO)).toMatchObject({ ok: false, motivo: "corpo_invalido" });
    expect(validarNotificacao({}, NOSSO)).toMatchObject({ ok: false, motivo: "recurso_invalido" });
  });

  it("resource sem id numérico não passa", () => {
    expect(validarNotificacao(aviso({ resource: "/orders/abc" }), NOSSO).ok).toBe(false);
    expect(validarNotificacao(aviso({ resource: "" }), NOSSO).ok).toBe(false);
  });
});

describe("validarNotificacao — quando não há o que conferir", () => {
  it("sem vendedor configurado, não barra por vendedor", () => {
    // Instalação sem ML_SELLER_ID não pode ficar sem receber venda nenhuma.
    expect(validarNotificacao(aviso({ user_id: 999 }), { appId: NOSSO.appId }).ok).toBe(true);
  });

  it("sem os campos no corpo, não barra por eles", () => {
    // Notificação legada do ML sem application_id continua valendo.
    expect(validarNotificacao({ resource: "/orders/1", topic: "orders_v2" }, NOSSO).ok).toBe(true);
  });

  it("sem topic, assume o tratado — era o comportamento anterior", () => {
    expect(validarNotificacao({ resource: "/orders/1", user_id: 2420261535 }, NOSSO).ok).toBe(true);
  });
});

describe("rotuloDaRecusa", () => {
  it("tópico conhecido vira o próprio nome", () => {
    expect(rotuloDaRecusa(validarNotificacao(aviso({ topic: "shipments" }), NOSSO))).toBe("shipments");
  });

  it("tópico desconhecido vira 'outro' — não entra id nenhum na contagem", () => {
    const r = rotuloDaRecusa(validarNotificacao(aviso({ topic: "coisa-nova" }), NOSSO));
    expect(r).toBe("outro");
  });

  it("recusa por vendedor aparece como tal", () => {
    expect(rotuloDaRecusa(validarNotificacao(aviso({ user_id: 9 }), NOSSO))).toBe("vendedor_diferente");
  });

  it("aceito é aceito", () => {
    expect(rotuloDaRecusa(validarNotificacao(aviso(), NOSSO))).toBe("aceito");
  });
});
