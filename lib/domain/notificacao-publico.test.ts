import { describe, expect, it } from "vitest";
import {
  contemFinanceiro,
  nivelDoDestinatario,
  redigirPush,
  separarPorAcesso,
  type AcessoDoDestinatario,
} from "./notificacao-publico";
import { buildSaleContent } from "./notifications";
import type { NotificationEventType, SalePushPayload } from "./notifications";

const TIPOS: NotificationEventType[] = [
  "sale_paid", "sale_high_value", "sale_low_margin", "sale_negative_margin",
  "sale_cancelled", "return_opened", "return_completed", "sync_warning",
  "task_assigned", "stock_low", "milestone",
];

function pushDe(over: Partial<SalePushPayload> = {}): SalePushPayload {
  return {
    eventId: "sale_paid:2000123456",
    type: "sale_paid",
    title: "Nova venda confirmada",
    body: "Menta Stronger · R$ 129,90",
    tag: "sale-2000123456",
    deepLink: "/?aba=vendas",
    productName: "Menta Stronger",
    grossAmount: "129.90",
    estimatedProfit: "32.10",
    estimatedMargin: "24.7",
    financialState: "estimated",
    timestamp: "1757000000000",
    ...over,
  };
}

describe("nivelDoDestinatario", () => {
  it("owner vê tudo", () => {
    expect(nivelDoDestinatario("owner", [])).toBe("completo");
  });

  it("member NÃO vê financeiro — é o papel que existe pra isso", () => {
    expect(nivelDoDestinatario("member", [])).toBe("sem_financeiro");
  });

  it("partner vê, como já via nas telas", () => {
    expect(nivelDoDestinatario("partner", [])).toBe("completo");
  });
});

describe("redigirPush — o dinheiro que chegava no celular do member", () => {
  it("owner recebe o payload intacto", () => {
    const p = pushDe();
    expect(redigirPush(p, "completo")).toBe(p);
  });

  it("member não recebe valor, lucro nem margem", () => {
    const r = redigirPush(pushDe(), "sem_financeiro");
    expect(r.grossAmount).toBeUndefined();
    expect(r.estimatedProfit).toBeUndefined();
    expect(r.estimatedMargin).toBeUndefined();
    expect(r.financialState).toBeUndefined();
  });

  it("o dinheiro também sai do texto, não só dos campos", () => {
    // O corpo vinha pronto com o valor escrito: limpar só os campos deixaria
    // "Menta Stronger · R$ 129,90" aparecendo na tela de bloqueio.
    const r = redigirPush(pushDe(), "sem_financeiro");
    expect(r.body).not.toContain("R$");
    expect(r.body).toBe("Menta Stronger");
  });

  it("'alto valor' e 'margem em atenção' viram o mesmo título neutro", () => {
    // O rótulo por si só já é informação financeira, mesmo sem número.
    for (const t of ["sale_paid", "sale_high_value", "sale_low_margin", "sale_negative_margin"] as const) {
      expect(redigirPush(pushDe({ type: t }), "sem_financeiro").title).toBe("Nova venda confirmada");
    }
  });

  it("nenhum tipo de evento deixa dinheiro passar", () => {
    for (const type of TIPOS) {
      const r = redigirPush(pushDe({ type, title: "Venda de R$ 999,00", body: "lucro R$ 500,00 · margem 50%" }), "sem_financeiro");
      expect(contemFinanceiro(r.title), `título vazou em ${type}: ${r.title}`).toBe(false);
      expect(contemFinanceiro(r.body), `corpo vazou em ${type}: ${r.body}`).toBe(false);
    }
  });

  it("tipo desconhecido cai no genérico em vez de vazar", () => {
    const r = redigirPush(pushDe({ type: "tipo_que_nao_existe" as NotificationEventType }), "sem_financeiro");
    expect(contemFinanceiro(r.body)).toBe(false);
    expect(r.title).toBe("Novo aviso");
  });

  it("nada que o aparelho precisa pra funcionar é perdido", () => {
    const r = redigirPush(pushDe(), "sem_financeiro");
    expect(r.eventId).toBe("sale_paid:2000123456");
    expect(r.tag).toBe("sale-2000123456");
    expect(r.deepLink).toBe("/?aba=vendas");
  });

  it("itens (nome e quantidade, sem preço) continuam", () => {
    const itensJson = JSON.stringify([{ title: "Menta Stronger", quantity: 2 }]);
    expect(redigirPush(pushDe({ itensJson }), "sem_financeiro").itensJson).toBe(itensJson);
  });
});

describe("redigirPush contra o texto REAL do app", () => {
  it("o texto que buildSaleContent produz não sobrevive à redação", () => {
    /**
     * Amarra a redação ao gerador de verdade: se um ramo novo de
     * buildSaleContent escrever dinheiro no corpo, este teste pega.
     */
    const casos = [
      { grossAmount: 1290, estimatedProfit: 320, estimatedMargin: 24.8 },
      { grossAmount: 12900, estimatedProfit: 40, estimatedMargin: 3.1 },
      { grossAmount: 500, estimatedProfit: -80, estimatedMargin: -16 },
      { grossAmount: 500, estimatedProfit: null, estimatedMargin: null },
    ];
    for (const c of casos) {
      const conteudo = buildSaleContent({
        grossAmount: c.grossAmount,
        estimatedProfit: c.estimatedProfit,
        estimatedMargin: c.estimatedMargin,
        itens: [{ title: "Menta Stronger", quantity: 1 }],
      } as Parameters<typeof buildSaleContent>[0]);

      const r = redigirPush(pushDe({ title: conteudo.title, body: conteudo.body }), "sem_financeiro");
      expect(contemFinanceiro(r.title + " " + r.body), `vazou: ${r.title} / ${r.body}`).toBe(false);
    }
  });
});

describe("contemFinanceiro", () => {
  it("pega real, percentual e número com centavos", () => {
    expect(contemFinanceiro("R$ 129,90")).toBe(true);
    expect(contemFinanceiro("margem 24,7%")).toBe(true);
    expect(contemFinanceiro("margem 6%")).toBe(true);
    expect(contemFinanceiro("1.234,56 no mês")).toBe(true);
  });

  it("não acusa texto comum", () => {
    expect(contemFinanceiro("Menta Stronger")).toBe(false);
    expect(contemFinanceiro("Nova venda confirmada")).toBe(false);
    expect(contemFinanceiro("Pedido 2000123456")).toBe(false);
  });
});

describe("separarPorAcesso — revogação", () => {
  const acessos = new Map<string, AcessoDoDestinatario>([
    ["dono@zxp.com", { papel: "owner", permissoesEdicao: [] }],
    ["socio@zxp.com", { papel: "member", permissoesEdicao: [] }],
  ]);

  it("quem perdeu o acesso não recebe, mesmo com o token vivo", () => {
    /**
     * Este era o buraco: o envio lia `pushTokens` inteira. Tirar alguém de
     * `controleAcesso` não parava nada — o aparelho seguia recebendo o
     * faturamento da empresa até o token do FCM morrer sozinho.
     */
    const r = separarPorAcesso(
      [{ email: "dono@zxp.com" }, { email: "demitido@zxp.com" }],
      acessos,
    );
    expect(r.semAcesso).toEqual([{ email: "demitido@zxp.com" }]);
    expect(r.porNivel.get("completo")).toEqual([{ email: "dono@zxp.com" }]);
  });

  it("cada nível vai pro seu grupo", () => {
    const r = separarPorAcesso(
      [{ email: "dono@zxp.com" }, { email: "socio@zxp.com" }],
      acessos,
    );
    expect(r.porNivel.get("completo")).toHaveLength(1);
    expect(r.porNivel.get("sem_financeiro")).toEqual([{ email: "socio@zxp.com" }]);
  });

  it("registro sem e-mail não recebe — órfão não é autorização", () => {
    const r = separarPorAcesso([{ email: "" }], acessos);
    expect(r.semAcesso).toHaveLength(1);
  });

  it("caixa do e-mail não dribla a lista de acesso", () => {
    const r = separarPorAcesso([{ email: "Dono@ZXP.com" }], acessos);
    expect(r.semAcesso).toHaveLength(0);
    expect(r.porNivel.get("completo")).toHaveLength(1);
  });

  it("acesso vazio: ninguém recebe", () => {
    const r = separarPorAcesso([{ email: "dono@zxp.com" }], new Map());
    expect(r.semAcesso).toHaveLength(1);
    expect(r.porNivel.size).toBe(0);
  });
});
