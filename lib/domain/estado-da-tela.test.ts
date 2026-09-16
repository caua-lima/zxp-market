import { describe, it, expect } from "vitest";
import { resumirEstadoDaTela, rotuloDoPeriodo } from "./estado-da-tela";
import { fonteCarregada, fonteComErro, FONTE_CARREGANDO } from "./estado-fonte";
import { pendenciaDeCadastro } from "./apuracao-financeira";

const negada = fonteComErro(new Error("Missing or insufficient permissions"));
const falhou = fonteComErro(new Error("network"));

describe("resumirEstadoDaTela — a ordem das perguntas", () => {
  it("erro no essencial ganha de tudo, inclusive de pendência", () => {
    const e = resumirEstadoDaTela({
      fontes: { pedidos: falhou },
      essenciais: ["pedidos"],
      pendencias: pendenciaDeCadastro(3),
    });
    expect(e.situacao).toBe("erro");
    expect(e.detalhe).toContain("não podem ser lidos");
  });

  it("carregando ganha de pendência — não há o que ressalvar ainda", () => {
    const e = resumirEstadoDaTela({
      fontes: { pedidos: FONTE_CARREGANDO },
      essenciais: ["pedidos"],
      pendencias: pendenciaDeCadastro(3),
    });
    expect(e.situacao).toBe("carregando");
    expect(e.pendencias).toBe(0);
  });

  it("sem acesso ganha de parcial — é resposta, não problema a resolver", () => {
    const e = resumirEstadoDaTela({
      fontes: { pedidos: fonteCarregada(), custos: negada },
      essenciais: ["pedidos"],
      pendencias: pendenciaDeCadastro(2),
    });
    expect(e.situacao).toBe("sem_acesso");
    expect(e.detalhe).toContain("não é zero");
  });

  it("falha numa fonte SECUNDÁRIA não vira erro — a tela ainda serve", () => {
    const e = resumirEstadoDaTela({
      fontes: { pedidos: fonteCarregada(), ads: falhou },
      essenciais: ["pedidos"],
    });
    expect(e.situacao).toBe("parcial");
    expect(e.detalhe).toContain("não chegou");
  });

  it("tudo carregado e sem pendência é completo", () => {
    const e = resumirEstadoDaTela({ fontes: { a: fonteCarregada() }, essenciais: ["a"] });
    expect(e.situacao).toBe("completo");
    expect(e.rotulo).toBe("Atualizado");
  });

  it("completo mostra quando os números foram lidos", () => {
    const e = resumirEstadoDaTela({
      fontes: { a: fonteCarregada() },
      atualizadoEm: new Date("2026-09-15T14:30:00"),
    });
    expect(e.detalhe).toContain("2026");
  });

  it("pendência sozinha deixa a tela parcial e conta quantas", () => {
    const e = resumirEstadoDaTela({
      fontes: { a: fonteCarregada() },
      pendencias: [...pendenciaDeCadastro(1), ...pendenciaDeCadastro(2)],
    });
    expect(e.situacao).toBe("parcial");
    expect(e.rotulo).toBe("Parcial · 2");
    expect(e.pendencias).toBe(2);
  });

  it("pendência e falha secundária somam no mesmo contador", () => {
    const e = resumirEstadoDaTela({
      fontes: { a: fonteCarregada(), b: falhou },
      essenciais: ["a"],
      pendencias: pendenciaDeCadastro(1),
    });
    expect(e.pendencias).toBe(2);
  });

  it("sem fontes nenhuma, não trava em carregando", () => {
    expect(resumirEstadoDaTela({}).situacao).toBe("completo");
  });

  it("essencial que não existe no mapa é ignorado, não vira erro", () => {
    const e = resumirEstadoDaTela({ fontes: { a: fonteCarregada() }, essenciais: ["a", "naoExiste"] });
    expect(e.situacao).toBe("completo");
  });

  it("sem `essenciais`, todas as fontes são essenciais", () => {
    const e = resumirEstadoDaTela({ fontes: { a: fonteCarregada(), b: falhou } });
    expect(e.situacao).toBe("erro");
  });

  it("cada situação tem cor e detalhe — nada sai vazio na tela", () => {
    const casos = [
      resumirEstadoDaTela({ fontes: { a: falhou } }),
      resumirEstadoDaTela({ fontes: { a: FONTE_CARREGANDO } }),
      resumirEstadoDaTela({ fontes: { a: fonteCarregada(), b: negada }, essenciais: ["a"] }),
      resumirEstadoDaTela({ fontes: { a: fonteCarregada() }, pendencias: pendenciaDeCadastro(1) }),
      resumirEstadoDaTela({ fontes: { a: fonteCarregada() } }),
    ];
    for (const c of casos) {
      expect(c.rotulo.length, c.situacao).toBeGreaterThan(3);
      expect(c.detalhe.length, c.situacao).toBeGreaterThan(20);
      expect(c.cor, c.situacao).toContain("var(--");
    }
  });
});

describe("rotuloDoPeriodo — um formato só no app inteiro", () => {
  it("mês inteiro vira o nome do mês", () => {
    expect(rotuloDoPeriodo("2026-09-01", "2026-09-30")).toBe("setembro de 2026");
  });

  it("fevereiro de ano bissexto conta 29 dias", () => {
    expect(rotuloDoPeriodo("2024-02-01", "2024-02-29")).toBe("fevereiro de 2024");
  });

  it("fevereiro comum conta 28", () => {
    expect(rotuloDoPeriodo("2026-02-01", "2026-02-28")).toBe("fevereiro de 2026");
  });

  it("mês pela metade não vira nome de mês", () => {
    expect(rotuloDoPeriodo("2026-09-01", "2026-09-22")).toBe("01/09 – 22/09/2026");
  });

  it("mesmo ano mostra o ano uma vez só — o celular não tem essa largura", () => {
    expect(rotuloDoPeriodo("2026-01-15", "2026-03-10")).toBe("15/01 – 10/03/2026");
  });

  it("anos diferentes mostram os dois", () => {
    expect(rotuloDoPeriodo("2025-12-20", "2026-01-05")).toBe("20/12/2025 – 05/01/2026");
  });

  it("período vazio não quebra", () => {
    expect(rotuloDoPeriodo("", "")).toBe("");
    expect(rotuloDoPeriodo("2026-09-01", "")).toBe("");
  });

  it("entrada que não é data devolve algo legível em vez de NaN", () => {
    expect(rotuloDoPeriodo("ontem", "hoje")).toBe("ontem – hoje");
  });
});
