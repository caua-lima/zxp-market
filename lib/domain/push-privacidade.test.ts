import { describe, expect, it } from "vitest";
import {
  CAMPOS_PUBLICOS_DO_EVENTO,
  contemFinanceiro,
  espelhoDivergente,
  nivelDoDestinatario,
  nivelEfetivoDoPush,
  redigirEvento,
  redigirPush,
  severidadePublica,
  tipoPublico,
} from "./notificacao-publico";
import { serializarPayload } from "./push-payload";
import {
  buildCancelContent,
  buildGroupedSalesContent,
  buildReturnCompletedContent,
  buildSaleContent,
  buildTaskAssignedContent,
  type NotificationEvent,
  type NotificationEventType,
  type SalePushPayload,
} from "./notifications";
import type { Papel } from "./types";

/**
 * A matriz de privacidade do push: QUEM recebe × PREFERÊNCIA × TIPO de aviso,
 * conferida no payload que de fato viaja (`serializarPayload`), não no objeto
 * que vem antes dele.
 *
 * O buraco era duplo: `showFinancialValuesInPush` era salva e ignorada, e a
 * redação só removia quatro campos conhecidos, mantendo `type` — que por si só
 * diz "esta venda deu prejuízo".
 */

type Venda = { type: NotificationEventType; gross: number; lucro: number | null; margem: number | null };

const VENDAS: Venda[] = [
  { type: "sale_paid", gross: 129.9, lucro: 32.1, margem: 24.7 },
  { type: "sale_high_value", gross: 1290.5, lucro: 400.25, margem: 31 },
  { type: "sale_low_margin", gross: 89.9, lucro: 3.1, margem: 3.4 },
  { type: "sale_negative_margin", gross: 79.9, lucro: -18.4, margem: -23 },
];

function pushDeVenda(v: Venda): SalePushPayload {
  const c = buildSaleContent({
    type: v.type, grossAmount: v.gross, estimatedProfit: v.lucro, estimatedMargin: v.margem,
    metaMargem: null, productName: "Menta Stronger", itemCount: 1,
  });
  return {
    eventId: "sale_paid:2000123456", type: v.type, title: c.title, body: c.body,
    tag: "sale-2000123456", orderId: "2000123456", deepLink: "/?tab=pedidos&order=2000123456",
    productName: "Menta Stronger",
    grossAmount: v.gross.toFixed(2),
    estimatedProfit: v.lucro == null ? undefined : v.lucro.toFixed(2),
    estimatedMargin: v.margem == null ? undefined : v.margem.toFixed(1),
    financialState: v.lucro == null ? "unavailable" : "estimated",
    timestamp: "1757000000000",
  };
}

const OUTROS: SalePushPayload[] = [
  {
    eventId: "sale_cancelled:2000123456", type: "sale_cancelled", ...buildCancelContent("Menta Stronger", 1, 129.9),
    tag: "sale-2000123456", orderId: "2000123456", deepLink: "/?tab=pedidos&order=2000123456",
    productName: "Menta Stronger", grossAmount: "129.90", timestamp: "1757000000000",
  },
  {
    eventId: "return_completed:1", type: "return_completed", ...buildReturnCompletedContent("Menta Stronger", 1),
    tag: "return-1", deepLink: "/?tab=devolucoes", productName: "Menta Stronger", timestamp: "1757000000000",
  },
  {
    eventId: "task_assigned:t1:2", type: "task_assigned", ...buildTaskAssignedContent("Conferir o custo da Menta", "alta", "2026-09-30"),
    tag: "task-t1", deepLink: "/?tab=tarefas&task=t1", timestamp: "1757000000000",
  },
];

const RESUMO: SalePushPayload = {
  ...pushDeVenda(VENDAS[1]),
  eventId: "sale_paid:2000123457",
  ...buildGroupedSalesContent(4, 4132.4, 2),
  tag: "sales-summary-1",
  resumoCount: 4,
  grossAmount: undefined, estimatedProfit: undefined, estimatedMargin: undefined,
};

type Destinatario = { rotulo: string; papel: Papel; mostrarValores: boolean; veFinanceiro: boolean };
const DESTINATARIOS: Destinatario[] = [
  { rotulo: "owner com a preferência ligada", papel: "owner", mostrarValores: true, veFinanceiro: true },
  { rotulo: "owner com a preferência desligada", papel: "owner", mostrarValores: false, veFinanceiro: false },
  { rotulo: "member com a preferência ligada", papel: "member", mostrarValores: true, veFinanceiro: false },
  { rotulo: "member com a preferência desligada", papel: "member", mostrarValores: false, veFinanceiro: false },
];

function saida(p: SalePushPayload, d: Destinatario): Record<string, string> {
  const nivel = nivelEfetivoDoPush(nivelDoDestinatario(d.papel, []), d.mostrarValores);
  return serializarPayload(redigirPush(p, nivel));
}

const TODOS = [...VENDAS.map(pushDeVenda), ...OUTROS, RESUMO];

describe("matriz de privacidade do push (destinatário × preferência × tipo)", () => {
  for (const d of DESTINATARIOS) {
    describe(d.rotulo, () => {
      for (const p of TODOS) {
        const nome = `${p.type}${p.resumoCount ? " (resumo)" : ""}`;

        if (d.veFinanceiro) {
          it(`${nome}: recebe o payload completo`, () => {
            const s = saida(p, d);
            expect(s.title).toBe(p.title);
            expect(s.body).toBe(p.body);
            expect(s.type).toBe(p.type);
            expect(s.grossAmount).toBe(p.grossAmount ?? "");
            expect(s.estimatedProfit).toBe(p.estimatedProfit ?? "");
          });
        } else {
          it(`${nome}: nenhum valor no payload que viaja`, () => {
            const s = saida(p, d);
            expect(s.grossAmount).toBe("");
            expect(s.estimatedProfit).toBe("");
            expect(s.estimatedMargin).toBe("");
            expect(s.financialState).toBe("");
            for (const [chave, valor] of Object.entries(s)) {
              expect(contemFinanceiro(valor), `${chave}="${valor}" carrega dinheiro`).toBe(false);
            }
            const tudo = JSON.stringify(s);
            for (const numero of ["129.90", "129,90", "1290.5", "1.290,50", "32.10", "18.4", "18,40", "4132", "4.132,40", "24.7"]) {
              expect(tudo.includes(numero), `número ${numero} vazou`).toBe(false);
            }
          });

          it(`${nome}: o type não revela a classificação financeira`, () => {
            const s = saida(p, d);
            expect(["sale_high_value", "sale_low_margin", "sale_negative_margin"]).not.toContain(s.type);
          });
        }
      }
    });
  }

  it("as quatro classificações de venda viram exatamente o mesmo aviso pra quem não vê financeiro", () => {
    const d = DESTINATARIOS[2];
    const saidas = VENDAS.map((v) => saida(pushDeVenda(v), d));
    for (const s of saidas) {
      expect(s.type).toBe("sale_paid");
      expect(s.title).toBe(saidas[0].title);
      expect(s.body).toBe(saidas[0].body);
    }
  });

  it("o resumo agrupado diz quantas vendas sem dizer quanto faturaram", () => {
    const s = saida(RESUMO, DESTINATARIOS[3]);
    expect(s.title).toBe("4 novas vendas confirmadas");
    expect(s.body).not.toContain("R$");
  });

  it("o que o aparelho precisa pra funcionar continua: eventId, tag, deepLink, itens", () => {
    const itensJson = JSON.stringify([{ title: "A", quantity: 1 }, { title: "B", quantity: 2 }]);
    const s = saida({ ...pushDeVenda(VENDAS[3]), itensJson }, DESTINATARIOS[1]);
    expect(s.eventId).toBe("sale_paid:2000123456");
    expect(s.tag).toBe("sale-2000123456");
    expect(s.deepLink).toBe("/?tab=pedidos&order=2000123456");
    expect(s.itensJson).toBe(itensJson);
  });
});

describe("lista de permissão: campo novo não vaza por esquecimento", () => {
  it("um campo que ninguém previu fica de fora do push", () => {
    const p = { ...pushDeVenda(VENDAS[0]), custoTotal: "77.10", margemLiquida: "12.3" } as SalePushPayload;
    const s = saida(p, DESTINATARIOS[2]);
    expect(Object.keys(s)).not.toContain("custoTotal");
    expect(JSON.stringify(s)).not.toContain("77.10");
  });

  it("nem o objeto redigido carrega o campo desconhecido", () => {
    const p = { ...pushDeVenda(VENDAS[0]), custoTotal: "77.10" } as SalePushPayload;
    expect(redigirPush(p, "sem_financeiro")).not.toHaveProperty("custoTotal");
  });
});

describe("nivelEfetivoDoPush — a preferência só pode REDUZIR", () => {
  it("acesso completo e preferência ligada: completo", () => {
    expect(nivelEfetivoDoPush("completo", true)).toBe("completo");
  });
  it("acesso completo e preferência desligada: sem financeiro", () => {
    expect(nivelEfetivoDoPush("completo", false)).toBe("sem_financeiro");
  });
  it("sem acesso, ligar a preferência NÃO concede nada", () => {
    expect(nivelEfetivoDoPush("sem_financeiro", true)).toBe("sem_financeiro");
  });
});

describe("tipoPublico / severidadePublica", () => {
  it("vendas classificadas viram sale_paid", () => {
    expect(tipoPublico("sale_negative_margin")).toBe("sale_paid");
    expect(tipoPublico("sale_high_value")).toBe("sale_paid");
    expect(tipoPublico("sale_low_margin")).toBe("sale_paid");
  });
  it("tipo desconhecido vira system", () => {
    expect(tipoPublico("coisa_nova")).toBe("system");
  });
  it("severidade de venda é sempre success — danger/warning seriam prejuízo/margem", () => {
    expect(severidadePublica("sale_negative_margin", "danger")).toBe("success");
    expect(severidadePublica("sale_low_margin", "warning")).toBe("success");
  });
  it("cancelamento mantém a severidade — ela não carrega dinheiro", () => {
    expect(severidadePublica("sale_cancelled", "danger")).toBe("danger");
  });
  it("severidade inválida cai na do tipo", () => {
    expect(severidadePublica("sale_cancelled", "vermelhissimo")).toBe("warning");
  });
});

describe("redigirEvento — o espelho que o member lê", () => {
  const evento = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
    id: "sale_paid:2000123456", type: "sale_negative_margin", severity: "danger", entityType: "order",
    entityId: "2000123456", dedupeKey: "sale_paid:2000123456",
    title: "Venda confirmada · revisar margem", body: "Menta Stronger · prejuízo estimado de R$ 18,40",
    orderId: "2000123456", productName: "Menta Stronger", grossAmount: 79.9, estimatedProfit: -18.4,
    estimatedMargin: -23, returnAmount: 0, financialState: "estimated", deepLink: "/?tab=pedidos&order=2000123456",
    createdAt: 1757000000000, readBy: { "a@zxp.com": 1 }, dismissedBy: {},
    delivery: { pushError: "interno" },
    ...over,
  });

  it("type e severity não contam que a venda deu prejuízo", () => {
    const r = redigirEvento(evento());
    expect(r.type).toBe("sale_paid");
    expect(r.severity).toBe("success");
  });

  it("título e corpo sem dinheiro", () => {
    const r = redigirEvento(evento());
    expect(contemFinanceiro(String(r.title))).toBe(false);
    expect(contemFinanceiro(String(r.body))).toBe(false);
  });

  it("só os campos da lista de permissão passam", () => {
    const r = redigirEvento({ ...evento(), custoTotal: 40, segredo: "x" } as Partial<NotificationEvent>);
    const permitidos = new Set<string>([...CAMPOS_PUBLICOS_DO_EVENTO, "type", "severity", "title", "body"]);
    for (const k of Object.keys(r)) expect(permitidos.has(k), `campo ${k} não é público`).toBe(true);
    expect(r).not.toHaveProperty("custoTotal");
    expect(r).not.toHaveProperty("grossAmount");
    expect(r).not.toHaveProperty("estimatedProfit");
    expect(r).not.toHaveProperty("financialState");
    expect(r).not.toHaveProperty("delivery");
  });

  it("a marca de lido e o que a Central precisa seguem", () => {
    const r = redigirEvento(evento());
    expect(r.readBy).toEqual({ "a@zxp.com": 1 });
    expect(r.deepLink).toBe("/?tab=pedidos&order=2000123456");
    expect(r.productName).toBe("Menta Stronger");
  });

  it("cancelamento mantém o tipo e a severidade", () => {
    const r = redigirEvento(evento({ type: "sale_cancelled", severity: "danger" }));
    expect(r.type).toBe("sale_cancelled");
    expect(r.severity).toBe("danger");
  });
});

describe("espelhoDivergente — a migração só mexe no que precisa", () => {
  const evento = (): Partial<NotificationEvent> => ({
    id: "sale_paid:1", type: "sale_negative_margin", severity: "danger", entityType: "order", entityId: "1",
    dedupeKey: "sale_paid:1", title: "x", body: "Menta · prejuízo de R$ 1,00", productName: "Menta",
    grossAmount: 10, deepLink: "/", createdAt: 1,
  });

  it("espelho ausente diverge (tem que ser criado)", () => {
    expect(espelhoDivergente(redigirEvento(evento()), undefined)).toBe(true);
  });

  it("espelho que já é a projeção de hoje NÃO diverge — a marca de lido não conta", () => {
    const atual = { ...redigirEvento(evento()), readBy: { "a@zxp.com": 5 }, dismissedBy: {}, createdAt: 999 };
    expect(espelhoDivergente(redigirEvento(evento()), atual)).toBe(false);
  });

  it("espelho ANTIGO (gravado pela lista negra) diverge: o type vazava o prejuízo", () => {
    const antigo = { ...redigirEvento(evento()), type: "sale_negative_margin", severity: "danger", delivery: { pushError: "x" } };
    expect(espelhoDivergente(redigirEvento(evento()), antigo)).toBe(true);
  });

  it("campo extra no espelho atual (que a projeção não tem) também diverge", () => {
    expect(espelhoDivergente(redigirEvento(evento()), { ...redigirEvento(evento()), delivery: {} })).toBe(true);
  });
});
