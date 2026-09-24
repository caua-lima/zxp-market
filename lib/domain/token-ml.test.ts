import { describe, expect, it } from "vitest";
import {
  decidirGravacaoDoRefresh,
  expiraEm,
  LEASE_MS,
  podeAssumirRenovacao,
  precisaRenovar,
  relogioDoToken,
  resultadoAindaVale,
  TIMEOUT_TROCA_TOKEN_MS,
} from "./token-ml";

const AGORA = 1_757_000_000_000;
const SEIS_HORAS = 6 * 3600 * 1000;

describe("expiraEm — o relogio proprio do token", () => {
  it("usa expiresAt quando existe", () => {
    expect(expiraEm({ expiresAt: AGORA + SEIS_HORAS })).toBe(AGORA + SEIS_HORAS);
  });

  it("deriva de tokenIssuedAt + expires_in", () => {
    expect(expiraEm({ tokenIssuedAt: AGORA, expires_in: 21600 })).toBe(AGORA + SEIS_HORAS);
  });

  it("atualizar o PERFIL nao pode empurrar a validade do token", () => {
    /**
     * A expiracao era `Date.parse(updated_at) + expires_in`. Mas `updated_at`
     * e "quando o documento foi tocado", nao "quando o token foi emitido" — e
     * o callback do OAuth grava esse campo junto com o perfil.
     *
     * Aqui: token emitido as 00h, documento tocado as 05h por causa do perfil.
     * Pelo relogio proprio ele vence as 06h; pelo `updated_at` venceria as 11h,
     * e o app usaria por cinco horas um token ja morto.
     */
    const t = {
      tokenIssuedAt: AGORA,
      expires_in: 21600,
      updated_at: new Date(AGORA + 5 * 3600 * 1000).toISOString(),
    };
    expect(expiraEm(t)).toBe(AGORA + SEIS_HORAS);
  });

  it("legado sem relogio proprio ainda cai no updated_at", () => {
    // Documentos gravados antes destes campos existirem continuam funcionando.
    const t = { expires_in: 21600, updated_at: new Date(AGORA).toISOString() };
    expect(expiraEm(t)).toBe(AGORA + SEIS_HORAS);
  });

  it("sem nada legivel, nao inventa validade", () => {
    expect(expiraEm({})).toBeNull();
    expect(expiraEm(null)).toBeNull();
    expect(expiraEm({ expires_in: 21600 })).toBeNull();
    expect(expiraEm({ expires_in: 0, updated_at: new Date(AGORA).toISOString() })).toBeNull();
  });
});

describe("precisaRenovar — desconhecido nao e 'valido'", () => {
  it("token com folga nao renova", () => {
    expect(precisaRenovar({ access_token: "t", expiresAt: AGORA + SEIS_HORAS }, AGORA)).toBe(false);
  });

  it("token vencido renova", () => {
    expect(precisaRenovar({ access_token: "t", expiresAt: AGORA - 1 }, AGORA)).toBe(true);
  });

  it("renova com margem, antes de tomar 401 no meio de uma chamada", () => {
    expect(precisaRenovar({ access_token: "t", expiresAt: AGORA + 30_000 }, AGORA)).toBe(true);
    expect(precisaRenovar({ access_token: "t", expiresAt: AGORA + 90_000 }, AGORA)).toBe(false);
  });

  it("SEM saber a validade, renova", () => {
    /**
     * `tokenExpired` devolvia `false` quando faltava `expires_in` ou
     * `updated_at`: sem saber, assumia que o token estava bom. Um documento
     * incompleto nunca renovava, e TODA chamada ao ML falhava com 401 ate
     * alguem reconectar na mao.
     */
    expect(precisaRenovar({ access_token: "t" }, AGORA)).toBe(true);
    expect(precisaRenovar({ access_token: "t", expires_in: 21600 }, AGORA)).toBe(true);
  });

  it("sem access token, renova", () => {
    expect(precisaRenovar({ refresh_token: "r" }, AGORA)).toBe(true);
    expect(precisaRenovar(null, AGORA)).toBe(true);
  });
});

describe("relogioDoToken", () => {
  it("emite os dois campos juntos", () => {
    expect(relogioDoToken(21600, AGORA)).toEqual({
      tokenIssuedAt: AGORA, expiresAt: AGORA + SEIS_HORAS,
    });
  });

  it("sem duracao legivel, grava emissao mas nao inventa vencimento", () => {
    // `expiresAt: null` leva precisaRenovar a renovar — o lado seguro.
    expect(relogioDoToken(undefined, AGORA)).toEqual({ tokenIssuedAt: AGORA, expiresAt: null });
    expect(relogioDoToken("abc", AGORA).expiresAt).toBeNull();
    expect(relogioDoToken(-5, AGORA).expiresAt).toBeNull();
  });
});

describe("podeAssumirRenovacao — duas renovacoes ao mesmo tempo", () => {
  it("sem concessao, qualquer um assume", () => {
    /**
     * Nada coordenava: duas requisicoes com o token vencido chamavam o refresh
     * com o MESMO refresh_token. O ML ROTACIONA esse token — a segunda usa um
     * valor ja consumido e falha, e a resposta que chegasse por ultimo
     * sobrescrevia a mais nova com a mais velha.
     */
    expect(podeAssumirRenovacao({}, AGORA)).toBe(true);
    expect(podeAssumirRenovacao({ refreshLeaseAte: null }, AGORA)).toBe(true);
  });

  it("concessao viva bloqueia o segundo", () => {
    expect(podeAssumirRenovacao({ refreshLeaseAte: AGORA + LEASE_MS }, AGORA)).toBe(false);
  });

  it("concessao vencida e assumivel — processo morto nao trava pra sempre", () => {
    expect(podeAssumirRenovacao({ refreshLeaseAte: AGORA - 1 }, AGORA)).toBe(true);
  });

  it("valor torto nao vira bloqueio eterno", () => {
    expect(podeAssumirRenovacao({ refreshLeaseAte: Number.NaN }, AGORA)).toBe(true);
  });
});

describe("resultadoAindaVale — refresh antigo nao ressuscita conexao removida", () => {
  it("mesma geracao, o resultado vale", () => {
    expect(resultadoAindaVale(3, 3)).toBe(true);
  });

  it("geracao mudou no meio: DESCARTA", () => {
    /**
     * Entre pedir o token novo ao ML e grava-lo, a conexao pode ter sido
     * trocada. Gravar assim mesmo ressuscitaria a conexao anterior, com o
     * token de uma conta que ja nao e a conectada.
     */
    expect(resultadoAindaVale(3, 4)).toBe(false);
  });

  it("ausente conta como zero nos dois lados", () => {
    expect(resultadoAindaVale(undefined, undefined)).toBe(true);
    expect(resultadoAindaVale(null, 0)).toBe(true);
    expect(resultadoAindaVale(undefined, 1)).toBe(false);
  });
});

describe("S05 — a troca de token cabe na concessão", () => {
  it("uma tentativa da troca termina antes de a concessão vencer, com folga pras duas transações", () => {
    /**
     * Com 3 tentativas × 12 s + esperas (o fetchML padrão), a troca passava
     * de 37 s contra 30 s de concessão: o dono legítimo perdia a concessão
     * no meio da própria chamada. Se alguém subir o timeout, isto quebra.
     */
    const FOLGA_DAS_TRANSACOES_MS = 5_000;
    expect(TIMEOUT_TROCA_TOKEN_MS + FOLGA_DAS_TRANSACOES_MS).toBeLessThanOrEqual(LEASE_MS);
  });
});

describe("decidirGravacaoDoRefresh — compare-and-set no refresh token (S05)", () => {
  const pedido = { geracao: 3, refreshUsado: "R0", dono: "processo-A" };

  it("documento como eu li, concessão minha: grava e libera", () => {
    expect(decidirGravacaoDoRefresh(pedido, { geracao: 3, refresh_token: "R0", refreshLeaseDono: "processo-A" }))
      .toEqual({ gravar: true, motivo: "ok", liberarConcessao: true });
  });

  it("perdi a concessão mas o refresh do documento ainda é o que eu usei: GRAVA — o meu é o único token válido", () => {
    /**
     * O refresh token é de uso único. Se o A (lento) trocou, o B que entrou
     * depois com o mesmo R0 necessariamente falhou. Descartar o resultado do
     * A por "não ser mais o dono" jogaria fora a conexão.
     */
    expect(decidirGravacaoDoRefresh(pedido, { geracao: 3, refresh_token: "R0", refreshLeaseDono: "processo-B" }))
      .toEqual({ gravar: true, motivo: "ok", liberarConcessao: false });
  });

  it("alguém já gravou um refresh MAIS NOVO: não sobrescreve (era o 'mais velho por cima do mais novo')", () => {
    expect(decidirGravacaoDoRefresh(pedido, { geracao: 3, refresh_token: "R1", refreshLeaseDono: null }))
      .toEqual({ gravar: false, motivo: "token_mais_novo_ja_gravado", liberarConcessao: false });
  });

  it("conexão trocada no meio: não grava, e libera a concessão se for minha", () => {
    expect(decidirGravacaoDoRefresh(pedido, { geracao: 4, refresh_token: "R0", refreshLeaseDono: "processo-A" }))
      .toEqual({ gravar: false, motivo: "conexao_trocada", liberarConcessao: true });
  });

  it("nunca libera a concessão de OUTRO processo", () => {
    for (const doc of [
      { geracao: 3, refresh_token: "R0", refreshLeaseDono: "processo-B" },
      { geracao: 4, refresh_token: "R0", refreshLeaseDono: "processo-B" },
      { geracao: 3, refresh_token: "R1", refreshLeaseDono: "processo-B" },
    ]) {
      expect(decidirGravacaoDoRefresh(pedido, doc).liberarConcessao).toBe(false);
    }
  });

  it("documento sumiu (desconectado): não grava", () => {
    expect(decidirGravacaoDoRefresh({ ...pedido, geracao: 0 }, null).gravar).toBe(false);
  });
});
