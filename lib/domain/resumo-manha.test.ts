import { describe, expect, it } from "vitest";
import { chaveDoResumo, diasNoMes, montarResumoManha, ontemDe } from "./resumo-manha";

/** Setembro de 2026, com os nove primeiros dias fechados. */
const SERIE = [
  { dia: "2026-09-01", valor: 1_100 },
  { dia: "2026-09-02", valor: 1_450 },
  { dia: "2026-09-03", valor: 900 },
  { dia: "2026-09-04", valor: 1_700 },
  { dia: "2026-09-05", valor: 1_218 },
  // 06 sem venda — ausente da série de propósito, é o caso que engana.
  { dia: "2026-09-07", valor: 1_300 },
  { dia: "2026-09-08", valor: 2_100 },
  { dia: "2026-09-09", valor: 1_248 },
  // Hoje, ainda acontecendo — não pode entrar.
  { dia: "2026-09-10", valor: 34 },
];

describe("ontemDe e diasNoMes", () => {
  it("volta um dia, virando mês e ano", () => {
    expect(ontemDe("2026-09-10")).toBe("2026-09-09");
    expect(ontemDe("2026-09-01")).toBe("2026-08-31");
    expect(ontemDe("2026-01-01")).toBe("2025-12-31");
  });

  it("sabe o tamanho do mês, inclusive fevereiro bissexto", () => {
    expect(diasNoMes("2026-09")).toBe(30);
    expect(diasNoMes("2026-02")).toBe(28);
    expect(diasNoMes("2028-02")).toBe(29);
  });
});

describe("montarResumoManha — a janela", () => {
  const r = montarResumoManha(SERIE, "2026-09-10")!;

  it("vai do dia 1º até ONTEM, inclusive", () => {
    expect(r.de).toBe("2026-09-01");
    expect(r.ate).toBe("2026-09-09");
  });

  it("o dia de hoje NÃO entra — às 7h ele tem quase nada", () => {
    /**
     * Incluir o dia corrente faria a média cair toda manhã e subir toda tarde
     * sem nada ter acontecido: média só compara períodos comparáveis, e o
     * único comparável é o dia inteiro.
     */
    expect(r.total).toBe(11_016);
    expect(SERIE.find((d) => d.dia === "2026-09-10")!.valor).toBe(34);
  });

  it("divide pelo CALENDÁRIO, não pelos dias com venda", () => {
    /**
     * O dia 06 não vendeu e some da série. Dividir por 8 (os dias presentes)
     * inflaria a média justamente nos meses com dias fracos — que são os meses
     * em que a média mais importa. São 9 dias corridos.
     */
    expect(r.diasContados).toBe(9);
    expect(r.media).toBeCloseTo(11_016 / 9, 4);
  });

  it("projeta o mês pelo ritmo, sobre os dias do mês", () => {
    expect(r.projecao).toBeCloseTo((11_016 / 9) * 30, 2);
  });

  it("aponta o melhor dia da janela, pra dar escala à média", () => {
    expect(r.melhorDia).toEqual({ dia: "2026-09-08", valor: 2_100 });
  });
});

describe("montarResumoManha — o texto", () => {
  it("diz a janela dentro da própria mensagem", () => {
    // Se a leitura divergir do esperado, o texto mostra qual foi — em vez de
    // o número discordar em silêncio.
    const r = montarResumoManha(SERIE, "2026-09-10")!;
    expect(r.corpo).toMatch(/os dias 1 a 9/);
    expect(r.corpo).toMatch(/setembro/);
    expect(r.titulo).toMatch(/setembro/);
  });

  it("no dia 2, a janela é só o dia 1º — e o texto muda pra isso", () => {
    const r = montarResumoManha([{ dia: "2026-09-01", valor: 1_100 }], "2026-09-02")!;
    expect(r.diasContados).toBe(1);
    expect(r.media).toBe(1_100);
    expect(r.corpo).toMatch(/o dia 1º/);
  });

  it("fecha com o selo do MercadoLíder, mudando com o nível", () => {
    expect(montarResumoManha(SERIE, "2026-09-10", "gold")!.corpo).toMatch(/MercadoLíder Gold/);
    expect(montarResumoManha(SERIE, "2026-09-10", "platinum")!.corpo).toMatch(/Platinum/);
    expect(montarResumoManha(SERIE, "2026-09-10", null)!.corpo).toMatch(/Rumo ao MercadoLíder/);
  });
});

describe("montarResumoManha — os casos que enganam", () => {
  it("no dia 1º não há aviso: não existe dia fechado no mês", () => {
    // Média de zero dias não existe; o aviso volta no dia 2.
    expect(montarResumoManha(SERIE, "2026-09-01")).toBeNull();
  });

  it("dias de outro mês não entram na conta", () => {
    const comAgosto = [{ dia: "2026-08-31", valor: 9_999 }, ...SERIE];
    expect(montarResumoManha(comAgosto, "2026-09-10")!.total).toBe(11_016);
  });

  it("série vazia devolve média zero em vez de quebrar", () => {
    const r = montarResumoManha([], "2026-09-10")!;
    expect(r.total).toBe(0);
    expect(r.media).toBe(0);
    expect(r.melhorDia).toBeNull();
  });
});

describe("chaveDoResumo", () => {
  it("um aviso por dia — cron rodando duas vezes não manda dois", () => {
    expect(chaveDoResumo("2026-09-10")).toBe("resumo_manha:2026-09-10");
    expect(chaveDoResumo("2026-09-10T07:00:00-03:00")).toBe("resumo_manha:2026-09-10");
  });
});
