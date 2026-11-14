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

  it("concorda com podeVerAba pro Master e pro member", () => {
    for (const papel of ["owner", "member"] as Papel[]) {
      for (const aba of ABAS) {
        const viaCapacidade = podeCapacidade(papel, undefined, capacidadeDaAba(aba));
        expect(`${papel}/${aba}=${viaCapacidade}`).toBe(`${papel}/${aba}=${podeVerAba(papel, aba)}`);
      }
    }
  });

  it("Sócio: toda aba que a tela mostra, a API responde (nunca tela em branco)", () => {
    // O recorte do Sócio (4 abas) é de TELA: os dados que o Dashboard e o DRE
    // calculam são os mesmos da operação, então a API continua respondendo a
    // ele. A direção que importa é esta: aba visível => API liberada.
    for (const aba of ABAS) {
      if (podeVerAba("partner", aba)) expect(`partner/${aba}=${podeCapacidade("partner", undefined, capacidadeDaAba(aba))}`).toBe(`partner/${aba}=true`);
    }
  });

  it("Colaborador: só Tarefas, que não passa pela API (a regra do Firestore libera as dele)", () => {
    for (const aba of ABAS) expect(podeVerAba("equipe", aba)).toBe(aba === "tarefas");
    for (const aba of ABAS) expect(podeCapacidade("equipe", undefined, capacidadeDaAba(aba))).toBe(false);
  });

  it("acesso exige administrar", () => {
    expect(capacidadeDaAba("acesso")).toBe("administrar");
  });

  it("aba desconhecida cai em operação, não em resumo", () => {
    // Fail closed: uma aba nova não nasce visível pro member por descuido.
    expect(capacidadeDaAba("aba-que-ainda-nao-existe")).toBe("ver_operacao");
  });
});

describe("equipe (funcionário) — só as próprias tarefas", () => {
  it("nenhuma capacidade: nem resumo, nem operação, nem financeiro, nem edição — mesmo com permissões sobrando", () => {
    for (const c of TODAS) expect(podeCapacidade("equipe", ["custos", "estoque"], c)).toBe(false);
  });
  it("o registro gravado com role 'equipe' também", () => {
    expect(podeCapacidadeDoRegistro({ role: "equipe" }, "ver_resumo")).toBe(false);
  });
});

describe("Financeiro privado e Etiquetas (13/11/2026)", () => {
  it("financeiro privado é SÓ do owner — nem o Sócio com tudo liberado", () => {
    expect(podeCapacidade("owner", undefined, "ver_financeiro_privado")).toBe(true);
    expect(podeCapacidade("partner", ["custos", "metas", "estoque", "ads", "etiquetas"], "ver_financeiro_privado")).toBe(false);
    expect(podeCapacidade("member", undefined, "ver_financeiro_privado")).toBe(false);
    expect(podeCapacidade("equipe", undefined, "ver_financeiro_privado")).toBe(false);
  });
  it("etiquetas: owner e Colaborador sim; Sócio só liberado; Partner não", () => {
    expect(podeCapacidade("owner", undefined, "usar_etiquetas")).toBe(true);
    expect(podeCapacidade("equipe", undefined, "usar_etiquetas")).toBe(true);
    expect(podeCapacidade("partner", undefined, "usar_etiquetas")).toBe(false);
    expect(podeCapacidade("partner", ["etiquetas"], "usar_etiquetas")).toBe(true);
    expect(podeCapacidade("member", ["etiquetas"], "usar_etiquetas")).toBe(false);
  });
  it("o Colaborador com etiquetas continua sem operação nem financeiro", () => {
    for (const c of ["ver_operacao", "ver_financeiro", "editar_estoque"] as Capacidade[]) {
      expect(podeCapacidade("equipe", undefined, c)).toBe(false);
    }
  });
});
