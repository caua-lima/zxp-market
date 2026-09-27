import { describe, expect, it } from "vitest";
import { cabecalhosDeSeguranca, politicaDeConteudo } from "./cabecalhos";

const mapa = (dev: boolean) => Object.fromEntries(cabecalhosDeSeguranca({ dev }).map((c) => [c.key, c.value]));

describe("S27 — cabeçalhos de segurança", () => {
  it("produção: HSTS, sem frame, nosniff, e a CSP só em relatório (não bloqueia o login)", () => {
    const h = mapa(false);
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8}/);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBeUndefined();
    expect(h["Content-Security-Policy-Report-Only"]).toContain("report-uri /api/csp-report");
  });

  it("o popup do Google continua podendo responder (COOP permite popups)", () => {
    expect(mapa(false)["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
  });

  it("a CSP cobre o que o app usa: Firebase, login do Google, push (gstatic no service worker)", () => {
    const csp = politicaDeConteudo({ dev: false });
    for (const esperado of ["https://*.googleapis.com", "wss://*.firebaseio.com", "https://*.firebaseapp.com", "https://accounts.google.com", "https://www.gstatic.com", "frame-ancestors 'none'", "object-src 'none'"]) {
      expect(csp).toContain(esperado);
    }
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("127.0.0.1");
  });

  it("dev: sem HSTS (localhost é http) e com o emulador liberado", () => {
    const h = mapa(true);
    expect(h["Strict-Transport-Security"]).toBeUndefined();
    expect(h["Content-Security-Policy-Report-Only"]).toContain("http://127.0.0.1:*");
  });
});
