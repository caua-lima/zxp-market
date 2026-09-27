import { describe, expect, it } from "vitest";
import { linhaDeLog, redigir, redigirTexto } from "./log";
import { abrirContextoDaRequisicao, comTenant } from "./firebase/contexto-tenant";

describe("S27 — log estruturado com redação e correlação", () => {
  it("campo sensível pelo NOME sai redigido, em qualquer profundidade", () => {
    const r = redigir({ ok: 1, access_token: "APP_USR-123", buyer: { email: "a@b.com", phone: { number: "119" }, nickname: "COMPRADOR" }, receiver_address: { street_name: "Rua X" } });
    expect(r).toEqual({ ok: 1, access_token: "[redigido]", buyer: { email: "[redigido]", phone: "[redigido]", nickname: "COMPRADOR" }, receiver_address: "[redigido]" });
  });

  it("segredo pelo FORMATO sai redigido mesmo dentro de mensagem de erro", () => {
    const erro = new Error("falhou com Bearer APP_USR-abc.def pra fulano@exemplo.com e whsec_abcdef123456");
    const r = redigir({ erro }) as { erro: { mensagem: string } };
    expect(r.erro.mensagem).not.toMatch(/APP_USR|fulano|whsec_abc/);
    expect(redigirTexto("-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----")).toBe("[chave redigida]");
    expect(redigirTexto("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4")).toBe("[jwt redigido]");
  });

  it("cada linha leva a empresa e a requisição de onde veio", () => {
    const linha = (() => {
      abrirContextoDaRequisicao("req-42");
      return comTenant("emp-a", () => JSON.parse(linhaDeLog("error", "cron", { mensagem: "sync falhou" })));
    })();
    expect(linha).toMatchObject({ nivel: "error", evento: "cron", tenantId: "emp-a", requisicao: "req-42", mensagem: "sync falhou" });
  });
});
