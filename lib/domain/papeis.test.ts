import { describe, expect, it } from "vitest";
import { ABAS_DO_MEMBER, papelDe, podeVerAba, roleLabel } from "./types";

const TODAS = ["dashboard", "pedidos", "ads", "preco", "metas", "custos",
  "estoque", "full", "desempenho", "dre", "tarefas", "acesso"];

describe("papelDe — normaliza o que está gravado", () => {
  it("owner e member são reconhecidos", () => {
    expect(papelDe("owner")).toBe("owner");
    expect(papelDe("member")).toBe("member");
    expect(papelDe("partner")).toBe("partner");
  });

  it("os papéis LEGADOS viram partner, nunca member", () => {
    /**
     * Contas antigas gravadas como "colaborador"/"admin"/"user" já viam tudo.
     * Rebaixá-las pra member na migração tiraria acesso de gente que trabalha
     * — e ninguém saberia por quê. Partner é exatamente o que elas já eram.
     */
    for (const legado of ["colaborador", "admin", "user"] as const) {
      expect(papelDe(legado)).toBe("partner");
    }
  });

  it("ausente ou nulo cai em partner, não em owner", () => {
    // Errar pro lado de menos poder: um registro corrompido não pode virar dono.
    expect(papelDe(undefined)).toBe("partner");
    expect(papelDe(null)).toBe("partner");
  });
});

describe("podeVerAba", () => {
  it("owner vê tudo, inclusive Acesso", () => {
    for (const aba of TODAS) expect(podeVerAba("owner", aba)).toBe(true);
  });

  it("Sócio (partner) vê Dashboard, Pedidos, Tarefas e DRE — os acessos pedidos em 03/11/2026", () => {
    expect(TODAS.filter((a) => podeVerAba("partner", a))).toEqual(["dashboard", "pedidos", "dre", "tarefas"]);
  });

  it("member só vê o Dashboard", () => {
    const vistas = TODAS.filter((a) => podeVerAba("member", a));
    expect(vistas).toEqual(["dashboard"]);
  });

  it("member NÃO alcança nada que revele custo, margem, preço ou estoque", () => {
    // O ponto inteiro do papel. Se um destes passar, ele deixou de existir.
    for (const aba of ["custos", "preco", "estoque", "dre", "full", "metas", "ads"]) {
      expect(podeVerAba("member", aba)).toBe(false);
    }
  });

  it("Acesso é do owner, e nem partner nem member chegam nele", () => {
    expect(podeVerAba("partner", "acesso")).toBe(false);
    expect(podeVerAba("member", "acesso")).toBe(false);
  });

  it("aba desconhecida não é liberada pro member por descuido", () => {
    expect(podeVerAba("member", "aba-que-ainda-nao-existe")).toBe(false);
    // O Sócio também não: a lista dele é fechada.
    expect(podeVerAba("partner", "aba-que-ainda-nao-existe")).toBe(false);
    expect(podeVerAba("equipe", "aba-que-ainda-nao-existe")).toBe(false);
  });

  it("a lista do member é a fonte única da regra", () => {
    for (const aba of ABAS_DO_MEMBER) expect(podeVerAba("member", aba)).toBe(true);
  });
});

describe("roleLabel", () => {
  it("os três acessos: Master, Sócio e Colaborador", () => {
    expect(roleLabel("owner")).toBe("Master");
    expect(roleLabel("partner")).toBe("Sócio");
    expect(roleLabel("equipe")).toBe("Colaborador");
    expect(roleLabel("member")).toBe("Partner");
  });

  it("o valor LEGADO 'colaborador' é Sócio (partner), não o Colaborador de agora", () => {
    expect(roleLabel("colaborador")).toBe("Sócio");
  });
});

describe("equipe (funcionário)", () => {
  it("é reconhecido e rotulado", () => {
    expect(papelDe("equipe")).toBe("equipe");
    expect(roleLabel("equipe")).toBe("Colaborador");
  });
  it("só alcança a aba Tarefas", () => {
    for (const aba of TODAS) expect(podeVerAba("equipe", aba)).toBe(aba === "tarefas");
  });
});
