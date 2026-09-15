import { describe, expect, it } from "vitest";
import {
  ehTerminal,
  escolherLote,
  eventoEhMaisNovo,
  JANELA_AJUSTE_DIAS,
  precisaReconferir,
} from "./reconciliacao";

const AGORA = Date.parse("2026-09-15T12:00:00Z");
const diasAtras = (n: number) => new Date(AGORA - n * 86400000).toISOString();

describe("terminal na logistica nao e fechado no financeiro", () => {
  it("entregue ONTEM ainda e reconferido — o ML ajusta frete depois da entrega", () => {
    /**
     * `terminalShipmentIds` montava o conjunto de envios que nao precisam mais
     * ser buscados e, a partir dali, o pedido nunca mais era consultado. Mas o
     * que congela e o STATUS, nao o dinheiro: repesagem do pacote, sobretaxa,
     * estorno e correcao de tarifa acontecem DEPOIS da entrega.
     */
    expect(precisaReconferir({
      orderId: "1", statusEnvio: "delivered", temDadoFinanceiro: true,
      finalizadoEm: diasAtras(1), ultimaTentativa: null,
    }, AGORA)).toBe(true);
  });

  it("sem o dado financeiro, tenta SEMPRE — buraco nao e zero", () => {
    /**
     * Um pedido cujo /costs falhou na hora ficava com frete ausente E status
     * terminal. Nunca mais era tentado: o custo de envio daquela venda
     * simplesmente nao existia, permanentemente. E frete ausente vira margem
     * inflada.
     */
    expect(precisaReconferir({
      orderId: "1", statusEnvio: "delivered", temDadoFinanceiro: false,
      finalizadoEm: diasAtras(400), ultimaTentativa: AGORA - 1000,
    }, AGORA)).toBe(true);
  });

  it("passada a janela de ajuste, para de perguntar", () => {
    // Depois disso o ML nao mexe mais; continuar perguntando gasta chamada a
    // toa, que e o problema oposto e tambem e um problema.
    expect(precisaReconferir({
      orderId: "1", statusEnvio: "delivered", temDadoFinanceiro: true,
      finalizadoEm: diasAtras(JANELA_AJUSTE_DIAS + 1), ultimaTentativa: null,
    }, AGORA)).toBe(false);
  });

  it("dentro da janela, no maximo uma vez por dia", () => {
    const base = {
      orderId: "1", statusEnvio: "delivered" as const, temDadoFinanceiro: true,
      finalizadoEm: diasAtras(3),
    };
    expect(precisaReconferir({ ...base, ultimaTentativa: AGORA - 2 * 3600 * 1000 }, AGORA)).toBe(false);
    expect(precisaReconferir({ ...base, ultimaTentativa: AGORA - 25 * 3600 * 1000 }, AGORA)).toBe(true);
  });

  it("envio ainda em transito segue o fluxo normal", () => {
    expect(precisaReconferir({ orderId: "1", statusEnvio: "shipped" }, AGORA)).toBe(true);
    expect(precisaReconferir({ orderId: "1", statusEnvio: "" }, AGORA)).toBe(true);
  });

  it("sem data de finalizacao, reconfere — nao da pra afirmar que passou a janela", () => {
    expect(precisaReconferir({
      orderId: "1", statusEnvio: "cancelled", temDadoFinanceiro: true, finalizadoEm: null,
    }, AGORA)).toBe(true);
  });
});

describe("ehTerminal", () => {
  it("reconhece os tres estados de fim de linha", () => {
    for (const s of ["delivered", "not_delivered", "cancelled", "DELIVERED", " delivered "]) {
      expect(ehTerminal(s), s).toBe(true);
    }
  });

  it("qualquer outra coisa nao e terminal", () => {
    for (const s of ["shipped", "ready_to_ship", "", null, undefined]) {
      expect(ehTerminal(s), String(s)).toBe(false);
    }
  });
});

describe("escolherLote — fome por limite fixo", () => {
  it("o nunca tentado vem antes de todos", () => {
    const r = escolherLote([
      { orderId: "b", ultimaTentativa: AGORA - 1000 },
      { orderId: "a", ultimaTentativa: null },
    ], 2);
    expect(r.map((x) => x.orderId)).toEqual(["a", "b"]);
  });

  it("a fila GIRA — quem ficou de fora entra na rodada seguinte", () => {
    /**
     * Era `.slice(0, 250)` sobre a lista na ordem natural. Com mais de 250
     * pendentes, a rodada pegava SEMPRE os mesmos primeiros 250, na mesma
     * ordem, toda vez. Se alguns falhassem de forma persistente, os demais
     * nunca eram alcancados — fome permanente, com o job reportando sucesso.
     */
    const todos = [
      { orderId: "a", ultimaTentativa: 100 },
      { orderId: "b", ultimaTentativa: 200 },
      { orderId: "c", ultimaTentativa: 300 },
    ];
    const rodada1 = escolherLote(todos, 2);
    expect(rodada1.map((x) => x.orderId)).toEqual(["a", "b"]);

    // Depois de tentados, a e b viram os mais RECENTES e cedem a vez.
    const depois = [
      { orderId: "a", ultimaTentativa: AGORA },
      { orderId: "b", ultimaTentativa: AGORA },
      { orderId: "c", ultimaTentativa: 300 },
    ];
    expect(escolherLote(depois, 2).map((x) => x.orderId)).toEqual(["c", "a"]);
  });

  it("desempate estavel — sem ele a fila nao gira de verdade", () => {
    const r = escolherLote([
      { orderId: "z", ultimaTentativa: 100 },
      { orderId: "a", ultimaTentativa: 100 },
    ], 2);
    expect(r.map((x) => x.orderId)).toEqual(["a", "z"]);
  });

  it("limite zero ou invalido nao devolve ninguem", () => {
    const c = [{ orderId: "a" }];
    expect(escolherLote(c, 0)).toEqual([]);
    expect(escolherLote(c, -5)).toEqual([]);
    expect(escolherLote(c, Number.NaN)).toEqual([]);
  });

  it("nao muda o array recebido", () => {
    const c = [{ orderId: "b", ultimaTentativa: 200 }, { orderId: "a", ultimaTentativa: 100 }];
    escolherLote(c, 2);
    expect(c.map((x) => x.orderId)).toEqual(["b", "a"]);
  });
});

describe("eventoEhMaisNovo — evento antigo nao pode regredir estado novo", () => {
  it("mais novo passa", () => {
    expect(eventoEhMaisNovo("2026-09-15T10:00:00Z", "2026-09-15T11:00:00Z")).toBe(true);
  });

  it("mais VELHO nao sobrescreve", () => {
    /**
     * Webhook e sync correm juntos e a ordem de chegada nao e garantida. Uma
     * resposta atrasada do ML traz o estado de dez minutos atras; gravar assim
     * mesmo faz o pedido REGREDIR — de entregue pra a caminho, de estornado
     * pra pago.
     */
    expect(eventoEhMaisNovo("2026-09-15T11:00:00Z", "2026-09-15T10:00:00Z")).toBe(false);
  });

  it("mesmo instante passa — reprocessar o mesmo evento e inofensivo", () => {
    expect(eventoEhMaisNovo("2026-09-15T10:00:00Z", "2026-09-15T10:00:00Z")).toBe(true);
  });

  it("sem carimbo no que chega, nao regride", () => {
    expect(eventoEhMaisNovo("2026-09-15T10:00:00Z", null)).toBe(false);
    expect(eventoEhMaisNovo("2026-09-15T10:00:00Z", "ontem")).toBe(false);
  });

  it("sem carimbo no gravado, qualquer coisa datada e progresso", () => {
    expect(eventoEhMaisNovo(null, "2026-09-15T10:00:00Z")).toBe(true);
  });
});
