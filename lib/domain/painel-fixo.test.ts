import { describe, expect, it } from "vitest";
import { conteudoPainelFixo, desenharPainelFixo, lerPlacarFixo, placarDe, type PincelDoPainel, type PlacarFixo } from "./painel-fixo";

/** O Service Worker leva estas funções pelo TEXTO: cada teste roda a versão reconstruída. */
const daTexto = <T extends (...a: never[]) => unknown>(fn: T): T => new Function(`return (${fn.toString()})`)() as T;
const conteudo = daTexto(conteudoPainelFixo);
const ler = daTexto(lerPlacarFixo);
const desenhar = daTexto(desenharPainelFixo);

// 23/10/2026 14:40 em São Paulo
const AGORA = Date.parse("2026-10-23T14:40:00.000-03:00");
const ULTIMA = Date.parse("2026-10-23T14:32:00.000-03:00");
const norm = (s: string) => s.replace(/ /g, " ");

const base = (o: Partial<PlacarFixo> = {}): PlacarFixo => ({
  dia: "2026-10-23", vendas: 4320.5, pedidos: 18, unidades: 25,
  meta: { alvo: 6750, pct: 64.0, falta: 2429.5, batida: false, mesBatido: false },
  ultima: { valor: 189.9, titulo: "Kit Limão Caipira 500 g com Casca Fina e Suco", em: ULTIMA },
  porHora: Array.from({ length: 24 }, (_, i) => (i >= 8 && i <= 14 ? 500 : 0)),
  ontemAteAgora: 3857.6, atualizadoEm: AGORA, ...o,
});

describe("conteudoPainelFixo — o que aparece na barra do celular", () => {
  it("título é o número do dia; a 1ª linha é a meta, com barra e quanto falta", () => {
    const c = conteudo(base(), AGORA);
    expect(norm(c.title)).toBe("R$ 4.320,50 hoje · 18 vendas");
    const [meta, ultima, extra] = norm(c.body).split("\n");
    expect(meta).toBe("▰▰▰▰▰▰▱▱▱▱ 64% da meta · faltam R$ 2.429,50");
    expect(ultima).toBe("Última: R$ 189,90 · Kit Limão Caipira 500 g com Casca… às 14:32");
    expect(extra).toBe("25 un · ▲ 12% vs ontem até agora");
    expect(c.tag).toBe("zxp-ao-vivo");
    expect(c.timestamp).toBe(AGORA);
  });

  it("meta batida e mês batido têm texto próprio; barra nunca passa de 10", () => {
    expect(norm(conteudo(base({ meta: { alvo: 6750, pct: 131, falta: 0, batida: true, mesBatido: false } }), AGORA).body.split("\n")[0]))
      .toBe("✓ Meta do dia batida · 131% de R$ 6.750,00");
    expect(conteudo(base({ meta: { alvo: 0, pct: 100, falta: 0, batida: true, mesBatido: true } }), AGORA).body.split("\n")[0]).toBe("✓ Meta do mês já batida");
  });

  it("sem meta: a 1ª linha diz as unidades; sem venda ainda, diz isso", () => {
    const c = conteudo(base({ meta: null, vendas: 0, pedidos: 0, unidades: 0, ultima: null, ontemAteAgora: 0, porHora: Array(24).fill(0) }), AGORA);
    expect(norm(c.title)).toBe("R$ 0,00 hoje · 0 vendas");
    expect(c.body).toBe("0 unidades\nNenhuma venda ainda hoje");
  });

  it("uma venda no singular; ritmo abaixo de ontem com ▼", () => {
    const c = conteudo(base({ pedidos: 1, vendas: 100, ontemAteAgora: 200 }), AGORA);
    expect(norm(c.title)).toBe("R$ 100,00 hoje · 1 venda");
    expect(c.body).toContain("▼ 50% vs ontem até agora");
  });

  it("placar de outro dia (virou a meia-noite sem venda nova) não se diz 'hoje'", () => {
    const c = conteudo(base({ dia: "2026-10-22" }), AGORA);
    expect(norm(c.title)).toBe("R$ 4.320,50 em 22/10 · 18 vendas");
    expect(c.body).not.toContain("vs ontem");
  });
});

describe("lerPlacarFixo — o que chega no push é conferido", () => {
  it("ida e volta pelo JSON", () => {
    expect(ler(JSON.stringify(base()))).toEqual(base());
  });

  it("lixo vira null; número torto vira 0; texto é cortado", () => {
    expect(ler("{nao e json")).toBeNull();
    expect(ler(JSON.stringify({ dia: "ontem" }))).toBeNull();
    const p = ler(JSON.stringify({ dia: "2026-10-23", vendas: "abc", pedidos: -3, porHora: [1, "x"], ultima: { valor: 5, titulo: "x".repeat(200), em: 1 } }))!;
    expect(p.vendas).toBe(0);
    expect(p.pedidos).toBe(0);
    expect(p.porHora).toHaveLength(24);
    expect(p.porHora.slice(0, 3)).toEqual([1, 0, 0]);
    expect(p.ultima!.titulo).toHaveLength(60);
    expect(p.meta).toBeNull();
  });
});

describe("placarDe — da resposta da barra ao vivo", () => {
  it("leva o que o painel usa, arredondado", () => {
    const p = placarDe({
      dia: "2026-10-23", atualizadoEm: AGORA,
      hoje: { vendas: 10.005, pedidos: 2, unidades: 3 }, ontemAteAgora: { vendas: 7 },
      porHora: { hoje: [1.239, 2] }, ultimaVenda: { em: ULTIMA, valor: 5, titulo: "Limão" },
      metaDoDia: { alvo: 100.456, pct: 12.345, falta: 90.4, batida: false, mesBatido: false },
    });
    expect(p.vendas).toBe(10.01);
    expect(p.porHora).toHaveLength(24);
    expect(p.porHora[0]).toBe(1.24);
    expect(p.meta).toEqual({ alvo: 100.46, pct: 12.3, falta: 90.4, batida: false, mesBatido: false });
    expect(placarDe({ dia: "2026-10-23", atualizadoEm: 1, hoje: { vendas: 0, pedidos: 0, unidades: 0 }, ontemAteAgora: { vendas: 0 }, porHora: { hoje: [] }, ultimaVenda: null }).meta).toBeNull();
  });
});

describe("desenharPainelFixo — a imagem do painel", () => {
  function pincel() {
    const textos: string[] = [];
    let retangulos = 0;
    const ctx: PincelDoPainel = {
      fillStyle: "", font: "", textAlign: "left", textBaseline: "alphabetic",
      fillRect: () => { retangulos++; }, fillText: (t: string) => { textos.push(t.replace(/ /g, " ")); },
      beginPath: () => {}, moveTo: () => {}, arcTo: () => {}, closePath: () => {}, fill: () => { retangulos++; },
    };
    return { ctx, textos, retangulos: () => retangulos };
  }

  it("valor, contagem, ritmo, meta e as 24 barras", () => {
    const { ctx, textos, retangulos } = pincel();
    desenhar(ctx, base(), AGORA, 720, 360);
    expect(textos).toContain("R$ 4.320,50");
    expect(textos).toContain("18 vendas · 25 un");
    expect(textos).toContain("▲ 12% vs ontem");
    expect(textos).toContain("Meta de hoje R$ 6.750,00");
    expect(textos).toContain("64%");
    expect(textos).toContain("atualizado 14:40");
    // fundo + selo + trilho + preenchimento da meta + 24 barras
    expect(retangulos()).toBe(1 + 1 + 2 + 24);
  });

  it("sem meta nem venda não quebra", () => {
    const { ctx, textos } = pincel();
    desenhar(ctx, base({ meta: null, vendas: 0, pedidos: 0, unidades: 0, ultima: null, ontemAteAgora: 0, porHora: Array(24).fill(0) }), AGORA, 720, 360);
    expect(textos).toContain("R$ 0,00");
    expect(textos.some((t) => t.startsWith("Meta"))).toBe(false);
  });
});
