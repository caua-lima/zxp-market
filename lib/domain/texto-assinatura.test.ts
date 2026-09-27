import { describe, expect, it } from "vitest";
import { avisoDaAssinatura } from "./texto-assinatura";

const DIA = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

describe("S25 — aviso da assinatura no topo", () => {
  it("modo raiz e empresa em dia: nenhum aviso", () => {
    expect(avisoDaAssinatura({ modo: "raiz" }, T0)).toBeNull();
    expect(avisoDaAssinatura({ modo: "tenant", direitos: { estado: "ativa", bloqueada: false } }, T0)).toBeNull();
    expect(avisoDaAssinatura({ modo: "tenant", direitos: { estado: "trial", bloqueada: false }, trialAte: T0 + 10 * DIA }, T0)).toBeNull();
  });

  it("bloqueada: diz o porquê, que nada foi apagado e onde reativar", () => {
    const a = avisoDaAssinatura({ modo: "tenant", direitos: { estado: "trial_encerrado", bloqueada: true } }, T0)!;
    expect(a.tom).toBe("perigo");
    expect(a.texto).toMatch(/teste grátis terminou.*somente leitura.*Nada foi apagado.*Acesso → Plano/);
  });

  it("carência e fim de trial avisam ANTES de travar", () => {
    expect(avisoDaAssinatura({ modo: "tenant", direitos: { estado: "carencia", bloqueada: false } }, T0)?.tom).toBe("atencao");
    expect(avisoDaAssinatura({ modo: "tenant", direitos: { estado: "trial", bloqueada: false }, trialAte: T0 + 2 * DIA }, T0)?.texto).toContain("termina em 2 dias");
  });
});
