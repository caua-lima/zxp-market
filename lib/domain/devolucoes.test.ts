import { describe, expect, it } from "vitest";
import { avisosDeDevolucao, ehDevolucao, estaFechada, type Reclamacao } from "./devolucoes";

const AGORA = Date.parse("2026-08-28T12:00:00Z");
const DIA = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();

function rec(over: Partial<Reclamacao> = {}): Reclamacao {
  return {
    id: "5432585029",
    tipo: "returns",
    status: "opened",
    pedido: "2000013596941998",
    criadoEm: iso(AGORA - DIA),
    ...over,
  };
}

describe("classificação", () => {
  it("reconhece devolução e mediação", () => {
    expect(ehDevolucao("returns")).toBe(true);
    expect(ehDevolucao("mediations")).toBe(false);
  });

  it("não depende de caixa nem espaço", () => {
    expect(ehDevolucao(" RETURNS ")).toBe(true);
    expect(estaFechada(" Closed ")).toBe(true);
  });
});

describe("avisosDeDevolucao — o que vira notificação", () => {
  it("devolução recém-aberta avisa", () => {
    const [a] = avisosDeDevolucao([rec()], AGORA);
    expect(a.tipo).toBe("return_opened");
    expect(a.titulo).toBe("Devolução aberta");
    expect(a.corpo).toContain("2000013596941998");
  });

  it("reclamação (mediação) aberta também avisa, com texto próprio", () => {
    const [a] = avisosDeDevolucao([rec({ tipo: "mediations" })], AGORA);
    expect(a.tipo).toBe("return_opened");
    expect(a.titulo).toBe("Reclamação aberta");
    expect(a.corpo).toMatch(/reputação/);
  });

  it("devolução concluída avisa que o produto volta pro estoque", () => {
    const [a] = avisosDeDevolucao(
      [rec({ status: "closed", atualizadoEm: iso(AGORA - DIA) })],
      AGORA,
    );
    expect(a.tipo).toBe("return_completed");
    expect(a.corpo).toMatch(/estoque/);
  });

  it("MEDIAÇÃO encerrada NÃO avisa — não mexe em estoque nem faturamento", () => {
    const r = avisosDeDevolucao(
      [rec({ tipo: "mediations", status: "closed", atualizadoEm: iso(AGORA - DIA) })],
      AGORA,
    );
    expect(r).toEqual([]);
  });
});

describe("a janela que evita o estouro da primeira execução", () => {
  it("reclamação antiga NÃO avisa — a conta tem histórico de mais de um ano", () => {
    // Sem isto, ligar o aviso dispararia dezenas de notificações de casos já
    // resolvidos, e o usuário desligaria tudo no mesmo dia.
    expect(avisosDeDevolucao([rec({ criadoEm: iso(AGORA - 400 * DIA) })], AGORA)).toEqual([]);
  });

  it("logo dentro da janela avisa; logo fora, não", () => {
    expect(avisosDeDevolucao([rec({ criadoEm: iso(AGORA - 2.9 * DIA) })], AGORA)).toHaveLength(1);
    expect(avisosDeDevolucao([rec({ criadoEm: iso(AGORA - 3.1 * DIA) })], AGORA)).toEqual([]);
  });

  it("devolução VELHA concluída HOJE avisa — a notícia é o fechamento", () => {
    // Usar a data de abertura aqui descartaria o aviso justo quando ele importa.
    const r = avisosDeDevolucao(
      [rec({ criadoEm: iso(AGORA - 60 * DIA), status: "closed", atualizadoEm: iso(AGORA - 3600_000) })],
      AGORA,
    );
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe("return_completed");
  });

  it("janela configurável", () => {
    const antiga = [rec({ criadoEm: iso(AGORA - 10 * DIA) })];
    expect(avisosDeDevolucao(antiga, AGORA)).toEqual([]);
    expect(avisosDeDevolucao(antiga, AGORA, 30)).toHaveLength(1);
  });
});

describe("robustez", () => {
  it("a chave é estável — é ela que garante um aviso só", () => {
    const a = avisosDeDevolucao([rec()], AGORA)[0];
    const b = avisosDeDevolucao([rec()], AGORA)[0];
    expect(a.chave).toBe(b.chave);
    expect(a.chave).toBe("return_opened:5432585029");
  });

  it("aberta e concluída têm chaves diferentes — as duas fases avisam", () => {
    const aberta = avisosDeDevolucao([rec()], AGORA)[0];
    const fechada = avisosDeDevolucao(
      [rec({ status: "closed", atualizadoEm: iso(AGORA - DIA) })], AGORA,
    )[0];
    expect(aberta.chave).not.toBe(fechada.chave);
  });

  it("sem id ou sem pedido é ignorado — não dá pra deduplicar sem chave", () => {
    expect(avisosDeDevolucao([rec({ id: "" })], AGORA)).toEqual([]);
    expect(avisosDeDevolucao([rec({ pedido: "" })], AGORA)).toEqual([]);
  });

  it("data inválida não quebra nem vira aviso", () => {
    expect(avisosDeDevolucao([rec({ criadoEm: "sei lá" })], AGORA)).toEqual([]);
  });

  it("lista vazia devolve vazio", () => {
    expect(avisosDeDevolucao([], AGORA)).toEqual([]);
  });
});
