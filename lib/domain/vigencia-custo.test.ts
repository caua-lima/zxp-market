import { describe, expect, it } from "vitest";
import {
  contribuicaoNoPeriodo,
  diasEntre,
  interseccao,
  janelaDeVigencia,
  patchArquivar,
  patchNovaVersao,
  patchReativar,
  vigenteHoje,
} from "./vigencia-custo";

const HOJE = "2026-09-14";
const SETEMBRO = { de: "2026-09-01", ate: "2026-09-30" };
const AGOSTO = { de: "2026-08-01", ate: "2026-08-31" };

describe("arquivar nao pode apagar o passado", () => {
  it("contador arquivado HOJE continua contando em agosto", () => {
    /**
     * `types.ts` prometia: "arquivado some das listas ativas, mas CONTINUA
     * CONTANDO no histórico". A rota de metricas fazia
     * `if (d.ativo === false) continue` — parava de contar em TODO periodo.
     *
     * Ou seja: arquivar o contador hoje removia a despesa de todos os meses
     * passados. A DRE de meses fechados mudava sozinha, e o lucro historico
     * subia.
     */
    const contador = { valor: 800, freq: "mensal", data: "2025-01-01", ativo: false, vigenteAte: HOJE };
    expect(contribuicaoNoPeriodo(contador, AGOSTO, HOJE)).toBe(800);
  });

  it("e para de contar em outubro, que e o ponto de arquivar", () => {
    const contador = { valor: 800, freq: "mensal", data: "2025-01-01", ativo: false, vigenteAte: HOJE };
    expect(contribuicaoNoPeriodo(contador, { de: "2026-10-01", ate: "2026-10-31" }, HOJE)).toBe(0);
  });

  it("setembro (mes do arquivamento) nao conta: o mes nao fechou vigente", () => {
    // Custo mensal so entra em mes INTEIRO dentro da vigencia — a regra de
    // competencia que ja existia, agora aplicada sobre a janela vigente.
    const contador = { valor: 800, freq: "mensal", data: "2025-01-01", ativo: false, vigenteAte: HOJE };
    expect(contribuicaoNoPeriodo(contador, SETEMBRO, HOJE)).toBe(0);
  });

  it("legado: ativo:false SEM vigenteAte corta em hoje, nao no passado", () => {
    /**
     * Assumir uma data passada apagaria meses em que a despesa de fato
     * existiu — que e exatamente o bug. Hoje e a unica data defensavel.
     */
    const velho = { valor: 800, freq: "mensal", data: "2025-01-01", ativo: false };
    expect(contribuicaoNoPeriodo(velho, AGOSTO, HOJE)).toBe(800);
    expect(contribuicaoNoPeriodo(velho, { de: "2026-10-01", ate: "2026-10-31" }, HOJE)).toBe(0);
  });
});

describe("mudar o valor nao pode reescrever o passado", () => {
  it("duas versoes coexistem, cada uma no seu periodo", () => {
    /**
     * O custo guardava um `valor` unico: corrigir o aluguel de R$ 2.000 pra
     * R$ 2.500 hoje reescrevia todo mes anterior com 2.500 — um valor que o
     * passado nunca teve.
     */
    const antiga = { valor: 2000, freq: "mensal", data: "2025-01-01", vigenteAte: "2026-08-31" };
    const nova = { valor: 2500, freq: "mensal", data: "2026-09-01", vigenteDe: "2026-09-01" };

    expect(contribuicaoNoPeriodo(antiga, AGOSTO, HOJE)).toBe(2000);
    expect(contribuicaoNoPeriodo(nova, AGOSTO, HOJE)).toBe(0);

    expect(contribuicaoNoPeriodo(antiga, SETEMBRO, HOJE)).toBe(0);
    expect(contribuicaoNoPeriodo(nova, SETEMBRO, HOJE)).toBe(2500);
  });

  it("nenhum mes conta duas vezes na virada", () => {
    // O risco da versao: fechar em 31/08 e abrir em 01/09 nao pode dar 4500
    // em agosto nem em setembro.
    const antiga = { valor: 2000, freq: "mensal", data: "2025-01-01", vigenteAte: "2026-08-31" };
    const nova = { valor: 2500, freq: "mensal", data: "2026-09-01", vigenteDe: "2026-09-01" };
    const periodo = { de: "2026-08-01", ate: "2026-09-30" };
    const total = contribuicaoNoPeriodo(antiga, periodo, HOJE) + contribuicaoNoPeriodo(nova, periodo, HOJE);
    expect(total).toBe(4500);
  });
});

describe("contribuicaoNoPeriodo — por frequencia", () => {
  it("diario cobra so os dias VIGENTES", () => {
    /**
     * Antes multiplicava pelos dias do PERIODO inteiro: uma despesa diaria
     * encerrada no dia 10 continuava cobrando ate o fim do mes.
     */
    const c = { valor: 4.5, freq: "diario", data: "2026-01-01", vigenteAte: "2026-09-10" };
    expect(contribuicaoNoPeriodo(c, SETEMBRO, HOJE)).toBeCloseTo(4.5 * 10, 6);
  });

  it("diario vigente o mes todo cobra o mes todo", () => {
    const c = { valor: 4.5, freq: "diario", data: "2026-01-01" };
    expect(contribuicaoNoPeriodo(c, SETEMBRO, HOJE)).toBeCloseTo(4.5 * 30, 6);
  });

  it("diario que comeca no meio nao cobra antes de existir", () => {
    const c = { valor: 10, freq: "diario", data: "2026-09-20", vigenteDe: "2026-09-20" };
    expect(contribuicaoNoPeriodo(c, SETEMBRO, HOJE)).toBe(110); // 20..30 = 11 dias
  });

  it("mensal conta um por mes inteiro dentro da vigencia", () => {
    const c = { valor: 300, freq: "mensal", data: "2026-01-01" };
    expect(contribuicaoNoPeriodo(c, { de: "2026-07-01", ate: "2026-08-31" }, HOJE)).toBe(600);
  });

  it("avulso so na propria data, e vigencia nao se aplica", () => {
    // Um gasto de uma vez nao "deixa de valer".
    const c = { valor: 120, freq: "avulso", data: "2026-08-15", ativo: false };
    expect(contribuicaoNoPeriodo(c, AGOSTO, HOJE)).toBe(120);
    expect(contribuicaoNoPeriodo(c, SETEMBRO, HOJE)).toBe(0);
  });

  it("valor invalido ou nao positivo vira zero, nao NaN", () => {
    expect(contribuicaoNoPeriodo({ valor: Number.NaN, freq: "diario" }, SETEMBRO, HOJE)).toBe(0);
    expect(contribuicaoNoPeriodo({ valor: -50, freq: "diario" }, SETEMBRO, HOJE)).toBe(0);
    expect(contribuicaoNoPeriodo({ valor: 0, freq: "mensal" }, SETEMBRO, HOJE)).toBe(0);
  });

  it("frequencia desconhecida nao cobra nada", () => {
    expect(contribuicaoNoPeriodo({ valor: 100, freq: "semanal" }, SETEMBRO, HOJE)).toBe(0);
  });
});

describe("janelaDeVigencia", () => {
  it("sem vigenteDe, cai na data do lancamento", () => {
    expect(janelaDeVigencia({ data: "2026-03-05" }, HOJE).de).toBe("2026-03-05");
  });

  it("vigenteDe manda sobre a data do lancamento", () => {
    expect(janelaDeVigencia({ data: "2026-03-05", vigenteDe: "2026-06-01" }, HOJE).de).toBe("2026-06-01");
  });

  it("vigencia invertida vira um dia so, nao um buraco", () => {
    const j = janelaDeVigencia({ vigenteDe: "2026-09-10", vigenteAte: "2026-09-01" }, HOJE);
    expect(j).toEqual({ de: "2026-09-10", ate: "2026-09-10" });
  });
});

describe("vigenteHoje", () => {
  it("ativa aparece nas listas", () => {
    expect(vigenteHoje({ data: "2026-01-01" }, HOJE)).toBe(true);
  });

  it("encerrada ontem nao aparece", () => {
    expect(vigenteHoje({ data: "2026-01-01", vigenteAte: "2026-09-13" }, HOJE)).toBe(false);
  });

  it("que so comeca amanha ainda nao aparece", () => {
    expect(vigenteHoje({ data: "2026-09-15", vigenteDe: "2026-09-15" }, HOJE)).toBe(false);
  });
});

describe("os patches", () => {
  it("arquivar fecha HOJE — o dia existiu e nao pode ser apagado", () => {
    expect(patchArquivar(HOJE)).toEqual({ ativo: false, vigenteAte: HOJE });
  });

  it("reativar volta a valer a partir de hoje", () => {
    expect(patchReativar(HOJE)).toEqual({ ativo: true, vigenteAte: null, vigenteDe: HOJE });
  });

  it("nova versao fecha a anterior ONTEM e abre hoje — sem sobreposicao", () => {
    const p = patchNovaVersao(HOJE);
    expect(p.fecharAnterior).toEqual({ vigenteAte: "2026-09-13" });
    expect(p.novaVigencia).toEqual({ vigenteDe: HOJE, vigenteAte: null, ativo: true });
  });

  it("nova versao na virada do mes acerta o dia anterior", () => {
    expect(patchNovaVersao("2026-10-01").fecharAnterior).toEqual({ vigenteAte: "2026-09-30" });
  });

  it("nova versao na virada do ano acerta o dia anterior", () => {
    expect(patchNovaVersao("2027-01-01").fecharAnterior).toEqual({ vigenteAte: "2026-12-31" });
  });
});

describe("interseccao e diasEntre", () => {
  it("sem sobreposicao devolve null", () => {
    expect(interseccao(SETEMBRO, { de: "2026-01-01", ate: "2026-06-30" })).toBeNull();
  });

  it("recorta pelas duas pontas", () => {
    expect(interseccao(SETEMBRO, { de: "2026-09-10", ate: "2026-10-20" }))
      .toEqual({ de: "2026-09-10", ate: "2026-09-30" });
  });

  it("um dia conta 1", () => {
    expect(diasEntre("2026-09-14", "2026-09-14")).toBe(1);
  });

  it("invertido conta 0", () => {
    expect(diasEntre("2026-09-14", "2026-09-01")).toBe(0);
  });
});
