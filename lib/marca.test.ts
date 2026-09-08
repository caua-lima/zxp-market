import { describe, expect, it } from "vitest";
import { MARCA_DOURADO, MARCA_ONYX, svgAppIcon, svgFavicon } from "./marca";

/**
 * A geometria da marca, travada.
 *
 * ─── POR QUE ISTO É TESTE, E NÃO SÓ COMENTÁRIO ──────────────────────────
 *
 * O guia de identidade da ZXP Solutions diz que o traço do "Z" é o elo visual
 * entre os 4 apps da família — Market, Tasks, Finance e Mark — e que ele
 * precisa ser IDÊNTICO nos quatro, mudando só a cor de assinatura. Um traço
 * que encolhe 24% num app quebra isso sem quebrar nada que alguém perceba
 * olhando só para este app.
 *
 * E já aconteceu: o ícone carregava um `translate(24,24) scale(0.76)` que
 * ninguém notou por não haver com o que comparar dentro do próprio projeto.
 *
 * O guia também alerta para o caminho inverso: alguém "unificar" o Market com
 * a paleta de outro app achando que está consertando a marca. O dourado é a
 * cor DESTE app; os testes abaixo falham se ela mudar.
 *
 * Números conferidos contra o documento de identidade em 08/09/2026.
 */

/** O desenho, exatamente como o guia o especifica. */
const SPEC = {
  viewBox: "0 0 200 200",
  points: "30,47 170,47 30,153 170,153",
  strokeWidth: "34",
  linejoin: "miter",
  linecap: "butt",
  rx: "44",
} as const;

describe("cores de assinatura do ZXP Market", () => {
  it("o dourado é #F4B942 — a cor deste app, não a de outro da família", () => {
    expect(MARCA_DOURADO).toBe("#F4B942");
  });

  it("o fundo é onyx #10100E, nunca preto puro", () => {
    expect(MARCA_ONYX).toBe("#10100E");
    expect(MARCA_ONYX).not.toBe("#000000");
    expect(MARCA_ONYX).not.toBe("#000");
  });
});

describe("ícone do app — a geometria do guia", () => {
  const svg = svgAppIcon();

  it("desenha na moldura 0 0 200 200", () => {
    expect(svg).toContain(`viewBox="${SPEC.viewBox}"`);
  });

  it("usa os quatro pontos do traço, sem reescalar", () => {
    expect(svg).toContain(`points="${SPEC.points}"`);
  });

  it("é TRAÇO, não preenchimento — espessura 34, canto reto, ponta reta", () => {
    expect(svg).toContain(`fill="none"`);
    expect(svg).toContain(`stroke-width="${SPEC.strokeWidth}"`);
    expect(svg).toContain(`stroke-linejoin="${SPEC.linejoin}"`);
    expect(svg).toContain(`stroke-linecap="${SPEC.linecap}"`);
  });

  it("NÃO tem transform — foi um `scale(0.76)` que desalinhou o símbolo antes", () => {
    expect(svg).not.toContain("transform=");
  });

  it("contêiner onyx com cantos de raio 44", () => {
    expect(svg).toContain(`rx="${SPEC.rx}"`);
    expect(svg).toContain(`fill="${MARCA_ONYX}"`);
  });

  it("o traço é dourado sobre o onyx, nunca o contrário", () => {
    expect(svg).toContain(`stroke="${MARCA_DOURADO}"`);
    expect(svg).not.toContain(`fill="${MARCA_DOURADO}"`);
  });
});

describe("favicon", () => {
  /**
   * Já foi invertido (fundo dourado, Z onyx) por legibilidade em 16px. O guia
   * decide contra: o ícone da aba tem que ser reconhecível como o ícone do
   * app. Se um dia voltar a divergir, é aqui que se vê.
   */
  it("é o MESMO desenho do ícone do app", () => {
    expect(svgFavicon()).toBe(svgAppIcon());
  });

  it("não volta a ser o bloco dourado com o Z vazado", () => {
    expect(svgFavicon()).not.toContain(`fill="${MARCA_DOURADO}"`);
    expect(svgFavicon()).not.toContain(`stroke="${MARCA_ONYX}"`);
  });
});

describe("o traço cabe dentro dos cantos arredondados", () => {
  /**
   * Sem o `scale(0.76)` o desenho fica maior, então vale conferir que nada
   * encosta no arco: com espessura 34, o traço vai de x=13 a x=187 e de y=30
   * a y=170. O canto é um arco de raio 44 centrado em (44,44).
   */
  it("o ponto mais externo fica dentro do arco do canto", () => {
    const raio = Number(SPEC.rx);
    const [x, y] = [30 - Number(SPEC.strokeWidth) / 2, 47 - Number(SPEC.strokeWidth) / 2];
    expect(x).toBe(13);
    expect(y).toBe(30);
    const distancia = Math.hypot(raio - x, raio - y);
    expect(distancia).toBeLessThan(raio);
  });
});
