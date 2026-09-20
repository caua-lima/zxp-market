import { describe, expect, it } from "vitest";
import { MAX_AVISOS_POR_SYNC, instanteDaConfirmacao } from "./confirmacao-de-venda";
import { IDADE_MAX_VENDA_MS, vendaRecente } from "@/lib/ml/notificar-venda";

const AGORA = Date.parse("2026-09-22T15:00:00.000Z");
const iso = (msAtras: number) => new Date(AGORA - msAtras).toISOString();
const H = 3600_000;

describe("instanteDaConfirmacao", () => {
  it("usa a aprovação do pagamento, não a criação do pedido", () => {
    const pedido = { date_created: iso(30 * H), payments: [{ status: "approved", date_approved: iso(60_000) }] };
    expect(instanteDaConfirmacao(pedido)).toBe(iso(60_000));
  });

  it("várias parcelas: vale a ÚLTIMA aprovada — o pedido só está confirmado quando a segunda entra", () => {
    const pedido = {
      date_created: iso(48 * H),
      payments: [
        { status: "approved", date_approved: iso(30 * H) },
        { status: "approved", date_approved: iso(2 * 60_000) },
        { status: "rejected", date_approved: iso(1_000) },
      ],
    };
    expect(instanteDaConfirmacao(pedido)).toBe(iso(2 * 60_000));
  });

  it("pagamento que NÃO foi aprovado não conta", () => {
    const pedido = { date_created: iso(5 * H), payments: [{ status: "pending", date_approved: iso(1_000) }] };
    expect(instanteDaConfirmacao(pedido)).toBe(String(pedido.date_created));
  });

  it("sem pagamentos, ou com data ilegível: cai na criação (o comportamento anterior)", () => {
    expect(instanteDaConfirmacao({ date_created: iso(H) })).toBe(iso(H));
    expect(instanteDaConfirmacao({ date_created: iso(H), payments: [] })).toBe(iso(H));
    expect(instanteDaConfirmacao({ date_created: iso(H), payments: [{ status: "approved", date_approved: "ontem" }] })).toBe(iso(H));
    expect(instanteDaConfirmacao({ date_created: iso(H), payments: "lixo" })).toBe(iso(H));
  });

  it("sem nada: string vazia (que vendaRecente recusa)", () => {
    expect(instanteDaConfirmacao({})).toBe("");
  });
});

describe("o que vira aviso — pagamento tardio vs. importação histórica", () => {
  const avisa = (pedido: Parameters<typeof instanteDaConfirmacao>[0]) => vendaRecente(instanteDaConfirmacao(pedido), AGORA);

  it("pedido criado ONTEM e pago AGORA avisa (antes era descartado como venda antiga)", () => {
    const pedido = { date_created: iso(26 * H), payments: [{ status: "approved", date_approved: iso(90_000) }] };
    expect(vendaRecente(pedido.date_created, AGORA)).toBe(false); // a regra antiga: descartava
    expect(avisa(pedido)).toBe(true);
  });

  it("IMPORTAÇÃO de cem pedidos antigos já pagos não avisa nenhum", () => {
    const antigos = Array.from({ length: 100 }, (_, i) => ({
      date_created: iso((30 + i) * H), payments: [{ status: "approved", date_approved: iso((29 + i) * H) }],
    }));
    expect(antigos.filter(avisa)).toHaveLength(0);
  });

  it("pedido criado agora e pago agora: avisa, como sempre", () => {
    expect(avisa({ date_created: iso(60_000), payments: [{ status: "approved", date_approved: iso(30_000) }] })).toBe(true);
  });

  it("o teto de idade continua valendo: pagamento aprovado há mais de 12 h não avisa", () => {
    expect(avisa({ date_created: iso(40 * H), payments: [{ status: "approved", date_approved: iso(IDADE_MAX_VENDA_MS + 60_000) }] })).toBe(false);
  });

  it("existe um segundo teto por sync, contra lote enorme de datas recentes", () => {
    expect(MAX_AVISOS_POR_SYNC).toBeGreaterThan(0);
    expect(MAX_AVISOS_POR_SYNC).toBeLessThanOrEqual(50);
  });
});
