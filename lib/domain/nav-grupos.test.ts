import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { marcarAberturaDeGrupo, gruposVisiveis, grupoRepetido } from "./nav-grupos";

const lista = [
  { id: "dashboard", grupo: "visao" },
  { id: "metas", grupo: "visao" },
  { id: "pedidos", grupo: "comercial" },
  { id: "estoque", grupo: "operacao" },
  { id: "acesso", grupo: "admin" },
];

describe("marcarAberturaDeGrupo", () => {
  it("o primeiro item abre o grupo, o segundo não", () => {
    const m = marcarAberturaDeGrupo(lista);
    expect(m.map((x) => x.abreGrupo)).toEqual([true, false, true, true, true]);
  });

  it("lista vazia não explode", () => {
    expect(marcarAberturaDeGrupo([])).toEqual([]);
  });

  it("um item só abre o grupo dele", () => {
    expect(marcarAberturaDeGrupo([{ grupo: "visao" }])[0].abreGrupo).toBe(true);
  });

  it("preserva os campos do item", () => {
    expect(marcarAberturaDeGrupo(lista)[0].id).toBe("dashboard");
  });
});

describe("nenhum cabeçalho fica sem item embaixo", () => {
  it("member só vê o Dashboard: um grupo, um título", () => {
    const so = lista.filter((x) => x.id === "dashboard");
    expect(gruposVisiveis(so)).toEqual(["visao"]);
    expect(marcarAberturaDeGrupo(so)).toHaveLength(1);
  });

  it("partner não vê Acesso: o título Administração some junto", () => {
    const sem = lista.filter((x) => x.id !== "acesso");
    expect(gruposVisiveis(sem)).not.toContain("admin");
  });

  it("filtrar o primeiro de um grupo promove o segundo a abridor", () => {
    const sem = lista.filter((x) => x.id !== "dashboard");
    expect(marcarAberturaDeGrupo(sem)[0]).toMatchObject({ id: "metas", abreGrupo: true });
  });
});

describe("grupoRepetido", () => {
  it("a lista em ordem não reparte grupo nenhum", () => {
    expect(grupoRepetido(lista)).toBe(false);
  });

  it("fora de ordem, o mesmo título apareceria duas vezes", () => {
    const fora = [{ grupo: "visao" }, { grupo: "comercial" }, { grupo: "visao" }];
    expect(grupoRepetido(fora)).toBe(true);
  });
});

/**
 * A lista de verdade, lida do app: é ela que precisa estar agrupada em ordem,
 * e um item novo colado no fim do arquivo é exatamente como o agrupamento se
 * perderia sem ninguém notar.
 */
describe("a navegação real do app", () => {
  const fonte = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf8");
  const itens = [...fonte.matchAll(/\{ id: "(\w+)", label: "[^"]+", grupo: "(\w+)" \}/g)]
    .map((m) => ({ id: m[1], grupo: m[2] }));

  it("todos os itens foram encontrados", () => {
    expect(itens.length).toBeGreaterThanOrEqual(12);
  });

  it("cada item tem um grupo conhecido", () => {
    const validos = ["visao", "comercial", "operacao", "financeiro", "desempenho", "admin"];
    for (const i of itens) expect(validos, i.id).toContain(i.grupo);
  });

  it("nenhum grupo aparece duas vezes — item novo no fim quebraria aqui", () => {
    expect(grupoRepetido(itens)).toBe(false);
  });

  it("o Dashboard é o primeiro", () => {
    expect(itens[0].id).toBe("dashboard");
  });
});
