import { describe, expect, it } from "vitest";
import {
  capacidadeDaAba,
  podeCapacidade,
  podeCapacidadeDoRegistro,
  type Capacidade,
} from "./capacidades";
import { podeVerAba, type Papel } from "./types";

const TODAS: Capacidade[] = [
  "ver_resumo", "ver_operacao", "ver_financeiro",
  "editar_custos", "editar_metas", "editar_estoque", "editar_ads",
  "administrar",
];

describe("owner", () => {
  it("tem todas as capacidades, sem depender de permissoesEdicao", () => {
    for (const c of TODAS) expect(podeCapacidade("owner", undefined, c)).toBe(true);
  });
});

describe("member — o papel que só acompanha o resultado", () => {
  it("vê o resumo e nada mais", () => {
    expect(podeCapacidade("member", undefined, "ver_resumo")).toBe(true);
    for (const c of TODAS.filter((x) => x !== "ver_resumo")) {
      expect(podeCapacidade("member", undefined, c)).toBe(false);
    }
  });

  it("NÃO vê financeiro — é o ponto do papel", () => {
    /**
     * O portão das APIs achatava todo não-owner em "user" e respondia
     * faturamento, CMV e margem pro member, enquanto as regras do Firestore
     * barravam a mesma leitura pelo SDK.
     */
    expect(podeCapacidade("member", undefined, "ver_financeiro")).toBe(false);
  });

  it("permissoesEdicao sobrando de quando era partner NÃO reabre nada", () => {
    // O papel manda sobre a lista — mesma precedência de podeEditar nas regras.
    expect(podeCapacidade("member", ["custos", "estoque"], "editar_custos")).toBe(false);
    expect(podeCapacidade("member", ["custos"], "ver_financeiro")).toBe(false);
  });
});

describe("partner", () => {
  it("vê resumo, operação e financeiro", () => {
    for (const c of ["ver_resumo", "ver_operacao", "ver_financeiro"] as Capacidade[]) {
      expect(podeCapacidade("partner", undefined, c)).toBe(true);
    }
  });

  it("só edita a aba que o dono liberou", () => {
    expect(podeCapacidade("partner", ["custos"], "editar_custos")).toBe(true);
    expect(podeCapacidade("partner", ["custos"], "editar_estoque")).toBe(false);
  });

  it("sem lista, não edita nada", () => {
    expect(podeCapacidade("partner", undefined, "editar_custos")).toBe(false);
    expect(podeCapacidade("partner", [], "editar_ads")).toBe(false);
  });

  it("NUNCA administra — integração, usuários e rotinas são do owner", () => {
    expect(podeCapacidade("partner", ["custos", "metas", "estoque", "ads"], "administrar")).toBe(false);
  });
});

describe("papéis legados, lidos do documento gravado", () => {
  it('"colaborador", "admin" e "user" viram partner — a migração não tira acesso', () => {
    for (const role of ["colaborador", "admin", "user"] as const) {
      expect(podeCapacidadeDoRegistro({ role }, "ver_financeiro")).toBe(true);
      expect(podeCapacidadeDoRegistro({ role }, "administrar")).toBe(false);
    }
  });

  it('só o valor explícito "member" restringe', () => {
    expect(podeCapacidadeDoRegistro({ role: "member" }, "ver_financeiro")).toBe(false);
  });

  it("registro ausente não tem capacidade nenhuma", () => {
    for (const c of TODAS) {
      expect(podeCapacidadeDoRegistro(null, c)).toBe(false);
      expect(podeCapacidadeDoRegistro(undefined, c)).toBe(false);
    }
  });
});

describe("capacidadeDaAba espelha podeVerAba", () => {
  /**
   * As duas regras precisam concordar: se a navegação mostra a aba, a API
   * daquela aba tem que responder — e vice-versa. Divergência aqui é tela em
   * branco ou vazamento, dependendo de qual lado ficou mais frouxo.
   */
  const ABAS = ["dashboard", "pedidos", "estoque", "full", "ads", "metas", "tarefas", "custos", "dre", "preco", "desempenho", "acesso"];

  it("concorda com podeVerAba nos três papéis", () => {
    for (const papel of ["owner", "partner", "member"] as Papel[]) {
      for (const aba of ABAS) {
        const viaCapacidade = podeCapacidade(papel, undefined, capacidadeDaAba(aba));
        expect(`${papel}/${aba}=${viaCapacidade}`).toBe(`${papel}/${aba}=${podeVerAba(papel, aba)}`);
      }
    }
  });

  it("acesso exige administrar", () => {
    expect(capacidadeDaAba("acesso")).toBe("administrar");
  });

  it("aba desconhecida cai em operação, não em resumo", () => {
    // Fail closed: uma aba nova não nasce visível pro member por descuido.
    expect(capacidadeDaAba("aba-que-ainda-nao-existe")).toBe("ver_operacao");
  });
});
