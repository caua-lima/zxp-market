import { describe, it, expect } from "vitest";
import { decidirAberturaDoLink, type EntradaDoLink } from "./deep-link-consumo";

/** Simula o efeito: aplica a decisão e guarda o que foi consumido, como o hook faz. */
function sessao() {
  let consumida: string | null = null;
  let aberturas = 0;
  return {
    passo(e: Omit<EntradaDoLink, "consumida">) {
      const d = decidirAberturaDoLink({ ...e, consumida });
      consumida = d.consumida;
      if (d.abrir) aberturas++;
      return d.abrir;
    },
    get aberturas() { return aberturas; },
  };
}

describe("decidirAberturaDoLink", () => {
  it("abre quando o item já está na lista", () => {
    const s = sessao();
    expect(s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true })).toBe(true);
  });

  it("espera a lista carregar e abre uma vez só quando o item aparece", () => {
    const s = sessao();
    expect(s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: false })).toBe(false);
    expect(s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true })).toBe(true);
    expect(s.aberturas).toBe(1);
  });

  it("dado novo NÃO reabre: fechar o modal e chegar um snapshot deixa fechado (U18)", () => {
    const s = sessao();
    s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true });
    // a pessoa fecha o modal; a lista muda três vezes
    for (let i = 0; i < 3; i++) expect(s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true })).toBe(false);
    expect(s.aberturas).toBe(1);
  });

  it("novo clique deliberado no MESMO link abre de novo", () => {
    const s = sessao();
    s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true });
    expect(s.passo({ id: "t1", chaveDeNavegacao: 2, pronto: true })).toBe(true);
    expect(s.aberturas).toBe(2);
  });

  it("outro id é outra intenção", () => {
    const s = sessao();
    s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true });
    expect(s.passo({ id: "t2", chaveDeNavegacao: 1, pronto: true })).toBe(true);
  });

  it("sair do item zera: voltar ao mesmo id depois abre", () => {
    const s = sessao();
    s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true });
    s.passo({ id: undefined, chaveDeNavegacao: 1, pronto: true });
    expect(s.passo({ id: "t1", chaveDeNavegacao: 1, pronto: true })).toBe(true);
  });

  it("item que não existe na lista nunca é consumido (nada abre, nada trava)", () => {
    const s = sessao();
    for (let i = 0; i < 4; i++) expect(s.passo({ id: "fantasma", chaveDeNavegacao: 1, pronto: false })).toBe(false);
    expect(s.aberturas).toBe(0);
  });
});
