import { describe, expect, it } from "vitest";
import {
  explicarFonte,
  FONTE_CARREGANDO,
  fonteCarregada,
  fonteComErro,
  fontesIncompletas,
  podeAfirmarVazio,
} from "./estado-fonte";

describe("vazio nao e o mesmo que nao carregou", () => {
  it("so a fonte CARREGADA autoriza dizer que nao ha nada", () => {
    /**
     * A rede de seguranca do useUserData destrava a tela depois de seis
     * segundos com `costs: []` e `products: []` nos valores INICIAIS. Quem
     * consome nao tinha como distinguir "nao ha custo cadastrado" de "a
     * assinatura foi negada" — e a tela dizia a primeira.
     */
    expect(podeAfirmarVazio(fonteCarregada())).toBe(true);
    expect(podeAfirmarVazio(FONTE_CARREGANDO)).toBe(false);
    expect(podeAfirmarVazio(fonteComErro(new Error("timeout")))).toBe(false);
    expect(podeAfirmarVazio(undefined)).toBe(false);
  });
});

describe("sem acesso e diferente de falha", () => {
  it("permission-denied vira SEM ACESSO, nao erro", () => {
    /**
     * O papel `member` nao enxerga `custos` nem `estoque` pelas regras do
     * Firestore — pra ele, duas fontes sao negadas POR DEFINICAO. Dizer "nao
     * consegui carregar" ai seria alarme falso: nao ha nada a resolver.
     */
    for (const m of [
      "permission-denied",
      "PERMISSION_DENIED: insufficient",
      "Missing or insufficient permissions.",
    ]) {
      expect(fonteComErro(new Error(m)).situacao, m).toBe("sem_acesso");
    }
  });

  it("qualquer outro erro e falha mesmo", () => {
    expect(fonteComErro(new Error("deadline exceeded")).situacao).toBe("falhou");
    expect(fonteComErro(new Error("quota exceeded")).situacao).toBe("falhou");
  });

  it("guarda o erro, mas cortado", () => {
    const e = fonteComErro(new Error("x".repeat(500)));
    expect(String(e.erro).length).toBeLessThanOrEqual(200);
  });

  it("valor estranho nao quebra", () => {
    expect(fonteComErro(null).situacao).toBe("falhou");
    expect(fonteComErro(undefined).erro).toBeTruthy();
  });
});

describe("explicarFonte — o texto que substitui a lista vazia mentirosa", () => {
  it("sem acesso diz sem acesso", () => {
    expect(explicarFonte(fonteComErro(new Error("permission-denied")), "custos"))
      .toBe("Você não tem acesso a custos.");
  });

  it("falha avisa que a tela pode estar incompleta", () => {
    expect(explicarFonte(fonteComErro(new Error("timeout")), "produtos"))
      .toContain("incompleto");
  });

  it("carregando diz carregando", () => {
    expect(explicarFonte(FONTE_CARREGANDO, "metas")).toBe("Carregando metas…");
  });

  it("carregada nao tem nada a explicar", () => {
    expect(explicarFonte(fonteCarregada(), "custos")).toBeNull();
    expect(explicarFonte(undefined, "custos")).toBeNull();
  });
});

describe("fontesIncompletas", () => {
  it("lista o que falhou e o que ainda nao chegou", () => {
    const r = fontesIncompletas({
      custos: fonteComErro(new Error("timeout")),
      produtos: fonteCarregada(),
      metas: FONTE_CARREGANDO,
    });
    expect(r.sort()).toEqual(["custos", "metas"]);
  });

  it("sem acesso NAO conta como incompleto — e uma resposta, nao uma falta", () => {
    // Avisar "a tela esta incompleta" pra quem simplesmente nao tem permissao
    // seria ruido permanente.
    const r = fontesIncompletas({ custos: fonteComErro(new Error("permission-denied")) });
    expect(r).toEqual([]);
  });

  it("tudo carregado nao gera aviso", () => {
    expect(fontesIncompletas({ a: fonteCarregada(), b: fonteCarregada() })).toEqual([]);
  });
});
