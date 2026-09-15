import { describe, expect, it } from "vitest";
import {
  CAMPOS_FINANCEIROS_DA_REMESSA,
  patchCusto,
  patchIgnorar,
  patchLimparCusto,
  patchReabrir,
  tocaFinanceiro,
} from "./remessa-full";

describe("acao operacional nao encosta no financeiro", () => {
  it("ignorar nao cita custo nenhum", () => {
    /**
     * `ignorarRemessaFull` fazia setDoc SEM merge — o que no Firestore
     * SUBSTITUI o documento inteiro. Marcar uma remessa como resolvida apagava
     * o custo da coleta que alguem tinha digitado a mao.
     */
    expect(tocaFinanceiro(patchIgnorar("dono@zxp.com", "baixa ja lancada"))).toBe(false);
  });

  it("reabrir nao cita custo nenhum", () => {
    // `reabrirRemessaFull` fazia deleteDoc: destruia o documento inteiro.
    expect(tocaFinanceiro(patchReabrir())).toBe(false);
  });

  it("os dois patches so tem chaves operacionais conhecidas", () => {
    const permitidas = new Set(["ignorada", "motivo", "ignoradaPor", "ignoradaEm"]);
    for (const patch of [patchIgnorar("a@b.com", "x"), patchReabrir()]) {
      for (const chave of Object.keys(patch)) {
        expect(permitidas.has(chave), `chave inesperada: ${chave}`).toBe(true);
      }
    }
  });

  it("nenhum campo financeiro some da lista sem alguem notar", () => {
    // Se um campo novo de dinheiro entrar no documento, ele tem que entrar
    // aqui tambem — senao a protecao acima passa a ignora-lo em silencio.
    expect([...CAMPOS_FINANCEIROS_DA_REMESSA]).toEqual([
      "custoManual", "custoInformadoPor", "custoInformadoEm",
    ]);
  });
});

describe("patchIgnorar", () => {
  it("marca como ignorada com motivo e autor", () => {
    const p = patchIgnorar("dono@zxp.com", "baixa ja lancada a mao");
    expect(p.ignorada).toBe(true);
    expect(p.motivo).toBe("baixa ja lancada a mao");
    expect(p.ignoradaPor).toBe("dono@zxp.com");
    expect(typeof p.ignoradaEm).toBe("number");
  });
});

describe("patchReabrir", () => {
  it("desliga o estado em vez de apagar o documento", () => {
    const p = patchReabrir();
    expect(p.ignorada).toBe(false);
  });

  it("limpa o motivo junto — motivo orfao explica um estado que nao existe mais", () => {
    const p = patchReabrir();
    expect(p.motivo).toBeNull();
    expect(p.ignoradaPor).toBeNull();
    expect(p.ignoradaEm).toBeNull();
  });
});

describe("custo — apagar e uma operacao explicita", () => {
  it("informar guarda valor, autor e momento", () => {
    const p = patchCusto("dono@zxp.com", 128.5);
    expect(p.custoManual).toBe(128.5);
    expect(p.custoInformadoPor).toBe("dono@zxp.com");
  });

  it("null limpa — 'conferi e nao ha custo' e diferente de 'ninguem olhou'", () => {
    expect(patchCusto("dono@zxp.com", null).custoManual).toBeNull();
  });

  it("valor invalido vira null, nao NaN", () => {
    // NaN somado contamina o total do Full inteiro.
    expect(patchCusto("a@b.com", Number.NaN).custoManual).toBeNull();
    expect(patchCusto("a@b.com", Infinity).custoManual).toBeNull();
  });

  it("apagar fica registrado igual a informar", () => {
    const p = patchLimparCusto("dono@zxp.com");
    expect(p.custoManual).toBeNull();
    expect(p.custoInformadoPor).toBe("dono@zxp.com");
    expect(typeof p.custoInformadoEm).toBe("number");
  });

  it("zero e um custo valido, nao ausencia", () => {
    expect(patchCusto("a@b.com", 0).custoManual).toBe(0);
  });
});
