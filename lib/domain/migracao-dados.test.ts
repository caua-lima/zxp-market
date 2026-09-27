import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESTINOS, SUBCOLECOES_CONHECIDAS, caminhoNoTenant, colecoesPara } from "./migracao-dados";

/** Todo arquivo de código do app (sem node_modules, sem .next, sem testes). */
function arquivosDoApp(dir: string, saida: string[] = []): string[] {
  for (const nome of fs.readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "backups"].includes(nome)) continue;
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) arquivosDoApp(p, saida);
    else if (/\.(ts|tsx|mjs)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(p);
  }
  return saida;
}

const PADROES = [
  /(?:collection|sCol|sDoc|collectionGroup)\(\s*(?:[a-zA-Z_.()]+\s*,\s*)?["']([a-zA-Z_]+)["']/g,
  /const\s+(?:COL|COLECAO[A-Z_]*|[A-Z_]*_COL)\s*=\s*["']([a-zA-Z_]+)["']/g,
];

describe("DESTINOS — toda coleção tem decisão (Etapa 5)", () => {
  it("toda coleção que o código usa tem destino na migração — coleção nova sem decisão QUEBRA isto", () => {
    const raiz = process.cwd();
    const achadas = new Set<string>();
    for (const dir of ["app", "lib", "components", "hooks", "scripts"]) {
      const d = path.join(raiz, dir);
      if (!fs.existsSync(d)) continue;
      for (const arq of arquivosDoApp(d)) {
        const texto = fs.readFileSync(arq, "utf8");
        for (const re of PADROES) for (const m of texto.matchAll(re)) achadas.add(m[1]);
      }
    }
    const semDecisao = [...achadas].filter((c) => !DESTINOS[c] && !(SUBCOLECOES_CONHECIDAS as readonly string[]).includes(c));
    expect(semDecisao).toEqual([]);
    // Sanidade da varredura: ela acha o que sabemos que existe.
    for (const c of ["ml_orders", "estoque", "estoque_movimentos", "notification_outbox", "ml_webhook_inbox"]) expect(achadas.has(c)).toBe(true);
  });

  it("o que é irrecuperável no inventário de backup e é da empresa vai pro tenant", () => {
    for (const c of ["estoque", "estoque_movimentos", "custos", "full_remessas", "metas", "metasHistorico", "tarefas", "auditLog", "dias"]) {
      expect(DESTINOS[c].destino).toBe("tenant");
    }
  });

  it("segredo e contador descartável não são copiados; o que é da pessoa fica na raiz", () => {
    expect(DESTINOS.ml_oauth_transacoes.destino).toBe("nao_migra");
    expect(DESTINOS.usuarios.destino).toBe("global");
    expect(DESTINOS.pushTokens.destino).toBe("global");
    expect(DESTINOS.ml_tokens.destino).toBe("conexao");
  });

  it("caminhoNoTenant recusa id que escaparia do caminho", () => {
    expect(caminhoNoTenant("vazxpress", "estoque")).toBe("tenants/vazxpress/estoque");
    for (const ruim of ["", "a", "../x", "Vaz", "a/b"]) expect(() => caminhoNoTenant(ruim, "estoque")).toThrow();
  });

  it("colecoesPara lista só as do destino pedido", () => {
    expect(colecoesPara("conexao")).toEqual(["ml_tokens"]);
    expect(colecoesPara("tenant")).toContain("ml_orders");
    expect(colecoesPara("tenant")).not.toContain("usuarios");
  });
});
