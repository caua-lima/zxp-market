import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCOS_DO_TENANT, FIM, INICIO, aplicarSecaoDoTenant, travarEscritas } from "./regras-tenant";
import { DESTINOS } from "./migracao-dados";

const regras = fs.readFileSync("firestore.rules", "utf8");

describe("regras do tenant geradas da raiz (Etapa 3)", () => {
  it("firestore.rules está em dia — regra da raiz alterada sem regenerar QUEBRA isto (npm run regras:gerar)", () => {
    expect(aplicarSecaoDoTenant(regras)).toBe(regras);
  });

  it("gerar de novo não muda nada (idempotente)", () => {
    const uma = aplicarSecaoDoTenant(regras);
    expect(aplicarSecaoDoTenant(uma)).toBe(uma);
  });

  it("a seção existe uma vez só, dentro de /tenants/{tenantId}", () => {
    expect(regras.split(INICIO).length - 1).toBe(1);
    expect(regras.split(FIM).length - 1).toBe(1);
    expect(regras.indexOf(INICIO)).toBeGreaterThan(regras.indexOf("match /tenants/{tenantId} {"));
  });

  it("dentro da seção, ninguém é autorizado por controleAcesso — só por membro da empresa", () => {
    const secao = regras.slice(regras.indexOf(INICIO), regras.indexOf(FIM));
    expect(secao).not.toMatch(/controleAcesso/);
    expect(secao).not.toMatch(/\b(isOwner|isAuthorized|veOperacao|podeEditar|isMember|requesterDoc)\(/);
    expect(secao).not.toMatch(/documents\/(?!tenants\/\$\(tenantId\))/);
  });

  it("cobre toda coleção de tenant que tem regra na raiz", () => {
    const comRegraNaRaiz = Object.entries(DESTINOS)
      .filter(([c, d]) => d.destino === "tenant" && regras.includes(`match /${c}/`))
      .map(([c]) => c);
    const cobertas = BLOCOS_DO_TENANT.map((b) => b.split("/")[1]);
    for (const c of comRegraNaRaiz) expect(cobertas).toContain(c);
  });
});

describe("S25 — trava de escrita da empresa bloqueada", () => {
  it("toda escrita ganha a trava; leitura não; `read, write` vira dois", () => {
    const entrada = [
      "allow read: if veOperacaoT();",
      "allow write: if podeEditarT('estoque')\n  && produtoValido(request.resource.data);",
      "allow read, write: if isOwnerT();",
      "allow create, delete: if false;",
    ].join("\n");
    expect(travarEscritas(entrada)).toBe([
      "allow read: if veOperacaoT();",
      "allow write: if escritaLiberadaT() && (podeEditarT('estoque')\n  && produtoValido(request.resource.data));",
      "allow read: if isOwnerT(); allow write: if escritaLiberadaT() && (isOwnerT());",
      "allow create, delete: if escritaLiberadaT() && (false);",
    ].join("\n"));
  });

  it("nas regras geradas, nenhuma escrita do dado da empresa escapa da trava", () => {
    const regras = fs.readFileSync("firestore.rules", "utf8").replace(/\r\n/g, "\n");
    const secao = regras.slice(regras.indexOf(INICIO), regras.indexOf(FIM));
    const escritas = [...secao.matchAll(/allow ([a-z, ]+):\s*if ([^;]*);/g)].filter(([, ops]) => /write|create|update|delete/.test(ops));
    expect(escritas.length).toBeGreaterThan(20);
    for (const [linha, , cond] of escritas) expect(cond.startsWith("escritaLiberadaT() && ("), linha).toBe(true);
  });
});
