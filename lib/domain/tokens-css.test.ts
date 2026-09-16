import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Toda `var(--x)` do código aponta pra uma variável que existe?
 *
 * ─── POR QUE ESTE TESTE EXISTE ───────────────────────────────────────────
 *
 * Porque eu escrevi `var(--gold)` em cinco arquivos e a variável se chama
 * `--yellow`. O CSS não reclama: `var()` sem valor e sem fallback devolve o
 * valor herdado, então o selo "Parcial — falta informação" saiu na cor cinza
 * de "Carregando", em vez de âmbar, e nada quebrou.
 *
 * É a pior classe de erro visual que existe: silenciosa, plausível e
 * espalhada. O TypeScript não vê (é string), o lint não vê, o build passa, a
 * tela abre. Só apareceu quando eu fui LER a cor computada no navegador.
 *
 * Um teste que compara os dois lados custa nada e fecha a porta.
 */

const RAIZ = process.cwd();

function arquivosDeCodigo(): string[] {
  const achados: string[] = [];
  const pular = new Set(["node_modules", ".next", ".git", "backups"]);

  function anda(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (pular.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (/\.(tsx?|css)$/.test(e.name)) achados.push(p);
    }
  }
  anda(RAIZ);
  return achados;
}

/** As variáveis declaradas — em qualquer `:root`, `[data-theme]` ou seletor. */
function declaradas(): Set<string> {
  const css = fs.readFileSync(path.join(RAIZ, "app", "globals.css"), "utf8");
  const nomes = new Set<string>();
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) nomes.add(m[1]);

  /**
   * As do `next/font` não moram no CSS: o loader injeta a variável no
   * `<html>` em tempo de execução (ver app/layout.tsx). São lidas de lá pra
   * que continuem cobertas — e pra que renomear uma delas no layout ainda
   * quebre o teste.
   */
  const layout = fs.readFileSync(path.join(RAIZ, "app", "layout.tsx"), "utf8");
  for (const m of layout.matchAll(/variable:\s*"(--[a-zA-Z0-9-]+)"/g)) nomes.add(m[1]);

  return nomes;
}

describe("variáveis CSS", () => {
  const conhecidas = declaradas();

  it("globals.css declara as variáveis de marca", () => {
    for (const n of ["--brand", "--yellow", "--green", "--red", "--muted", "--text"]) {
      expect(conhecidas, n).toContain(n);
    }
  });

  it("nenhum `var(--x)` aponta pra variável que não existe", () => {
    const quebradas: string[] = [];

    for (const arq of arquivosDeCodigo()) {
      // Este próprio arquivo cita `var(--gold)` e `var(--x)` como exemplo.
      if (arq.endsWith("tokens-css.test.ts")) continue;
      const texto = fs.readFileSync(arq, "utf8");
      texto.split("\n").forEach((linha, i) => {
        for (const m of linha.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
          const nome = m[1];
          // `var(--x, algo)` tem fallback: mesmo sem a variável, a cor sai
          // definida. Não é o bug que este teste persegue.
          if (m[2] === ",") continue;
          if (conhecidas.has(nome)) continue;
          quebradas.push(`${path.relative(RAIZ, arq)}:${i + 1}  var(${nome})`);
        }
      });
    }

    expect(quebradas, "variáveis CSS inexistentes (cor sai herdada, sem erro)").toEqual([]);
  });

  it("o próprio teste pega o caso que motivou ele", () => {
    // --gold nunca existiu; --yellow é o nome real do dourado da marca.
    expect(conhecidas.has("--gold")).toBe(false);
    expect(conhecidas.has("--yellow")).toBe(true);
  });
});
