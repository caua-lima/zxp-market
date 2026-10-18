import { describe, expect, it } from "vitest";
import { conferirSkuNoAnuncio, explicarErroDoMl, mesmoSku, planejarSkuNoAnuncio, skuDe, type ItemML } from "./sku-ml";

const attr = (sku: string) => [{ id: "BRAND", value_name: "Trot's" }, { id: "SELLER_SKU", value_name: sku }];

describe("skuDe", () => {
  it("lê o atributo SELLER_SKU", () => expect(skuDe({ attributes: attr("LimaoCaipira") })).toBe("LimaoCaipira"));
  it("sem o atributo, cai no campo antigo", () => expect(skuDe({ seller_custom_field: "Antigo" })).toBe("Antigo"));
  it("o atributo vale mais que o campo antigo", () => expect(skuDe({ attributes: attr("Novo"), seller_custom_field: "Velho" })).toBe("Novo"));
  it("nada: vazio", () => expect(skuDe({})).toBe(""));
  it("mesmoSku ignora caixa e borda", () => expect(mesmoSku(" abc ", "ABC")).toBe(true));
});

describe("anúncio sem variações", () => {
  const item = (sku: string): ItemML => ({ id: "MLB1", title: "Limão", attributes: attr(sku) });

  it("SKU antigo → manda só o atributo SELLER_SKU novo", () => {
    const p = planejarSkuNoAnuncio(item("LimaoCaipira"), "LimaoCaipira", "LimaoCaipiraFull");
    expect(p).toMatchObject({ acao: "alterar", skuAtual: "LimaoCaipira", variacoes: [], totalVariacoes: 0 });
    if (p.acao === "alterar") expect(p.corpo).toEqual({ attributes: [{ id: "SELLER_SKU", value_name: "LimaoCaipiraFull" }] });
  });
  it("sem SKU nenhum → recebe o novo", () => {
    expect(planejarSkuNoAnuncio({ id: "MLB1" }, "X", "Novo").acao).toBe("alterar");
  });
  it("só com o campo antigo (seller_custom_field) igual ao SKU antigo → grava no atributo", () => {
    const p = planejarSkuNoAnuncio({ id: "MLB1", seller_custom_field: "LimaoCaipira" }, "LimaoCaipira", "Novo");
    expect(p.acao).toBe("alterar");
    if (p.acao === "alterar") expect(p.corpo.attributes?.[0]).toEqual({ id: "SELLER_SKU", value_name: "Novo" });
  });
  it("já está com o SKU novo → nada a fazer", () => {
    expect(planejarSkuNoAnuncio(item("Novo"), "Velho", "Novo").acao).toBe("ja-esta");
  });
  it("só a caixa diferente do novo → alterar (o ML mostra o que estiver gravado)", () => {
    expect(planejarSkuNoAnuncio(item("novo"), "Velho", "Novo").acao).toBe("alterar");
  });
  it("SKU de OUTRO produto → não mexe, e diz por quê", () => {
    const p = planejarSkuNoAnuncio(item("MentaLimao"), "LimaoCaipira", "LimaoCaipiraFull");
    expect(p.acao).toBe("nao-mexer");
    if (p.acao === "nao-mexer") expect(p.motivo).toMatch(/MentaLimao/);
  });
  it("SKU novo vazio → não mexe", () => {
    expect(planejarSkuNoAnuncio(item("A"), "A", "  ").acao).toBe("nao-mexer");
  });
});

describe("anúncio com variações — todas vão no corpo, senão o ML apaga", () => {
  const item: ItemML = {
    id: "MLB2", title: "Erva sabores",
    variations: [
      { id: 11, attributes: attr("ErvaLimao") },
      { id: 22, attributes: attr("ErvaMenta") },
      { id: 33, attributes: attr("ErvaLimao") },
    ],
  };

  it("só as variações do SKU antigo levam o atributo; as outras vão só com o id", () => {
    const p = planejarSkuNoAnuncio(item, "ErvaLimao", "ErvaLimaoAg");
    expect(p.acao).toBe("alterar");
    if (p.acao !== "alterar") return;
    expect(p.corpo.variations).toEqual([
      { id: 11, attributes: [{ id: "SELLER_SKU", value_name: "ErvaLimaoAg" }] },
      { id: 22 },
      { id: 33, attributes: [{ id: "SELLER_SKU", value_name: "ErvaLimaoAg" }] },
    ]);
    expect(p.variacoes).toEqual([11, 33]);
    expect(p.totalVariacoes).toBe(3);
    expect(p.corpo.attributes).toBeUndefined();
  });
  it("nenhuma variação com o SKU antigo → não mexe (podia trocar a de outro produto)", () => {
    const p = planejarSkuNoAnuncio(item, "Outro", "Novo");
    expect(p.acao).toBe("nao-mexer");
    if (p.acao === "nao-mexer") expect(p.motivo).toMatch(/ErvaLimao, ErvaMenta/);
  });
  it("variações já com o SKU novo → nada a fazer", () => {
    expect(planejarSkuNoAnuncio(item, "Qualquer", "ErvaMenta").acao).toBe("ja-esta");
  });
  it("uma variação só, sem SKU → é dela", () => {
    const p = planejarSkuNoAnuncio({ id: "MLB3", variations: [{ id: 5 }] }, "X", "Novo");
    expect(p.acao).toBe("alterar");
    if (p.acao === "alterar") expect(p.corpo.variations).toEqual([{ id: 5, attributes: [{ id: "SELLER_SKU", value_name: "Novo" }] }]);
  });
  it("várias variações sem SKU → não dá pra saber qual; não mexe", () => {
    const p = planejarSkuNoAnuncio({ id: "MLB4", variations: [{ id: 1 }, { id: 2 }] }, "X", "Novo");
    expect(p.acao).toBe("nao-mexer");
  });
  it("SKU antigo também no anúncio → muda lá também", () => {
    const p = planejarSkuNoAnuncio({ ...item, attributes: attr("ErvaLimao") }, "ErvaLimao", "ErvaLimaoAg");
    expect(p.acao === "alterar" && p.corpo.attributes).toEqual([{ id: "SELLER_SKU", value_name: "ErvaLimaoAg" }]);
  });
});

describe("conferência depois do PUT", () => {
  it("sem variações: o SKU tem que estar lá", () => {
    const p = planejarSkuNoAnuncio({ id: "MLB1", attributes: attr("A") }, "A", "B");
    if (p.acao !== "alterar") throw new Error("plano");
    expect(conferirSkuNoAnuncio({ id: "MLB1", attributes: attr("B") }, p, "B")).toEqual({ ok: true });
    expect(conferirSkuNoAnuncio({ id: "MLB1", attributes: attr("A") }, p, "B")).toMatchObject({ ok: false });
  });
  it("com variações: nenhuma pode sumir, e as alvo têm o SKU novo", () => {
    const antes: ItemML = { id: "MLB2", variations: [{ id: 1, attributes: attr("A") }, { id: 2, attributes: attr("Z") }] };
    const p = planejarSkuNoAnuncio(antes, "A", "B");
    if (p.acao !== "alterar") throw new Error("plano");
    expect(conferirSkuNoAnuncio({ id: "MLB2", variations: [{ id: 1, attributes: attr("B") }, { id: 2, attributes: attr("Z") }] }, p, "B")).toEqual({ ok: true });
    const sumiu = conferirSkuNoAnuncio({ id: "MLB2", variations: [{ id: 1, attributes: attr("B") }] }, p, "B");
    expect(sumiu).toMatchObject({ ok: false });
    if (!sumiu.ok) expect(sumiu.problema).toMatch(/tinha 2 variações e agora tem 1/);
    expect(conferirSkuNoAnuncio({ id: "MLB2", variations: [{ id: 1, attributes: attr("A") }, { id: 2, attributes: attr("Z") }] }, p, "B")).toMatchObject({ ok: false });
  });
});

describe("explicarErroDoMl", () => {
  it("sem permissão de escrita", () => expect(explicarErroDoMl(403, {})).toMatch(/permissão de escrita/));
  it("token vencido", () => expect(explicarErroDoMl(401, {})).toMatch(/Reconecte/));
  it("muitas chamadas", () => expect(explicarErroDoMl(429, {})).toMatch(/esperar/));
  it("400 com causa do ML", () => {
    expect(explicarErroDoMl(400, { message: "Validation error", cause: [{ message: "attribute SELLER_SKU invalid" }] }))
      .toBe("O Mercado Livre recusou: Validation error — attribute SELLER_SKU invalid");
  });
  it("sem corpo", () => expect(explicarErroDoMl(500, null)).toMatch(/HTTP 500/));
});
