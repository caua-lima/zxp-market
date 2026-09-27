import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCOS_DO_TENANT, FIM, INICIO, aplicarSecaoDoTenant } from "./regras-tenant";
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
