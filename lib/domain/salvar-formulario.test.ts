import { describe, it, expect, vi } from "vitest";
import { mensagemDeErroDeSalvamento, salvarSemPerder } from "./salvar-formulario";

describe("salvarSemPerder", () => {
  it("sucesso: ok, e a gravação rodou uma vez", async () => {
    const gravar = vi.fn().mockResolvedValue(undefined);
    expect(await salvarSemPerder(gravar)).toEqual({ ok: true });
    expect(gravar).toHaveBeenCalledTimes(1);
  });

  it("falha: devolve a mensagem em vez de lançar — quem chama NÃO fecha o formulário", async () => {
    const r = await salvarSemPerder(async () => { throw Object.assign(new Error("x"), { code: "permission-denied" }); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toMatch(/permissão/);
  });

  it("depois de falhar, tentar de novo funciona (repetir não fica travado)", async () => {
    let tentativas = 0;
    const gravar = async () => { tentativas++; if (tentativas === 1) throw new Error("timeout"); };
    expect((await salvarSemPerder(gravar)).ok).toBe(false);
    expect((await salvarSemPerder(gravar)).ok).toBe(true);
    expect(tentativas).toBe(2);
  });
});

describe("mensagemDeErroDeSalvamento", () => {
  it("permissão negada", () => {
    expect(mensagemDeErroDeSalvamento({ code: "permission-denied" })).toMatch(/permissão/);
    expect(mensagemDeErroDeSalvamento(new Error("Missing or insufficient permissions."))).toMatch(/permissão/);
  });
  it("rede / timeout", () => {
    expect(mensagemDeErroDeSalvamento({ code: "unavailable" })).toMatch(/servidor/);
    expect(mensagemDeErroDeSalvamento(new Error("Request timed out"))).toMatch(/servidor/);
  });
  it("erro desconhecido leva o detalhe e diz que o digitado continua", () => {
    const m = mensagemDeErroDeSalvamento(new Error("valor inválido"));
    expect(m).toMatch(/valor inválido/);
    expect(m).toMatch(/continua aqui/);
  });
  it("sem detalhe nenhum, ainda diz algo útil", () => {
    expect(mensagemDeErroDeSalvamento(undefined)).toMatch(/continua aqui/);
  });
});
