import { describe, expect, it } from "vitest";
import {
  agruparBaixasPorRemessa,
  remessaDoMovimento,
  type MovimentoParaAgrupar,
} from "./remessa-agrupada";

const nomes = new Map([
  ["p-boldo", "Erva Boldo & Menta"],
  ["p-limao", "Erva Limão Caipira"],
  ["p-pura", "Erva Pura Folha"],
  ["p-trad", "Erva Tradicional"],
]);

const mov = (over: Partial<MovimentoParaAgrupar> = {}): MovimentoParaAgrupar => ({
  id: "full-75664648-p-boldo", productId: "p-boldo", tipo: "saida_full",
  quantidade: 40, data: "2026-09-03", obs: "Remessa Full #75664648 · baixa automática", ...over,
});

describe("remessaDoMovimento", () => {
  it("extrai o número do id `full-{remessa}-{produto}`", () => {
    expect(remessaDoMovimento("full-75664648-p-boldo", "p-boldo")).toBe("75664648");
  });

  it("produto com hífen no id não bagunça a separação", () => {
    /**
     * Separar pelo primeiro hífen daria "75664648" e sobraria lixo; separar
     * pelo último daria remessa errada. Por isso a extração reconstrói o id
     * e confere.
     */
    expect(remessaDoMovimento("full-75664648-p-boldo-menta", "p-boldo-menta")).toBe("75664648");
  });

  it("id fora do padrão não pertence a remessa nenhuma", () => {
    expect(remessaDoMovimento("1756-abc-xyz", "p-boldo")).toBeNull();
    expect(remessaDoMovimento("full-p-boldo", "p-boldo")).toBeNull();
    expect(remessaDoMovimento("", "p-boldo")).toBeNull();
  });

  it("id que não termina no produto informado é recusado", () => {
    // Protege contra agrupar movimento de OUTRO produto na mesma remessa.
    expect(remessaDoMovimento("full-75664648-p-boldo", "p-limao")).toBeNull();
  });
});

/**
 * Envio 75664648 desta conta, conferido contra o painel do ML: 260 unidades
 * em 4 produtos, processamento finalizado.
 */
describe("agruparBaixasPorRemessa — o envio real 75664648", () => {
  const movimentos = [
    mov({ id: "full-75664648-p-boldo", productId: "p-boldo", quantidade: 40 }),
    mov({ id: "full-75664648-p-limao", productId: "p-limao", quantidade: 60 }),
    mov({ id: "full-75664648-p-pura", productId: "p-pura", quantidade: 60 }),
    mov({ id: "full-75664648-p-trad", productId: "p-trad", quantidade: 100 }),
  ];

  it("junta os quatro lançamentos num envio só", () => {
    const { remessas } = agruparBaixasPorRemessa(movimentos, nomes);
    expect(remessas).toHaveLength(1);
    expect(remessas[0].remessa).toBe("75664648");
    expect(remessas[0].produtos).toHaveLength(4);
  });

  it("o total bate com as 260 unidades do painel do ML", () => {
    expect(agruparBaixasPorRemessa(movimentos, nomes).remessas[0].totalUnidades).toBe(260);
  });

  it("resolve o nome de cada produto", () => {
    const g = agruparBaixasPorRemessa(movimentos, nomes).remessas[0];
    expect(g.produtos.map((p) => p.nome)).toContain("Erva Tradicional");
  });

  it("ordena os produtos do maior volume pro menor", () => {
    const g = agruparBaixasPorRemessa(movimentos, nomes).remessas[0];
    expect(g.produtos.map((p) => p.unidades)).toEqual([100, 60, 60, 40]);
  });

  it("marca que veio da baixa automática", () => {
    expect(agruparBaixasPorRemessa(movimentos, nomes).remessas[0].automatica).toBe(true);
  });

  it("baixa manual não é marcada como automática", () => {
    const manual = [mov({ obs: "Remessa Full #75664648" })];
    expect(agruparBaixasPorRemessa(manual, nomes).remessas[0].automatica).toBe(false);
  });
});

describe("o que NÃO é remessa", () => {
  it("entrada de compra sai como avulso, não some", () => {
    const compra = mov({ id: "1756-abc", tipo: "entrada", obs: "NF 123" });
    const { remessas, avulsos } = agruparBaixasPorRemessa([compra], nomes);
    expect(remessas).toEqual([]);
    expect(avulsos).toHaveLength(1);
  });

  it("envio pro Full lançado à mão, sem id de remessa, também é avulso", () => {
    const manual = mov({ id: "1756-xyz" });
    const { remessas, avulsos } = agruparBaixasPorRemessa([manual], nomes);
    expect(remessas).toEqual([]);
    expect(avulsos).toHaveLength(1);
  });

  it("produto sem nome cadastrado cai no próprio id — nunca some da lista", () => {
    const g = agruparBaixasPorRemessa([mov({ productId: "fantasma", id: "full-999-fantasma" })], nomes);
    expect(g.remessas[0].produtos[0].nome).toBe("fantasma");
  });
});

describe("ordem e datas", () => {
  it("envio mais recente primeiro", () => {
    const r = agruparBaixasPorRemessa([
      mov({ id: "full-111-p-boldo", data: "2026-08-29" }),
      mov({ id: "full-222-p-limao", productId: "p-limao", data: "2026-09-03" }),
    ], nomes).remessas;
    expect(r.map((x) => x.remessa)).toEqual(["222", "111"]);
  });

  it("a data do envio é a MAIS ANTIGA do grupo", () => {
    /**
     * Correção lançada depois não pode mover o envio na linha do tempo — ele
     * aconteceu quando aconteceu.
     */
    const r = agruparBaixasPorRemessa([
      mov({ id: "full-111-p-boldo", data: "2026-09-10" }),
      mov({ id: "full-111-p-limao", productId: "p-limao", data: "2026-09-03" }),
    ], nomes).remessas;
    expect(r[0].data).toBe("2026-09-03");
  });

  it("quantidade negativa entra como positiva — o sinal é do tipo", () => {
    const r = agruparBaixasPorRemessa([mov({ quantidade: -40 })], nomes).remessas;
    expect(r[0].totalUnidades).toBe(40);
  });

  it("lista vazia devolve vazio, não quebra", () => {
    expect(agruparBaixasPorRemessa([], nomes)).toEqual({ remessas: [], avulsos: [] });
  });
});
