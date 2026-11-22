import { describe, expect, it } from "vitest";
import amostra from "./__fixtures__/envios-full-ml.json";
import {
  caminhoDaLista, caminhoDoDetalhe, contextoDaPagina, enderecoDosEnvios, enxugarDetalhe, enxugarLinha,
  lerDetalhe, lerLista, listaJaCobreOQueImporta, recortarObjeto,
} from "../../extensao-vigia-full/envios.js";
import { lerDetalheDoEnvio, lerEnvioDaLista } from "./envios-full-ml";

/**
 * O HTML como o painel do ML entrega (22/11/2026): o objeto vem num script
 * `__NORDIC_RENDERING_CTX__`, seguido de OUTRAS instruções — JSON.parse do
 * resto inteiro falha, por isso o recorte respeitando chaves e aspas.
 */
const pagina = (r: unknown) => `<!doctype html><html><head><script id="__NORDIC_CORE_CTX__">_n.ctx.c={"x":1};</script>
<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(r)};_n.ctx.r.assets={manifest:new Map([["a.js","a.1.js"]])};</script></head><body></body></html>`;

const htmlLista = pagina({ appProps: { pageProps: { data: { paging: { limit: 20, total: 94, offset: 0 }, results: amostra.lista } } } });
const htmlDetalhe = pagina({ appProps: { pageProps: { view: { data: { ...amostra.detalheAgendado, pickupSettings: { x: "}{\"" } } } } } });

describe("recorte do objeto da página", () => {
  it("para no fim do PRIMEIRO objeto, mesmo com '}' e aspas dentro de texto", () => {
    expect(recortarObjeto('a={"t":"x}y\\"z","n":{"k":1}};b={}', "a=")).toEqual({ t: 'x}y"z', n: { k: 1 } });
  });

  it("sem a marca, ou quebrado, devolve null — não explode", () => {
    expect(recortarObjeto("nada aqui", "a=")).toBeNull();
    expect(recortarObjeto('a={"t":', "a=")).toBeNull();
    expect(contextoDaPagina("<html></html>")).toBeNull();
  });
});

describe("lista de envios", () => {
  it("lê resultados e paginação", () => {
    const l = lerLista(htmlLista)!;
    expect(l.total).toBe(94);
    expect(l.porPagina).toBe(20);
    expect(l.resultados.map((r: { id: number }) => r.id)).toContain(80517703);
  });

  it("o que vai pro app é lido pelo domínio igualzinho", () => {
    const l = lerLista(htmlLista)!;
    const e = lerEnvioDaLista(enxugarLinha(l.resultados.find((r: { id: number }) => r.id === 80517703)));
    expect(e).toMatchObject({ id: "80517703", editarAte: "2026-11-23T23:59:00-03:00", declarado: 1750 });
  });

  it("página de detalhe não passa por lista", () => {
    expect(lerLista(htmlDetalhe)).toBeNull();
  });

  it("para de descer quando a página toda já está encerrada há tempo", () => {
    const agora = Date.parse("2026-11-22T12:00:00-03:00");
    const velhos = [{ status: "closed_ok", last_updated: "2026-09-01T00:00:00-03:00" }, { status: "cancelled", last_updated: "2026-08-01T00:00:00-03:00" }];
    expect(listaJaCobreOQueImporta(velhos, agora)).toBe(true);
    expect(listaJaCobreOQueImporta(amostra.lista, agora)).toBe(false);
  });
});

describe("detalhe do envio", () => {
  it("lê o envio e o que vai pro app vira os 8 produtos e o custo estimado", () => {
    const d = lerDetalhe(htmlDetalhe)!;
    const e = lerDetalheDoEnvio(enxugarDetalhe(d))!;
    expect(e.produtos).toHaveLength(8);
    expect(e.custo).toEqual({ valor: 691.28, estimado: true, cobrado: false });
  });

  it("o enxugado não leva o que o app não usa (endereço, configuração)", () => {
    const enx = enxugarDetalhe(lerDetalhe(htmlDetalhe)!);
    expect(JSON.stringify(enx)).not.toContain("pickupSettings");
  });

  it("lista não passa por detalhe", () => {
    expect(lerDetalhe(htmlLista)).toBeNull();
  });
});

describe("endereços", () => {
  it("o dos envios sai do endereço da vigia, com o mesmo código", () => {
    expect(enderecoDosEnvios("https://app.exemplo/api/widget/vigias?t=abc")).toBe("https://app.exemplo/api/widget/envios-full?t=abc");
    expect(enderecoDosEnvios("")).toBe("");
  });

  it("caminhos do painel", () => {
    expect(caminhoDaLista(1)).toBe("/shipping/inbounds");
    expect(caminhoDaLista(3)).toBe("/shipping/inbounds?page=3");
    expect(caminhoDoDetalhe("80517703")).toBe("/shipping/inbounds/80517703/details");
  });
});
