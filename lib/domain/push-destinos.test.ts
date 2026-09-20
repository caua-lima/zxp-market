import { describe, expect, it } from "vitest";
import { diagnosticarRegistros, planejarDestinos, type RegistroDeDestino } from "./push-destinos";

function reg(over: Partial<RegistroDeDestino> & { docId: string }): RegistroDeDestino {
  return { token: `tok-${over.docId}`, updatedAt: 1000, deviceId: "", email: "a@zxp.com", userAgent: "", ...over };
}

describe("planejarDestinos — só o TOKEN repetido é prova de aparelho repetido", () => {
  it("dois celulares LEGADOS da mesma pessoa continuam sendo dois destinos", () => {
    // O dedupe antigo mantinha só um legado por e-mail: a pessoa perdia o outro aparelho sem saber.
    const r = planejarDestinos([reg({ docId: "t1", token: "t1" }), reg({ docId: "t2", token: "t2" })]);
    expect(r.map((x) => x.docId).sort()).toEqual(["t1", "t2"]);
  });

  it("um aparelho NOVO não derruba o legado de outro aparelho da mesma pessoa", () => {
    const novo = reg({ docId: "a@zxp.com__dev-1", deviceId: "dev-1", token: "tok-notebook" });
    const legadoDoCelular = reg({ docId: "tok-celular", token: "tok-celular" });
    expect(planejarDestinos([novo, legadoDoCelular])).toHaveLength(2);
  });

  it("o mesmo token em dois documentos vira um destino só — o mais recente", () => {
    const antigo = reg({ docId: "antigo", token: "T", updatedAt: 1 });
    const novo = reg({ docId: "novo", token: "T", updatedAt: 9 });
    expect(planejarDestinos([antigo, novo]).map((x) => x.docId)).toEqual(["novo"]);
    expect(planejarDestinos([novo, antigo]).map((x) => x.docId)).toEqual(["novo"]);
  });

  it("registro sem token não vira destino", () => {
    expect(planejarDestinos([reg({ docId: "x", token: "" })])).toEqual([]);
  });

  it("não escreve em nada — a função é pura", () => {
    const entrada = [reg({ docId: "a", token: "T" }), reg({ docId: "b", token: "T", updatedAt: 5 })];
    const copia = JSON.parse(JSON.stringify(entrada));
    planejarDestinos(entrada);
    expect(entrada).toEqual(copia);
  });
});

describe("diagnosticarRegistros — a simulação antes de qualquer limpeza", () => {
  it("separa os formatos e conta os candidatos SEM afirmar que são sobra", () => {
    const d = diagnosticarRegistros([
      reg({ docId: "a@zxp.com__dev-1", deviceId: "dev-1", token: "n1" }),
      reg({ docId: "l1", token: "l1" }),
      reg({ docId: "l2", token: "l2", email: "b@zxp.com" }),
    ]);
    expect(d).toMatchObject({ total: 3, comInstalacao: 1, legados: 2, legadosDeEmailComRegistroNovo: 1, semEmail: 0 });
  });

  it("só o token repetido é marcado como duplicata provada — e o mais novo fica", () => {
    const d = diagnosticarRegistros([
      reg({ docId: "velho", token: "T", updatedAt: 1 }),
      reg({ docId: "novo", token: "T", updatedAt: 9 }),
      reg({ docId: "outro", token: "U" }),
    ]);
    expect(d.duplicadosPorToken).toEqual(["velho"]);
  });

  it("conta órfãos sem e-mail", () => {
    expect(diagnosticarRegistros([reg({ docId: "o", email: "" })]).semEmail).toBe(1);
  });

  it("lista vazia: tudo zero", () => {
    expect(diagnosticarRegistros([])).toEqual({ total: 0, comInstalacao: 0, legados: 0, legadosDeEmailComRegistroNovo: 0, duplicadosPorToken: [], semEmail: 0 });
  });
});
