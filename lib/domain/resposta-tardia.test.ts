import { describe, expect, it } from "vitest";
import {
  BUSCA_INICIAL,
  corpoEhSucesso,
  criarSequenciador,
  registrarFalha,
  registrarSucesso,
} from "./resposta-tardia";

describe("criarSequenciador — a ultima selecao vence", () => {
  it("a resposta do pedido antigo e descartada", () => {
    /**
     * Trocar o filtro de "Mes" pra "Hoje" dispara duas buscas. A do mes e mais
     * pesada e costuma demorar mais. Chegando DEPOIS, ela sobrescrevia os
     * dados de hoje: a tela mostrava o faturamento do mes inteiro enquanto o
     * seletor dizia "Hoje" — e ficava assim ate a proxima busca.
     */
    const s = criarSequenciador();
    const mes = s.proximo();
    const hoje = s.proximo();

    // A de hoje volta primeiro e vale.
    expect(s.ehAtual(hoje)).toBe(true);
    // A do mes volta depois e NAO pode sobrescrever.
    expect(s.ehAtual(mes)).toBe(false);
  });

  it("a mais recente sempre vale, mesmo com varias em voo", () => {
    const s = criarSequenciador();
    const a = s.proximo();
    const b = s.proximo();
    const c = s.proximo();
    expect(s.ehAtual(a)).toBe(false);
    expect(s.ehAtual(b)).toBe(false);
    expect(s.ehAtual(c)).toBe(true);
  });

  it("descartarTudo invalida ate a mais recente", () => {
    // Desmontar o componente: nenhuma resposta em voo deve mexer em estado.
    const s = criarSequenciador();
    const n = s.proximo();
    s.descartarTudo();
    expect(s.ehAtual(n)).toBe(false);
  });

  it("depois de descartar, uma busca nova volta a valer", () => {
    const s = criarSequenciador();
    s.proximo();
    s.descartarTudo();
    const novo = s.proximo();
    expect(s.ehAtual(novo)).toBe(true);
  });

  it("numero que nunca foi emitido nao vale", () => {
    const s = criarSequenciador();
    s.proximo();
    expect(s.ehAtual(999)).toBe(false);
    expect(s.ehAtual(0)).toBe(false);
  });
});

describe("tentativa x sucesso", () => {
  it("sucesso carimba os dois", () => {
    expect(registrarSucesso(1000)).toEqual({
      ultimoSucesso: 1000, ultimaTentativa: 1000, falhouNaUltima: false,
    });
  });

  it("falha PRESERVA o ultimo sucesso", () => {
    /**
     * Havia so `lastUpdated`, gravado no sucesso. Uma atualizacao que falhava
     * deixava o carimbo antigo intacto e nao dizia nada: a tela continuava
     * anunciando "atualizado ha 2 minutos" enquanto as tres ultimas tentativas
     * tinham falhado.
     *
     * Apagar o carimbo tambem seria errado — esconderia quao velho o dado na
     * tela esta. O certo e manter os dois numeros.
     */
    const depoisDeSucesso = registrarSucesso(1000);
    const r = registrarFalha(depoisDeSucesso, 5000);
    expect(r.ultimoSucesso).toBe(1000);
    expect(r.ultimaTentativa).toBe(5000);
    expect(r.falhouNaUltima).toBe(true);
  });

  it("um sucesso depois da falha limpa a marca", () => {
    const comFalha = registrarFalha(registrarSucesso(1000), 5000);
    expect(registrarSucesso(9000).falhouNaUltima).toBe(false);
    expect(comFalha.falhouNaUltima).toBe(true);
  });

  it("falhar sem nunca ter dado certo nao inventa sucesso", () => {
    const r = registrarFalha(BUSCA_INICIAL, 5000);
    expect(r.ultimoSucesso).toBeNull();
    expect(r.falhouNaUltima).toBe(true);
  });
});

describe("corpoEhSucesso — HTTP 200 nao basta", () => {
  it("corpo com error nao e sucesso, mesmo vindo 200", () => {
    /**
     * Varias rotas deste app respondem 200 com `{ error: "sem_token" }` de
     * proposito. Quem so olha `res.ok` grava esse corpo como se fossem
     * metricas.
     */
    expect(corpoEhSucesso({ error: "sem_token" })).toBe(false);
    expect(corpoEhSucesso({ error: "pedidos_indisponiveis", bloco: null })).toBe(false);
  });

  it("corpo normal e sucesso", () => {
    expect(corpoEhSucesso({ faturamento: 1000 })).toBe(true);
    expect(corpoEhSucesso({})).toBe(true);
  });

  it("error vazio nao conta como erro", () => {
    expect(corpoEhSucesso({ error: "" })).toBe(true);
  });

  it("corpo que nao e objeto nao e sucesso", () => {
    expect(corpoEhSucesso(null)).toBe(false);
    expect(corpoEhSucesso(undefined)).toBe(false);
    expect(corpoEhSucesso("erro")).toBe(false);
  });
});
