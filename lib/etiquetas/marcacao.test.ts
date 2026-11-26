import { describe, expect, it } from "vitest";
import { arranjoQueCabe, larguraDoTexto, caixasOcupadas, etiquetaAuxiliar, marcarEtiqueta, regiaoLivre, semMarcacao, textoSeguro } from "./marcacao";

const base = (extra = "") => [
  "^XA", "^CI28", "^LH5,15",
  "^FO120,20^A0N,24,24^FH^FDLoja Teste #1^FS",
  "^FO120,43^A0N,24,24^FH^FB520,2,0,L^FDRua de Teste 100, Bairro^FS",
  extra,
  "^FO230,210^BY3,,0^BCN,160,N,N,N^FD>:90000000001^FS",
  '^FO510,880^BY2,2,0^BQN,2,10^FDLA,{"id":"90000000001","t":"lm"}^FS',
  "^XZ",
].join("\n");
// O ícone de avião que o ML põe no canto (64x68).
const AVIAO = "^FO647,20^GFA,544,544,8,0000^FS";

describe("marcarEtiqueta — nunca cobre o que o ML desenhou", () => {
  it("etiqueta comum: canto superior direito", () => {
    const r = marcarEtiqueta(base(), "TT");
    expect(r.ok && r.regiao.x).toBe(640);
  });
  it("com o aviãozinho no canto: vai pro lado dele, sem encostar", () => {
    const r = marcarEtiqueta(base(AVIAO), "TT");
    expect(r.ok && r.regiao.x).toBe(722);
    const aviao = caixasOcupadas(base(AVIAO)).find((c) => c.x === 647)!;
    expect(r.ok && r.regiao.x).toBeGreaterThanOrEqual(aviao.x + aviao.w);
  });
  it("sem nenhum canto livre: não marca (quem chama gera a auxiliar)", () => {
    const tudo = "^FO600,0^GB205,140,140^FS";
    expect(regiaoLivre(base(tudo))).toBeNull();
    expect(marcarEtiqueta(base(tudo), "TT")).toMatchObject({ ok: false });
  });
  it("marcar duas vezes troca a marcação, não empilha; o original fica intacto", () => {
    const uma = marcarEtiqueta(base(), "TT");
    const duas = uma.ok ? marcarEtiqueta(uma.zpl, "2TT") : uma;
    expect(duas.ok && (duas.zpl.match(/ZXP-MARCA INICIO/g) ?? []).length).toBe(1);
    expect(duas.ok && semMarcacao(duas.zpl)).toBe(base());
  });
  it("texto nunca vira comando ZPL", () => {
    expect(textoSeguro("TT^XZ~JA")).toBe("TTXZJA");
    const r = marcarEtiqueta(base(), "TT^FS^XA");
    expect(r.ok && r.zpl.includes("^FDTTFSXA^FS")).toBe(true);
  });
  it("3 produtos cabem empilhados; 5 já não cabem legíveis — vai etiqueta auxiliar, não borrão", () => {
    expect(marcarEtiqueta(base(), "2TT + BM + MS").ok).toBe(true);
    expect(marcarEtiqueta(base(), "2TT + BM + MS + LC + PF").ok).toBe(false);
    expect(marcarEtiqueta(base(), "2TT + 3BM + 4MS + 2LC + 5PF + 2AH + 3AC").ok).toBe(false);
  });
});

describe("etiquetaAuxiliar", () => {
  it("só sigla e envio — nada do comprador", () => {
    const z = etiquetaAuxiliar("2TT", "90000000001", 3);
    expect(z).toMatch(/^\^XA/);
    expect(z).toContain("^FD2TT^FS");
    expect(z).toContain("Envio 90000000001");
    expect(z).not.toMatch(/Rua|CEP/);
  });
});

describe("pacote com vários produtos (envio 48573153721: TT + MS + PF)", () => {
  it("empilha as siglas no canto em vez de mandar etiqueta auxiliar", () => {
    const r = marcarEtiqueta(base(), "TT + MS + PF");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.zpl).toMatch(/\^FDTT\+MS\^FS[\s\S]*\^FDPF\^FS/);
  });

  it("cabe até no canto estreito ao lado do avião", () => {
    const r = marcarEtiqueta(base(AVIAO), "TT + MS + PF");
    expect(r.ok && r.regiao.x).toBe(722);
    if (r.ok) expect(r.zpl).toMatch(/\^FDTT\^FS[\s\S]*\^FDMS\^FS[\s\S]*\^FDPF\^FS/);
  });

  it("arranjoQueCabe: uma linha quando cabe, empilha quando não", () => {
    expect(arranjoQueCabe("2TT", { x: 640, y: 10, w: 150, h: 120 })?.linhas).toEqual(["2TT"]);
    expect(arranjoQueCabe("TT + MS + PF", { x: 722, y: 10, w: 78, h: 120 })).toEqual({ linhas: ["TT", "MS", "PF"], fonte: 33 });
  });

  it("preto sobre branco numa moldura — sem ^FR (texto invertido borrava, 26/11/2026)", () => {
    const r = marcarEtiqueta(base(), "MS");
    expect(r.ok && r.zpl).toMatch(/\^GB150,120,5\^FS/);
    expect(r.ok && r.zpl).not.toMatch(/\^FR/);
  });

  it("as siglas das etiquetas borradas de 26/11 cabem com folga (largura real das letras)", () => {
    for (const [texto, regiao] of [["2MS", { x: 640, y: 10, w: 150, h: 120 }], ["MC + MS", { x: 722, y: 10, w: 78, h: 120 }]] as const) {
      const a = arranjoQueCabe(texto, regiao)!;
      expect(a).not.toBeNull();
      for (const l of a.linhas) expect(larguraDoTexto(l, a.fonte)).toBeLessThanOrEqual(regiao.w - 20);
      expect(a.linhas.length * a.fonte).toBeLessThanOrEqual(regiao.h - 20);
    }
    // No canto estreito "2MS" não cabe legível: vai a etiqueta auxiliar, nunca letra encavalada.
    expect(arranjoQueCabe("2MS", { x: 722, y: 10, w: 78, h: 120 })).toBeNull();
  });
});
