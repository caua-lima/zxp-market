import { describe, expect, it } from "vitest";
import { avaliarBootstrap, explicarRecusaBootstrap, listaAutorizada } from "./bootstrap-acesso";

const AUTORIZADOS = ["caualm4@gmail.com"];

describe("listaAutorizada", () => {
  it("aceita vírgula, ponto-e-vírgula e espaço", () => {
    expect(listaAutorizada("a@x.com,b@x.com")).toEqual(["a@x.com", "b@x.com"]);
    expect(listaAutorizada("a@x.com; b@x.com")).toEqual(["a@x.com", "b@x.com"]);
    expect(listaAutorizada("a@x.com b@x.com")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("normaliza caixa e espaços", () => {
    expect(listaAutorizada("  CauaLM4@Gmail.COM  ")).toEqual(["caualm4@gmail.com"]);
  });

  it("descarta lixo que não é e-mail", () => {
    expect(listaAutorizada("true, 1, sim")).toEqual([]);
    expect(listaAutorizada("")).toEqual([]);
    expect(listaAutorizada(undefined)).toEqual([]);
  });
});

describe("avaliarBootstrap — a janela do primeiro owner", () => {
  it("e-mail da lista, sem config ainda, vira owner", () => {
    expect(avaliarBootstrap({ email: "caualm4@gmail.com", configExiste: false, autorizados: AUTORIZADOS }))
      .toEqual({ ok: true, email: "caualm4@gmail.com" });
  });

  it("autenticado fora da lista NÃO vira owner", () => {
    /**
     * Este era o buraco: a regra do Firestore só exigia estar logado e o
     * config não existir. Entrar com uma conta Google qualquer e abrir o app
     * bastava pra virar dono do painel.
     */
    expect(avaliarBootstrap({ email: "estranho@qualquer.com", configExiste: false, autorizados: AUTORIZADOS }))
      .toEqual({ ok: false, motivo: "fora_da_lista" });
  });

  it("sem lista no servidor, ninguém passa — nem o dono", () => {
    // Fail-closed de propósito: "ninguém consegue" se resolve com uma variável
    // de ambiente; "qualquer um consegue" só se descobre depois do estrago.
    expect(avaliarBootstrap({ email: "caualm4@gmail.com", configExiste: false, autorizados: [] }))
      .toEqual({ ok: false, motivo: "sem_lista" });
  });

  it("config já existente fecha a janela, inclusive pra quem está na lista", () => {
    expect(avaliarBootstrap({ email: "caualm4@gmail.com", configExiste: true, autorizados: AUTORIZADOS }))
      .toEqual({ ok: false, motivo: "ja_configurado" });
  });

  it("caixa e espaços do e-mail não driblam a lista", () => {
    expect(avaliarBootstrap({ email: "  CauaLM4@Gmail.com ", configExiste: false, autorizados: AUTORIZADOS }).ok).toBe(true);
  });

  it("token sem e-mail não passa", () => {
    expect(avaliarBootstrap({ email: "", configExiste: false, autorizados: AUTORIZADOS }))
      .toEqual({ ok: false, motivo: "sem_email" });
  });

  it("'já configurado' vence 'fora da lista' — a mensagem certa importa", () => {
    // Quem chega depois precisa saber que já tem dono, não que a lista está errada.
    expect(avaliarBootstrap({ email: "estranho@qualquer.com", configExiste: true, autorizados: AUTORIZADOS }))
      .toEqual({ ok: false, motivo: "ja_configurado" });
  });
});

describe("inicializações concorrentes", () => {
  /**
   * Simula o que a transação do Firestore garante: a decisão é tomada sobre
   * uma leitura feita DENTRO da transação, e a segunda tentativa reexecuta
   * sobre o estado já gravado pela primeira.
   *
   * Antes eram dois `setDoc` soltos, decididos a partir de uma leitura feita
   * antes — duas abas carregando juntas liam "não existe" as duas.
   */
  function corridaDeBootstrap(emails: string[], autorizados: string[]) {
    let config: { ownerEmail: string } | null = null;
    const vencedores: string[] = [];
    const recusados: string[] = [];

    for (const email of emails) {
      // A releitura acontece a cada tentativa, como numa transação reexecutada.
      const v = avaliarBootstrap({ email, configExiste: config !== null, autorizados });
      if (v.ok) {
        config = { ownerEmail: v.email };
        vencedores.push(v.email);
      } else {
        recusados.push(email);
      }
    }
    return { config, vencedores, recusados };
  }

  it("duas tentativas autorizadas ao mesmo tempo produzem UM owner", () => {
    const r = corridaDeBootstrap(
      ["dono@zxp.com", "dono@zxp.com"],
      ["dono@zxp.com"],
    );
    expect(r.vencedores).toEqual(["dono@zxp.com"]);
    expect(r.recusados).toHaveLength(1);
    expect(r.config).toEqual({ ownerEmail: "dono@zxp.com" });
  });

  it("uma enxurrada de tentativas não autorizadas não produz owner nenhum", () => {
    const r = corridaDeBootstrap(
      ["a@x.com", "b@x.com", "c@x.com", "d@x.com"],
      ["dono@zxp.com"],
    );
    expect(r.vencedores).toEqual([]);
    expect(r.config).toBeNull();
  });

  it("o autorizado vence mesmo chegando depois de vários estranhos", () => {
    const r = corridaDeBootstrap(
      ["a@x.com", "b@x.com", "dono@zxp.com", "c@x.com"],
      ["dono@zxp.com"],
    );
    expect(r.vencedores).toEqual(["dono@zxp.com"]);
    expect(r.recusados).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

describe("explicarRecusaBootstrap", () => {
  it("diz o que fazer, não só o que houve", () => {
    expect(explicarRecusaBootstrap("sem_lista")).toContain("BOOTSTRAP_OWNER_EMAILS");
    expect(explicarRecusaBootstrap("ja_configurado")).toContain("já tem dono");
    expect(explicarRecusaBootstrap("fora_da_lista")).toContain("lista");
  });
});
