import { describe, expect, it } from "vitest";
import { dadoDoCode128, idDoQr, lerLote, pareceZpl } from "./lote-zpl";

/** Etiqueta sintética com a mesma estrutura das do ML (sem dado real de ninguém). */
function etiqueta(envio: string, extra = "", qr: string = envio): string {
  return [
    "^XA", "^MCY", "^CI28", "^LH5,15",
    "^FO120,20^A0N,24,24^FH^FDLoja Teste #1^FS",
    `^FO120,120^A0N,24,24^FDEnvio: ${envio.slice(0, 6)}^FS`,
    `^FO230,210^BY3,,0^BCN,160,N,N,N^FD>:${envio}^FS`,
    "^FO30,1016^A0N,30,30^FDCEP: 01001000^FS",
    extra,
    `^FO510,880^BY2,2,0^BQN,2,10^FDLA,{"id":"${qr}","t":"lm"}^FS`,
    "^XZ",
  ].join("\n");
}

describe("lerLote — separa as etiquetas e acha o envio de cada uma", () => {
  it("19 etiquetas, 19 envios, na ordem do arquivo", () => {
    const ids = Array.from({ length: 19 }, (_, i) => String(90000000000 + i));
    const lote = lerLote(ids.map((id) => etiqueta(id)).join("\n"));
    expect(lote.etiquetas).toHaveLength(19);
    expect(lote.etiquetas.map((e) => e.envio)).toEqual(ids);
    expect(lote.duplicados).toEqual([]);
  });

  it("o segundo código de barras (tracking da transportadora) não vira o envio", () => {
    const tracking = "^FO70,755^BY5,,0^BCN,140,N,N,N,A^FD888000000000001^FS";
    const [e] = lerLote(etiqueta("90000000123", tracking)).etiquetas;
    expect(e.envio).toBe("90000000123");
  });

  it("código de barras e QR divergentes: não escolhe um no chute", () => {
    const [e] = lerLote(etiqueta("90000000001", "", "90000000002")).etiquetas;
    expect(e.envio).toBeNull();
    expect(e.problema).toMatch(/não batem/);
  });

  it("a mesma etiqueta duas vezes no arquivo aparece como duplicada", () => {
    const lote = lerLote(etiqueta("90000000005") + etiqueta("90000000005"));
    expect(lote.duplicados).toEqual(["90000000005"]);
  });

  it("texto fora de ^XA…^XZ é guardado, não descartado", () => {
    const lote = lerLote("~JA\n" + etiqueta("90000000006"));
    expect(lote.prefixo).toBe("~JA");
  });
});

describe("peças", () => {
  it("o >: do ZPL não faz parte do número", () => {
    expect(dadoDoCode128(">:48513432846")).toBe("48513432846");
    expect(dadoDoCode128(">;1234>6AB")).toBe("1234AB");
  });
  it("id do QR, com e sem tracking junto", () => {
    expect(idDoQr('LA,{"id":"48506724509","t":"lm","tn":"888002857152813"}')).toBe("48506724509");
    expect(idDoQr("LA,qualquer coisa")).toBeNull();
  });
  it("só conteúdo ZPL passa (PDF renomeado não)", () => {
    expect(pareceZpl(etiqueta("90000000007"))).toBe(true);
    expect(pareceZpl("%PDF-1.7 ...")).toBe(false);
  });
});
