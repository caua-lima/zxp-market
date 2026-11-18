import { describe, expect, it } from "vitest";
import { lerLote } from "./lote-zpl";
import { linhasDaLista, montarSaida, zplDeSaida, type EnvioResolvido } from "./montagem";

const etiqueta = (id: string, extra = "") => [
  "^XA", "^CI28", "^LH5,15",
  "^FO120,20^A0N,24,24^FH^FDLoja Teste #1^FS",
  extra,
  `^FO230,210^BY3,,0^BCN,160,N,N,N^FD>:${id}^FS`,
  `^FO510,880^BY2,2,0^BQN,2,10^FDLA,{"id":"${id}","t":"lm"}^FS`,
  "^XZ",
].join("\n");
// Ocupa as duas regiões de marcação: força a etiqueta auxiliar.
const CHEIO = "^FO630,0^GB180,140,140^FS";

const ok = (envio: string, texto: string): EnvioResolvido => ({ envio, status: "ok", itens: [{ mlb: "MLB1", sku: "TT", titulo: "Trot's", quantidade: 1 }], texto, porSigla: [] });

describe("montarSaida", () => {
  const lote = lerLote([etiqueta("90000000001"), etiqueta("90000000002", CHEIO), etiqueta("90000000003")].join("\n"));
  const res = new Map<string, EnvioResolvido>([
    ["90000000001", ok("90000000001", "2TT")],
    ["90000000002", ok("90000000002", "BM")],
    ["90000000003", { envio: "90000000003", status: "pendente", itens: [], motivo: "produto sem cadastro de sigla" }],
  ]);

  it("marca a pronta, põe auxiliar quando não cabe, deixa a pendente como veio", () => {
    const s = montarSaida(lote.etiquetas, res, { marcar: true });
    expect(s.map((x) => x.tipo)).toEqual(["marcada", "original", "auxiliar", "original"]);
    expect(s[0].zpl).toContain("^FD2TT^FS");
    expect(s[1].zpl).toBe(lote.etiquetas[1].zpl);
    expect(s[1].aviso).toMatch(/auxiliar/);
    expect(s[2].zpl).toContain("BM");
    expect(s[3].zpl).toBe(lote.etiquetas[2].zpl);
    expect(s[3].aviso).toBe("produto sem cadastro de sigla");
  });

  it("sem marcar: o arquivo sai idêntico", () => {
    const s = montarSaida(lote.etiquetas, res, { marcar: false });
    expect(s.map((x) => x.zpl)).toEqual(lote.etiquetas.map((e) => e.zpl));
  });

  it("zplDeSaida junta tudo com o prefixo", () => {
    const z = zplDeSaida(montarSaida(lote.etiquetas, res, { marcar: true }), "~SD20");
    expect(z.startsWith("~SD20\n^XA")).toBe(true);
    expect(z.match(/\^XA/g)?.length).toBe(4);
  });

  it("linhasDaLista: pronta com texto, pendente com motivo, repetida avisada", () => {
    const l = linhasDaLista(lote.etiquetas, res, ["90000000001"]);
    expect(l[0]).toMatchObject({ ordem: 1, texto: "2TT", problema: null });
    expect(l[2]).toMatchObject({ ordem: 3, texto: null, problema: "produto sem cadastro de sigla" });
    expect(montarSaida(lote.etiquetas, res, { marcar: true, duplicados: ["90000000001"] })[0].aviso).toBe("envio repetido no arquivo");
  });
});
