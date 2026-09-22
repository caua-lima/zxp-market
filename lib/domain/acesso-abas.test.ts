import { describe, expect, it } from "vitest";
import { abaEhEditavel, type PermissionTab } from "./types";

/**
 * Achado S17 da auditoria SaaS: app/page.tsx decidia o banner "somente
 * leitura" por `!isOwner` global, enquanto EstoqueTab/CustosTab/MetasTab/Ads
 * perguntam `canEditTab(aba)` (permissão granular) pra mostrar os próprios
 * botões — um partner com só "estoque" liberado via a banner "somente
 * leitura" ao lado de botões de editar ativos.
 */
describe("abaEhEditavel", () => {
  const ctx = (liberadas: PermissionTab[]) => ({
    isOwner: false,
    canEditTab: (tab: PermissionTab) => liberadas.includes(tab),
  });

  it("owner edita qualquer aba", () => {
    for (const aba of ["dashboard", "pedidos", "ads", "preco", "metas", "custos", "estoque", "full", "desempenho", "dre", "tarefas", "acesso"]) {
      expect(abaEhEditavel(aba, { isOwner: true, canEditTab: () => false }), aba).toBe(true);
    }
  });

  it("partner com so 'estoque' liberado: estoque editavel, custos NAO — nada de contradicao com o banner global antigo", () => {
    const c = ctx(["estoque"]);
    expect(abaEhEditavel("estoque", c)).toBe(true);
    expect(abaEhEditavel("custos", c)).toBe(false);
    expect(abaEhEditavel("metas", c)).toBe(false);
    expect(abaEhEditavel("ads", c)).toBe(false);
  });

  it("DRE herda a permissao de custos (cadastro rapido embutido nela)", () => {
    expect(abaEhEditavel("dre", ctx(["custos"]))).toBe(true);
    expect(abaEhEditavel("dre", ctx(["estoque"]))).toBe(false);
  });

  it("tarefas e sempre editavel por quem tem acesso, mesmo sem nenhuma permissao granular", () => {
    expect(abaEhEditavel("tarefas", ctx([]))).toBe(true);
  });

  it("acesso, dashboard, pedidos, preco, full e desempenho sao tudo-ou-nada do owner", () => {
    const c = ctx(["custos", "metas", "estoque", "ads"]); // todas as granulares liberadas
    for (const aba of ["acesso", "dashboard", "pedidos", "preco", "full", "desempenho"]) {
      expect(abaEhEditavel(aba, c), aba).toBe(false);
    }
  });
});
