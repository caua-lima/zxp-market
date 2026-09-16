import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Todo módulo de `lib/domain` tem alguém que o CHAMA?
 *
 * ─── O ERRO QUE ISTO GUARDA ──────────────────────────────────────────────
 *
 * Durante a auditoria eu conferi vários itens do brief perguntando "o módulo
 * existe?" — e existia. O que eu não perguntei foi "quem o chama?".
 *
 * A rota de Ads passou meses com `custoNaData` disponível, testado e ignorado:
 * ela lia o custo de hoje direto do documento e o aplicava a venda de março.
 * O módulo existia, os testes passavam, e a tela mostrava a margem errada.
 *
 * Módulo de domínio sem consumidor é pior que código faltando: parece que o
 * problema foi resolvido. Este teste transforma "ninguém usa" em falha.
 *
 * ─── O QUE ELE NÃO PEGA ──────────────────────────────────────────────────
 *
 * Um consumidor que importa o módulo e usa só metade dele. Isso continua
 * exigindo leitura — o teste prova que o módulo está ligado em algum lugar,
 * não que está ligado em todos os lugares onde deveria. Pra esse caso
 * específico das rotas financeiras existe `custo-historico.test.ts`.
 */

const RAIZ = process.cwd();

/** Arquivos que podem CONSUMIR um módulo de domínio. */
function consumidores(): string[] {
  const achados: string[] = [];
  const pular = new Set(["node_modules", ".next", ".git", "backups"]);

  function anda(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (pular.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p);
      // Teste não conta como consumidor: um módulo usado só pelo próprio teste
      // é exatamente o caso que este teste persegue.
      // `.mjs` entra porque os scripts de backup importam do domínio. Sem
      // eles na varredura, `backup-inventario` aparecia como órfão estando
      // importado por dois.
      else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) achados.push(p);
    }
  }

  for (const raiz of ["app", "components", "lib", "scripts"]) {
    const d = path.join(RAIZ, raiz);
    if (fs.existsSync(d)) anda(d);
  }
  return achados;
}

/** Os módulos de domínio, sem os testes e sem os arquivos só de tipo. */
function modulosDeDominio(): string[] {
  const dir = path.join(RAIZ, "lib", "domain");
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => n.replace(/\.ts$/, ""));
}

describe("módulos de domínio", () => {
  it("nenhum ficou sem consumidor — módulo órfão parece problema resolvido", () => {
    const arquivos = consumidores();
    const textos = new Map(arquivos.map((a) => [a, fs.readFileSync(a, "utf8")]));

    const orfaos: string[] = [];

    for (const mod of modulosDeDominio()) {
      const usado = [...textos].some(([arq, texto]) => {
        // O próprio módulo não conta como consumidor de si mesmo.
        if (arq.endsWith(path.join("lib", "domain", `${mod}.ts`))) return false;
        // A extensão `.ts` entra porque os scripts em .mjs precisam dela: o
        // Node resolve `../lib/domain/backup-inventario.ts`, não o caminho sem
        // extensão que o bundler aceita. Sem isso o módulo aparecia como órfão
        // estando importado por dois scripts.
        return (
          texto.includes(`domain/${mod}"`)
          || texto.includes(`domain/${mod}.ts"`)
          || texto.includes(`./${mod}"`)
          || texto.includes(`./${mod}.ts"`)
        );
      });
      if (!usado) orfaos.push(mod);
    }

    expect(orfaos, "módulos de domínio que ninguém importa").toEqual([]);
  });

  it("encontra consumidores de verdade — o teste não passa por vacuidade", () => {
    // Se a varredura estivesse quebrada, o teste acima passaria com a lista
    // vazia por não achar arquivo nenhum. Esta asserção fecha essa porta.
    expect(consumidores().length).toBeGreaterThan(50);
    expect(modulosDeDominio().length).toBeGreaterThan(20);
  });
});
