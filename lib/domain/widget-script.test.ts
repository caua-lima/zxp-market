import { describe, expect, it } from "vitest";
import { scriptDoWidget } from "./widget-script";
import { FORMATO_TOKEN, hashDoToken, novoToken } from "./widget-token";

describe("scriptDoWidget", () => {
  const url = "https://app.exemplo.com/api/widget/ao-vivo?t=zw_abc";
  it("sai como JavaScript válido, com o endereço dentro e sem sobra de template", () => {
    const js = scriptDoWidget(url);
    expect(js).toContain(`const URL_API = ${JSON.stringify(url)};`);
    expect(js).not.toMatch(/\$\{|`/);
    // Só confere a sintaxe (o Scriptable fornece FileManager, ListWidget etc. na hora de rodar).
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    expect(() => new AsyncFunction(js)).not.toThrow();
  });
  it("endereço com aspas ou quebra de linha não quebra o script", () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    expect(() => new AsyncFunction(scriptDoWidget('https://x/"\n;alert(1)//'))).not.toThrow();
  });
  it("cobre a tela inicial e os três tamanhos da tela de bloqueio", () => {
    const js = scriptDoWidget(url);
    for (const f of ["accessoryInline", "accessoryCircular", "backgroundImage"]) expect(js).toContain(f);
  });
});

describe("widget-token", () => {
  it("token no formato, único e com hash estável", () => {
    const a = novoToken(), b = novoToken();
    expect(a).toMatch(FORMATO_TOKEN);
    expect(a).not.toBe(b);
    expect(hashDoToken(a)).toBe(hashDoToken(a));
    expect(hashDoToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoToken(a)).not.toContain(a.slice(3, 15));
  });
  it("formato recusa lixo", () => {
    for (const ruim of ["", "zw_", "zw_curto", "xx_" + "a".repeat(43), "zw_" + "a".repeat(44), "zw_" + "a".repeat(42) + "/"]) expect(ruim).not.toMatch(FORMATO_TOKEN);
  });
});
