import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Contratos de LEITURA sobre o CSS e o TSX — o que deu defeito e não pode voltar.
 *
 * Não substituem olhar a tela (nada aqui mede layout renderizado), mas pegam,
 * em milissegundos e em qualquer máquina, os erros que só apareciam num celular
 * estreito ou num leitor de tela.
 */

const RAIZ = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(RAIZ, "app/globals.css"), "utf8");

function arquivos(dir: string, ext: string[]): string[] {
  const saida: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivos(p, ext));
    else if (ext.some((x) => e.name.endsWith(x))) saida.push(p);
  }
  return saida;
}
const tsx = [...arquivos(path.join(RAIZ, "components"), [".tsx"]), ...arquivos(path.join(RAIZ, "app"), [".tsx"])];

// ─── contraste ───────────────────────────────────────────────────────────
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function token(nome: string): string {
  const m = css.match(new RegExp(`--${nome}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token --${nome} não encontrado (ou não é #rrggbb)`);
  return m[1];
}

describe("contraste dos tokens de TEXTO sobre as superfícies (WCAG 1.4.3: 4,5:1)", () => {
  const superficies = ["surface", "surface2", "surface-raised", "sidebar"].map((n) => [n, token(n)] as const);

  for (const t of ["red-text", "text-muted", "muted", "green"]) {
    it(`--${t} é legível como texto pequeno`, () => {
      const cor = token(t);
      for (const [nome, fundo] of superficies) {
        expect(contraste(cor, fundo), `--${t} sobre --${nome}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("o texto do .btn-purple tem contraste sobre o roxo do botão", () => {
    const m = css.match(/\.btn-purple\{background:(#[0-9A-Fa-f]{6})/);
    expect(m).not.toBeNull();
    expect(contraste(token("color-ivory"), m![1])).toBeGreaterThanOrEqual(4.5);
  });

  it("nenhuma cor de TEXTO usa o --red de preenchimento (que dá 3,6:1 no --surface2)", () => {
    const ruins: string[] = [];
    for (const p of tsx) {
      const s = fs.readFileSync(p, "utf8");
      if (/(?<![-\w])color: ?"var\(--red\)"/.test(s)) ruins.push(path.relative(RAIZ, p));
    }
    expect(ruins).toEqual([]);
    expect(css).not.toMatch(/(?<![-\w])color: ?var\(--red\)/);
  });
});

describe("rótulos de formulário: legíveis e sem truncar", () => {
  const regras = [...css.matchAll(/\.(field-group|edit-field|config-field) label\{([^}]*)\}/g)];

  it("existem as regras que esperamos", () => {
    expect(regras.length).toBeGreaterThanOrEqual(3);
  });

  it("nenhum tem fonte abaixo de 13px (.8125rem), nem clamp com piso menor", () => {
    for (const [, nome, corpo] of regras) {
      const fs_ = corpo.match(/font-size:([^;]+)/)?.[1] ?? "";
      const pisos = [...fs_.matchAll(/(\d*\.?\d+)rem/g)].map((m) => Number(m[1]));
      expect(pisos.length, `${nome}: font-size sem rem`).toBeGreaterThan(0);
      expect(Math.min(...pisos), `${nome}: ${fs_}`).toBeGreaterThanOrEqual(0.8125);
    }
  });

  it("nenhum usa nowrap com reticências (a unidade some atrás delas)", () => {
    for (const [, nome, corpo] of regras) {
      expect(corpo, nome).not.toMatch(/white-space:\s*nowrap/);
      expect(corpo, nome).not.toMatch(/text-overflow:\s*ellipsis/);
    }
  });
});

describe("grids: o mínimo da coluna nunca passa da largura do contêiner", () => {
  it("nenhum minmax(Npx, 1fr) com N >= 200 sem o teto min(N, 100%)", () => {
    const ruins: string[] = [];
    const rx = /minmax\((\d{3,4})px, ?1fr\)/g;
    for (const p of [...tsx, path.join(RAIZ, "app/globals.css")]) {
      const s = fs.readFileSync(p, "utf8");
      for (const m of s.matchAll(rx)) if (Number(m[1]) >= 200) ruins.push(`${path.relative(RAIZ, p)}: ${m[0]}`);
    }
    expect(ruins).toEqual([]);
  });
});

describe("cores: sufixo hexadecimal só vale sobre hexadecimal", () => {
  it("nenhum `${cor}NN` no TSX (com var() vira CSS inválido e a borda some)", () => {
    const ruins: string[] = [];
    for (const p of tsx) {
      const s = fs.readFileSync(p, "utf8");
      for (const m of s.matchAll(/\$\{[^}]+\}[0-9a-fA-F]{2}(?=[`'"\s;,)])/g)) ruins.push(`${path.relative(RAIZ, p)}: ${m[0]}`);
    }
    expect(ruins).toEqual([]);
  });
});
