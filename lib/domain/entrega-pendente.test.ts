import { describe, expect, it } from "vitest";
import {
  avaliarPendencia,
  LEASE_ENTREGA_MS,
  MAX_TENTATIVAS,
  patchDesistencia,
  patchResultado,
  patchTentando,
  VALIDADE_MS,
} from "./entrega-pendente";

const AGORA = 1_757_000_000_000;
const AGORA_MENOS = (ms: number) => AGORA - ms;

describe("o push que se perdia pra sempre", () => {
  it("evento criado mas NAO entregue continua pendente", () => {
    /**
     * A entrega estava grudada na criacao:
     *
     *   if (!created) return { estado: "ja_existia", eventId };
     *
     * Evento criado + envio que falha logo depois = documento sem entrega. E a
     * proxima tentativa recebia `created: false`, devolvia "ja existia" e NAO
     * TENTAVA DE NOVO. O push sumia em silencio, pra sempre.
     */
    const r = avaliarPendencia({ pushAttemptedAt: AGORA_MENOS(60_000), pushError: "FCM fora" }, AGORA_MENOS(60_000), AGORA);
    expect(r).toEqual({ acao: "entregar", tentativa: 1 });
  });

  it("evento novinho sem tentativa nenhuma entrega", () => {
    expect(avaliarPendencia(null, AGORA, AGORA)).toEqual({ acao: "entregar", tentativa: 1 });
    expect(avaliarPendencia({}, AGORA, AGORA)).toEqual({ acao: "entregar", tentativa: 1 });
  });

  it("ja entregue nao tenta de novo", () => {
    expect(avaliarPendencia({ pushDeliveredAt: AGORA_MENOS(1000) }, AGORA_MENOS(2000), AGORA))
      .toEqual({ acao: "ja_entregue" });
  });

  it("a contagem de tentativas avanca", () => {
    const r = avaliarPendencia({ tentativas: 2 }, AGORA, AGORA);
    expect(r).toEqual({ acao: "entregar", tentativa: 3 });
  });
});

describe("dois processos nao entregam juntos", () => {
  it("concessao viva bloqueia o segundo", () => {
    expect(avaliarPendencia({ entregaLeaseAte: AGORA + LEASE_ENTREGA_MS }, AGORA, AGORA))
      .toEqual({ acao: "outro_entregando" });
  });

  it("concessao vencida e assumivel — processo morto nao trava o aviso", () => {
    expect(avaliarPendencia({ entregaLeaseAte: AGORA - 1 }, AGORA, AGORA).acao).toBe("entregar");
  });

  it("valor torto nao vira bloqueio eterno", () => {
    expect(avaliarPendencia({ entregaLeaseAte: Number.NaN }, AGORA, AGORA).acao).toBe("entregar");
  });

  it("ja entregue vence ate a concessao viva", () => {
    // Se chegou, chegou: nao importa quem estava tentando.
    expect(avaliarPendencia(
      { pushDeliveredAt: AGORA, entregaLeaseAte: AGORA + LEASE_ENTREGA_MS }, AGORA, AGORA,
    )).toEqual({ acao: "ja_entregue" });
  });
});

describe("desistir e uma decisao, nao um esquecimento", () => {
  it("passa do teto de tentativas e para", () => {
    // Alem disso o problema nao e transitorio — e token morto, projeto mal
    // configurado, permissao revogada — e insistir so gasta quota.
    expect(avaliarPendencia({ tentativas: MAX_TENTATIVAS }, AGORA, AGORA))
      .toEqual({ acao: "desistir", motivo: "tentativas" });
  });

  it("aviso vencido nao e entregue — seria ruido, nao aviso", () => {
    /**
     * Um aviso de venda entregue tres dias depois nao e aviso: a venda ja
     * apareceu no painel, ja foi embalada, talvez ja entregue.
     */
    const criado = AGORA_MENOS(VALIDADE_MS + 1000);
    expect(avaliarPendencia({ tentativas: 1 }, criado, AGORA))
      .toEqual({ acao: "desistir", motivo: "vencida" });
  });

  it("dentro do prazo ainda entrega", () => {
    const criado = AGORA_MENOS(VALIDADE_MS - 60_000);
    expect(avaliarPendencia({ tentativas: 1 }, criado, AGORA).acao).toBe("entregar");
  });

  it("o prazo conta do NASCIMENTO, nao da ultima tentativa", () => {
    /**
     * Senao tentar de hora em hora esticaria a validade indefinidamente, e o
     * aviso chegaria dois dias depois — exatamente o que o prazo evita.
     */
    const criado = AGORA_MENOS(VALIDADE_MS + 3600_000);
    const r = avaliarPendencia({ tentativas: 1, pushAttemptedAt: AGORA_MENOS(1000) }, criado, AGORA);
    expect(r).toEqual({ acao: "desistir", motivo: "vencida" });
  });

  it("sem data de criacao legivel, nao desiste por prazo", () => {
    // Na duvida, tentar: o teto de tentativas ainda limita.
    expect(avaliarPendencia({ tentativas: 1 }, 0, AGORA).acao).toBe("entregar");
    expect(avaliarPendencia({ tentativas: 1 }, Number.NaN, AGORA).acao).toBe("entregar");
  });
});

describe("os patches", () => {
  it("assumir grava tentativa e concessao ANTES de chamar o FCM", () => {
    // A ordem importa: gravar depois deixaria a janela em que dois processos
    // acham que ninguem esta entregando.
    const p = patchTentando(3, AGORA);
    expect(p["delivery.tentativas"]).toBe(3);
    expect(p["delivery.pushAttemptedAt"]).toBe(AGORA);
    expect(p["delivery.entregaLeaseAte"]).toBe(AGORA + LEASE_ENTREGA_MS);
  });

  it("entrega bem-sucedida carimba e limpa o erro", () => {
    const p = patchResultado(2, AGORA);
    expect(p["delivery.pushDeliveredAt"]).toBe(AGORA);
    expect(p["delivery.pushError"]).toBeNull();
    expect(p["delivery.entregaLeaseAte"]).toBeNull();
  });

  it("ZERO aparelhos NAO e entrega", () => {
    /**
     * Pode nao haver dispositivo registrado, ou todos os tokens estarem
     * mortos. Carimbar entrega ai faria o aviso nunca mais ser tentado — e a
     * pessoa nunca saberia que nao recebeu.
     */
    const p = patchResultado(0, AGORA);
    expect(p["delivery.pushDeliveredAt"]).toBeUndefined();
    expect(p["delivery.pushError"]).toBe("nenhum dispositivo recebeu");
  });

  it("erro informado aparece no lugar da mensagem generica", () => {
    expect(patchResultado(0, AGORA, "FCM 503")["delivery.pushError"]).toBe("FCM 503");
  });

  it("erro longo e cortado — este campo e lido por qualquer autorizado", () => {
    const p = patchResultado(0, AGORA, "x".repeat(500));
    expect(String(p["delivery.pushError"]).length).toBeLessThanOrEqual(200);
  });

  it("desistir registra o motivo, em vez de sumir calado", () => {
    expect(String(patchDesistencia("tentativas", AGORA)["delivery.pushError"])).toContain("tentativas");
    expect(String(patchDesistencia("vencida", AGORA)["delivery.pushError"])).toContain("vencido");
    expect(patchDesistencia("vencida", AGORA)["delivery.entregaLeaseAte"]).toBeNull();
  });
});
