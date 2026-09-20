import { describe, expect, it } from "vitest";
import {
  LEASE_MS,
  MAX_TENTATIVAS_DESTINO,
  STATUS_TERMINAIS,
  avaliarEntrega,
  esperaDoRetry,
  patchEncerrada,
  patchReivindicada,
  patchResultado,
  resumirEntregas,
  type EntregaDestino,
  type StatusEntrega,
} from "./entrega-destino";

const AGORA = 1_800_000_000_000;
const HORA = 3600_000;

function entrega(over: Partial<EntregaDestino> = {}): EntregaDestino {
  return { status: "pending", tentativas: 0, proximaTentativaEm: AGORA - 1, expiraEm: AGORA + 6 * HORA, ...over };
}

describe("avaliarEntrega", () => {
  it("destino novo e devido: reivindica a tentativa 1", () => {
    expect(avaliarEntrega(entrega(), AGORA)).toEqual({ acao: "reivindicar", tentativa: 1 });
  });

  it("terminal nunca é tocado — accepted não volta a ser enviado", () => {
    for (const status of STATUS_TERMINAIS) {
      expect(avaliarEntrega(entrega({ status }), AGORA), status).toEqual({ acao: "pular", motivo: "terminal" });
    }
  });

  it("concessão ativa: outro worker está enviando, recua", () => {
    expect(avaliarEntrega(entrega({ status: "leased", leaseAte: AGORA + 1000, tentativas: 1 }), AGORA))
      .toEqual({ acao: "pular", motivo: "concessao_ativa" });
  });

  it("concessão VENCIDA: assume, e a tentativa conta (worker que morreu não dá tentativa grátis)", () => {
    expect(avaliarEntrega(entrega({ status: "leased", leaseAte: AGORA - 1, tentativas: 1 }), AGORA))
      .toEqual({ acao: "reivindicar", tentativa: 2 });
  });

  it("retry ainda não venceu: espera", () => {
    expect(avaliarEntrega(entrega({ status: "retry_scheduled", proximaTentativaEm: AGORA + 5000, tentativas: 1 }), AGORA))
      .toEqual({ acao: "pular", motivo: "ainda_nao" });
  });

  it("retry vencido: volta com a tentativa seguinte", () => {
    expect(avaliarEntrega(entrega({ status: "retry_scheduled", proximaTentativaEm: AGORA - 5000, tentativas: 2 }), AGORA))
      .toEqual({ acao: "reivindicar", tentativa: 3 });
  });

  it("passou da validade: expira em vez de enviar", () => {
    expect(avaliarEntrega(entrega({ expiraEm: AGORA - 1 }), AGORA)).toEqual({ acao: "expirar" });
    expect(avaliarEntrega(entrega({ expiraEm: AGORA }), AGORA)).toEqual({ acao: "expirar" });
  });

  it("a validade vale mesmo com tentativas sobrando", () => {
    expect(avaliarEntrega(entrega({ status: "retry_scheduled", tentativas: 1, expiraEm: AGORA - 10 }), AGORA))
      .toEqual({ acao: "expirar" });
  });

  it("tentativas esgotadas: encerra, não insiste", () => {
    expect(avaliarEntrega(entrega({ status: "retry_scheduled", tentativas: MAX_TENTATIVAS_DESTINO }), AGORA))
      .toEqual({ acao: "esgotar" });
  });
});

describe("esperaDoRetry — exponencial com jitter", () => {
  it("cresce com as tentativas e respeita o teto", () => {
    const meio = 0.5; // fator 1.0
    expect(esperaDoRetry(1, meio)).toBe(30_000);
    expect(esperaDoRetry(2, meio)).toBe(60_000);
    expect(esperaDoRetry(3, meio)).toBe(120_000);
    expect(esperaDoRetry(10, meio)).toBe(600_000);
  });

  it("o jitter espalha em ±25%", () => {
    expect(esperaDoRetry(1, 0)).toBe(22_500);
    expect(esperaDoRetry(1, 0.999999)).toBeGreaterThan(37_400);
    expect(esperaDoRetry(1, 0.999999)).toBeLessThanOrEqual(37_500);
  });

  it("destinos que falharam juntos NÃO voltam juntos", () => {
    const espera = new Set([0.1, 0.35, 0.6, 0.85].map((r) => esperaDoRetry(2, r)));
    expect(espera.size).toBe(4);
  });

  it("aleatório fora de [0,1) é contido", () => {
    expect(esperaDoRetry(1, -5)).toBe(22_500);
    expect(esperaDoRetry(1, 99)).toBeLessThanOrEqual(37_500);
  });
});

describe("patchReivindicada", () => {
  it("a concessão e a hora de reaparecer na consulta são a MESMA — é assim que se acha o worker morto", () => {
    const p = patchReivindicada(3, AGORA, "lease-1");
    expect(p).toMatchObject({ status: "leased", tentativas: 3, leaseId: "lease-1", leaseAte: AGORA + LEASE_MS, proximaTentativaEm: AGORA + LEASE_MS });
  });
});

describe("patchResultado", () => {
  const e = { tentativas: 1, expiraEm: AGORA + 6 * HORA };

  it("aceito: fecha, registra o instante e SAI da consulta de pendências", () => {
    const p = patchResultado(e, { tipo: "aceito", messageId: "m1" }, AGORA, 0.5);
    expect(p).toMatchObject({ status: "accepted", acceptedByProviderAt: AGORA, providerMessageId: "m1", proximaTentativaEm: null, leaseId: null, leaseAte: null });
  });

  it("nunca chama de 'entregue': o campo é o que o provedor aceitou", () => {
    const p = patchResultado(e, { tipo: "aceito" }, AGORA, 0.5);
    expect(p).not.toHaveProperty("deliveredAt");
    expect(p).not.toHaveProperty("pushDeliveredAt");
  });

  it("transitório: agenda o retry com espera crescente", () => {
    const p = patchResultado({ ...e, tentativas: 2 }, { tipo: "transitorio", codigo: "messaging/internal-error" }, AGORA, 0.5);
    expect(p).toMatchObject({ status: "retry_scheduled", proximaTentativaEm: AGORA + 60_000, ultimoErro: { codigo: "messaging/internal-error" } });
  });

  it("o retry nunca passa da validade", () => {
    const p = patchResultado({ tentativas: 5, expiraEm: AGORA + 1000 }, { tipo: "transitorio", codigo: "x" }, AGORA, 0.9);
    expect(p.proximaTentativaEm).toBe(AGORA + 1000);
  });

  it("transitório na última tentativa vira falha permanente", () => {
    const p = patchResultado({ ...e, tentativas: MAX_TENTATIVAS_DESTINO }, { tipo: "transitorio", codigo: "x" }, AGORA, 0.5);
    expect(p).toMatchObject({ status: "permanent_failure", motivo: "tentativas_esgotadas", proximaTentativaEm: null });
  });

  it("token inválido é permanente e não agenda nada", () => {
    const p = patchResultado(e, { tipo: "token_invalido", codigo: "messaging/registration-token-not-registered" }, AGORA, 0.5);
    expect(p).toMatchObject({ status: "permanent_failure", motivo: "token_invalido", proximaTentativaEm: null });
  });

  it("recusa do provedor é permanente", () => {
    expect(patchResultado(e, { tipo: "permanente", codigo: "messaging/invalid-argument" }, AGORA, 0.5))
      .toMatchObject({ status: "permanent_failure", motivo: "recusado_pelo_provedor" });
  });

  it("suprimido registra o motivo", () => {
    expect(patchResultado(e, { tipo: "suprimido", motivo: "preferencia" }, AGORA, 0.5))
      .toMatchObject({ status: "suppressed", motivo: "preferencia", proximaTentativaEm: null });
  });

  it("adiar não gasta a tentativa — nada foi enviado", () => {
    const p = patchResultado({ ...e, tentativas: 2 }, { tipo: "adiar", ate: AGORA + 60_000, motivo: "preferencia_indisponivel" }, AGORA, 0.5);
    expect(p).toMatchObject({ status: "retry_scheduled", tentativas: 1, adiamentos: 1, proximaTentativaEm: AGORA + 60_000 });
  });

  it("adiar também respeita a validade", () => {
    const p = patchResultado({ tentativas: 1, expiraEm: AGORA + 500 }, { tipo: "adiar", ate: AGORA + 60_000, motivo: "x" }, AGORA, 0.5);
    expect(p.proximaTentativaEm).toBe(AGORA + 500);
  });

  it("expirado é terminal", () => {
    expect(patchResultado(e, { tipo: "expirado" }, AGORA, 0.5)).toMatchObject({ status: "expired", proximaTentativaEm: null });
  });
});

describe("patchEncerrada", () => {
  it("expirar e esgotar fecham o destino", () => {
    expect(patchEncerrada("expirar", AGORA)).toMatchObject({ status: "expired", proximaTentativaEm: null });
    expect(patchEncerrada("esgotar", AGORA)).toMatchObject({ status: "permanent_failure", motivo: "tentativas_esgotadas" });
  });
});

describe("resumirEntregas — a conta é sobre TODOS os destinos, não 'algum aceitou'", () => {
  const de = (...s: StatusEntrega[]) => s.map((status) => ({ status }));

  it("sete aceitos e dois transitórios NÃO é concluído — era o bug: um aceito fechava tudo", () => {
    const r = resumirEntregas(de(...Array(7).fill("accepted"), "retry_scheduled", "retry_scheduled", "permanent_failure"));
    expect(r).toMatchObject({ total: 10, aceitos: 7, pendentes: 2, falhas: 1, concluido: false });
  });

  it("tudo terminal é concluído", () => {
    const r = resumirEntregas(de("accepted", "suppressed", "expired", "permanent_failure"));
    expect(r).toMatchObject({ aceitos: 1, suprimidos: 1, expirados: 1, falhas: 1, pendentes: 0, concluido: true });
  });

  it("pending, leased e retry_scheduled contam como pendentes", () => {
    expect(resumirEntregas(de("pending", "leased", "retry_scheduled")).pendentes).toBe(3);
  });

  it("lista vazia: concluído (nada a entregar)", () => {
    expect(resumirEntregas([])).toMatchObject({ total: 0, concluido: true });
  });
});
