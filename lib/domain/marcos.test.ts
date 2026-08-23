import { describe, expect, it } from "vitest";
import { DEGRAUS_FATURAMENTO, marcoDeReputacao, marcosDeFaturamento, ordemDoNivel, proximoDegrau } from "./marcos";

describe("marcosDeFaturamento — a chave é o que impede virar spam", () => {
  it("não devolve nada abaixo do primeiro degrau", () => {
    expect(marcosDeFaturamento(9_999, "2026-08")).toEqual([]);
  });

  it("passar de 10 mil gera o marco de 10 mil", () => {
    const m = marcosDeFaturamento(10_000, "2026-08");
    expect(m).toHaveLength(1);
    expect(m[0].chave).toBe("marco_faturamento:2026-08:10000");
  });

  it("devolve TODOS os degraus abaixo — salto entre syncs não pula nenhum", () => {
    // Primeiro sync do dia pode encontrar o faturamento já em 35 mil; sem
    // isto, 10 mil e 20 mil nunca seriam comemorados.
    const m = marcosDeFaturamento(35_000, "2026-08");
    expect(m.map((x) => x.chave)).toEqual([
      "marco_faturamento:2026-08:10000",
      "marco_faturamento:2026-08:20000",
      "marco_faturamento:2026-08:30000",
    ]);
  });

  it("a chave carrega o MÊS — setembro comemora de novo", () => {
    const ago = marcosDeFaturamento(10_000, "2026-08")[0].chave;
    const set = marcosDeFaturamento(10_000, "2026-09")[0].chave;
    expect(ago).not.toBe(set);
  });

  it("a chave é ESTÁVEL: o mesmo mês e degrau dão sempre a mesma", () => {
    // É isso que faz a dedupe funcionar com o sync rodando a cada 15 min.
    expect(marcosDeFaturamento(12_000, "2026-08")[0].chave)
      .toBe(marcosDeFaturamento(48_000, "2026-08")[0].chave);
  });

  it("o texto diz o degrau E onde está agora", () => {
    const m = marcosDeFaturamento(33_377, "2026-08");
    const ultimo = m[m.length - 1];
    expect(ultimo.titulo).toMatch(/30/);
    expect(ultimo.corpo).toMatch(/33/);
  });

  it("faturamento zero ou negativo não comemora", () => {
    expect(marcosDeFaturamento(0, "2026-08")).toEqual([]);
    expect(marcosDeFaturamento(-100, "2026-08")).toEqual([]);
  });

  it("sem mês não gera chave — seria dedupe global e comemoraria uma vez só na vida", () => {
    expect(marcosDeFaturamento(50_000, "")).toEqual([]);
  });

  it("os degraus são crescentes e espaçam mais no topo", () => {
    for (let i = 1; i < DEGRAUS_FATURAMENTO.length; i++) {
      expect(DEGRAUS_FATURAMENTO[i]).toBeGreaterThan(DEGRAUS_FATURAMENTO[i - 1]);
    }
    const passoInicial = DEGRAUS_FATURAMENTO[1] - DEGRAUS_FATURAMENTO[0];
    const passoFinal = DEGRAUS_FATURAMENTO.at(-1)! - DEGRAUS_FATURAMENTO.at(-2)!;
    expect(passoFinal).toBeGreaterThan(passoInicial);
  });
});

describe("marcoDeReputacao — só sobe comemora", () => {
  it("de nada para MercadoLíder comemora", () => {
    const m = marcoDeReputacao("silver", null, true);
    expect(m?.chave).toBe("marco_reputacao:silver");
    expect(m?.titulo).toMatch(/MercadoLíder/);
  });

  it("de MercadoLíder para Platinum comemora", () => {
    expect(marcoDeReputacao("platinum", "gold", true)?.titulo).toMatch(/Platinum/);
  });

  it("mesmo nível NÃO comemora de novo", () => {
    expect(marcoDeReputacao("gold", "gold", true)).toBeNull();
  });

  it("CAIR de nível não vira comemoração", () => {
    // Perder nível é notícia ruim; misturar as duas coisas faria o usuário
    // associar o aviso a ansiedade em vez de conquista.
    expect(marcoDeReputacao("silver", "platinum", true)).toBeNull();
  });

  it("sem nível atual não comemora", () => {
    expect(marcoDeReputacao(null, null, true)).toBeNull();
  });

  it("PRIMEIRA execução não comemora — não sabemos de onde veio", () => {
    // Sem o anterior, avisar seria dar parabéns por algo de meses atrás.
    expect(marcoDeReputacao("platinum", null, false)).toBeNull();
  });

  it("a chave não tem mês — subir de nível é conquista única", () => {
    expect(marcoDeReputacao("gold", "silver", true)?.chave).toBe("marco_reputacao:gold");
  });

  it("não depende de caixa nem espaço", () => {
    expect(marcoDeReputacao(" PLATINUM ", "gold", true)?.chave).toBe("marco_reputacao:platinum");
  });
});

describe("ordemDoNivel", () => {
  it("ordena silver < gold < platinum", () => {
    expect(ordemDoNivel("silver")).toBeLessThan(ordemDoNivel("gold"));
    expect(ordemDoNivel("gold")).toBeLessThan(ordemDoNivel("platinum"));
  });

  it("sem nível é zero, e nível desconhecido também", () => {
    expect(ordemDoNivel(null)).toBe(0);
    expect(ordemDoNivel("diamante")).toBe(0);
  });
});

describe("proximoDegrau — o alvo, não só o que passou", () => {
  it("aponta o próximo e quanto falta", () => {
    expect(proximoDegrau(33_377)).toEqual({ alvo: 40_000, falta: 40_000 - 33_377 });
  });

  it("exatamente no degrau, aponta o seguinte", () => {
    expect(proximoDegrau(30_000)?.alvo).toBe(40_000);
  });

  it("acima do último degrau não há alvo", () => {
    expect(proximoDegrau(2_000_000)).toBeNull();
  });

  it("faturamento zero aponta o primeiro degrau inteiro", () => {
    expect(proximoDegrau(0)).toEqual({ alvo: 10_000, falta: 10_000 });
  });
});
