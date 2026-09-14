import { describe, expect, it } from "vitest";
import { avaliarTransacao, explicarRecusa } from "./oauth-estado";

const AGORA = 1_757_000_000_000;
const valida = { verifier: "v-abc", solicitante: "caualm4@gmail.com", expiraEm: AGORA + 60_000, usado: false };

describe("avaliarTransacao — o que pode substituir a conexão", () => {
  it("transação viva, não usada e completa passa", () => {
    const r = avaliarTransacao(valida, AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verifier).toBe("v-abc");
      expect(r.solicitante).toBe("caualm4@gmail.com");
    }
  });

  it("state que ninguém criou é recusado", () => {
    /**
     * Este é o bug original: o callback aceitava qualquer volta e gravava em
     * `ml_tokens/main`. Um link de callback forjado ligava outra loja no painel.
     */
    expect(avaliarTransacao(null, AGORA)).toEqual({ ok: false, motivo: "state_desconhecido" });
  });

  it("state já usado não passa uma segunda vez", () => {
    expect(avaliarTransacao({ ...valida, usado: true }, AGORA))
      .toEqual({ ok: false, motivo: "state_ja_usado" });
  });

  it("state vencido não passa", () => {
    expect(avaliarTransacao({ ...valida, expiraEm: AGORA - 1 }, AGORA))
      .toEqual({ ok: false, motivo: "state_expirado" });
  });

  it("aceita exatamente no instante do vencimento, recusa depois", () => {
    expect(avaliarTransacao({ ...valida, expiraEm: AGORA }, AGORA).ok).toBe(true);
    expect(avaliarTransacao({ ...valida, expiraEm: AGORA }, AGORA + 1).ok).toBe(false);
  });

  it("documento sem prazo legível é tratado como vencido, não como válido", () => {
    // Recusar é o padrão: documento torto não vira acesso.
    expect(avaliarTransacao({ ...valida, expiraEm: undefined }, AGORA).ok).toBe(false);
    expect(avaliarTransacao({ ...valida, expiraEm: "amanhã" }, AGORA).ok).toBe(false);
    expect(avaliarTransacao({ ...valida, expiraEm: Number.NaN }, AGORA).ok).toBe(false);
  });

  it("sem verifier não passa — PKCE vazio quebraria a troca com erro ilegível", () => {
    expect(avaliarTransacao({ ...valida, verifier: "" }, AGORA))
      .toEqual({ ok: false, motivo: "transacao_incompleta" });
    expect(avaliarTransacao({ ...valida, verifier: undefined }, AGORA))
      .toEqual({ ok: false, motivo: "transacao_incompleta" });
  });

  it("usado só bloqueia quando é exatamente true", () => {
    // Documento antigo sem o campo continua utilizável enquanto estiver no prazo.
    expect(avaliarTransacao({ ...valida, usado: undefined }, AGORA).ok).toBe(true);
  });

  it("solicitante ausente não bloqueia, mas vira string vazia", () => {
    const r = avaliarTransacao({ ...valida, solicitante: undefined }, AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.solicitante).toBe("");
  });
});

describe("explicarRecusa", () => {
  it("cada motivo vira uma frase que diz o que fazer", () => {
    expect(explicarRecusa("state_expirado")).toContain("de novo");
    expect(explicarRecusa("vendedor_inesperado")).toContain("mantida");
    expect(explicarRecusa("perfil_indisponivel")).toContain("mantida");
  });

  it("motivo desconhecido não quebra a tela", () => {
    expect(explicarRecusa("coisa_nova")).toBeTruthy();
    expect(explicarRecusa("")).toBeTruthy();
  });
});
