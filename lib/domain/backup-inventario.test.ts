import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  INVENTARIO,
  ORDEM_DE_RESTAURACAO,
  NUNCA_RESTAURAR,
  RETENCAO,
  classeDe,
  colecoesParaBackup,
  podeRestaurar,
  avaliarDestino,
  explicarDestino,
  manterBackup,
} from "./backup-inventario";

/**
 * O teste que faz o inventário não envelhecer.
 *
 * Lê as coleções declaradas em firestore.rules e exige que cada uma tenha uma
 * decisão de backup. Criar coleção nova sem classificá-la quebra aqui — que é
 * o único momento em que alguém ainda lembra do que ela guarda.
 */
function colecoesDasRegras(): string[] {
  const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
  const nomes = new Set<string>();
  for (const m of rules.matchAll(/match \/([a-zA-Z_]+)\//g)) {
    if (m[1] !== "databases") nomes.add(m[1]);
  }
  return [...nomes];
}

describe("o inventário acompanha as regras", () => {
  it("toda coleção de firestore.rules tem decisão de backup", () => {
    const semDecisao = colecoesDasRegras().filter((c) => classeDe(c) === null);
    expect(semDecisao).toEqual([]);
  });

  it("não inventoria coleção que não existe mais nas regras", () => {
    const regras = new Set(colecoesDasRegras());
    const fantasmas = INVENTARIO.map((i) => i.colecao).filter((c) => !regras.has(c));
    expect(fantasmas).toEqual([]);
  });

  it("cada item diz o que é e o que se perde", () => {
    for (const i of INVENTARIO) {
      expect(i.conteudo.length, i.colecao).toBeGreaterThan(20);
      expect(i.perda.length, i.colecao).toBeGreaterThan(20);
    }
  });

  it("não há coleção duplicada", () => {
    const nomes = INVENTARIO.map((i) => i.colecao);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe("o que entra no backup", () => {
  it("efêmero fica de fora", () => {
    expect(colecoesParaBackup()).not.toContain("pushTokens");
    expect(colecoesParaBackup()).not.toContain("ml_oauth_transacoes");
  });

  it("o cadastro que ninguém consegue rebuscar entra", () => {
    const b = colecoesParaBackup();
    expect(b).toContain("estoque");
    expect(b).toContain("full_remessas");
    expect(b).toContain("controleAcesso");
  });

  it("todo irrecuperável entra, sem exceção", () => {
    const b = new Set(colecoesParaBackup());
    for (const i of INVENTARIO.filter((x) => x.classe === "irrecuperavel")) {
      expect(b.has(i.colecao), i.colecao).toBe(true);
    }
  });
});

describe("ordem de restauração", () => {
  it("controleAcesso volta primeiro — sem ele ninguém entra pra conferir", () => {
    expect(ORDEM_DE_RESTAURACAO[0]).toBe("controleAcesso");
  });

  it("a trava do bootstrap volta logo depois do acesso, nunca no fim", () => {
    expect(ORDEM_DE_RESTAURACAO.indexOf("controleAcessoMeta")).toBe(1);
  });

  it("cobre tudo que o backup guarda", () => {
    const ordem = new Set(ORDEM_DE_RESTAURACAO);
    for (const c of colecoesParaBackup()) {
      expect(ordem.has(c), `${c} está no backup e fora da ordem de restauração`).toBe(true);
    }
  });

  it("não manda restaurar o que nunca deve voltar", () => {
    for (const c of NUNCA_RESTAURAR) {
      expect(ORDEM_DE_RESTAURACAO).not.toContain(c);
    }
  });
});

describe("podeRestaurar", () => {
  it("state de OAuth não volta — reviver state usado é pior que perder", () => {
    expect(podeRestaurar("ml_oauth_transacoes")).toBe(false);
  });

  it("o resto volta", () => {
    expect(podeRestaurar("estoque")).toBe(true);
  });
});

describe("avaliarDestino", () => {
  const origem = "zxp-prod";

  it("projeto separado é o caminho normal", () => {
    const r = avaliarDestino({ projetoDeOrigem: origem, projetoDeDestino: "zxp-restore-teste", confirmouProducao: false });
    expect(r.permitido).toBe(true);
    expect(r.motivo).toBe("destino_isolado");
  });

  it("restaurar sobre produção sem confirmar é recusado", () => {
    const r = avaliarDestino({ projetoDeOrigem: origem, projetoDeDestino: origem, confirmouProducao: false });
    expect(r.permitido).toBe(false);
    expect(explicarDestino(r.motivo)).toContain("sobrescreve");
  });

  it("com confirmação explícita, passa — e o aviso diz o que será perdido", () => {
    const r = avaliarDestino({ projetoDeOrigem: origem, projetoDeDestino: origem, confirmouProducao: true });
    expect(r.permitido).toBe(true);
    expect(explicarDestino(r.motivo)).toContain("sobrescrito");
  });

  it("destino vazio não é destino", () => {
    const r = avaliarDestino({ projetoDeOrigem: origem, projetoDeDestino: "", confirmouProducao: true });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe("destino_ausente");
  });
});

describe("manterBackup", () => {
  const diaComum = { fimDeMes: false, fimDeSemana: false };

  it("guarda todos os dos últimos 14 dias", () => {
    expect(manterBackup({ idadeEmDias: 0, ...diaComum })).toBe(true);
    expect(manterBackup({ idadeEmDias: RETENCAO.diarios, ...diaComum })).toBe(true);
  });

  it("descarta dia comum passada a janela diária", () => {
    expect(manterBackup({ idadeEmDias: RETENCAO.diarios + 1, ...diaComum })).toBe(false);
  });

  it("domingo sobrevive oito semanas", () => {
    expect(manterBackup({ idadeEmDias: 40, fimDeMes: false, fimDeSemana: true })).toBe(true);
    expect(manterBackup({ idadeEmDias: 60, fimDeMes: false, fimDeSemana: true })).toBe(false);
  });

  it("fim de mês sobrevive um ano — é o que cobre a perda descoberta tarde", () => {
    expect(manterBackup({ idadeEmDias: 300, fimDeMes: true, fimDeSemana: false })).toBe(true);
    expect(manterBackup({ idadeEmDias: 400, fimDeMes: true, fimDeSemana: false })).toBe(false);
  });
});
