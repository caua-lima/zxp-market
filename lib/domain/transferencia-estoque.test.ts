import { describe, expect, it } from "vitest";
import { custoDestinoAposReceber, planejarTransferencia, type LadoDaTransferencia } from "./transferencia-estoque";

const full: LadoDaTransferencia = { id: "limao", nome: "Limão Caipira", emCasa: 0, estoqueTotal: 100, custoMedio: 10 };
const ag: LadoDaTransferencia = { id: "limao-ag", nome: "Limão Caipira Agências", emCasa: 180, estoqueTotal: 180, custoMedio: 12 };
const base = { data: "2026-10-17", idBase: "t1" };

describe("planejarTransferencia", () => {
  it("agências → Full: ajuste negativo na origem, entrada ao custo médio da origem no destino", () => {
    const r = planejarTransferencia({ de: ag, para: full, quantidade: 50, ...base });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saida).toMatchObject({ id: "tr-t1-s", productId: "limao-ag", tipo: "ajuste", quantidade: -50, estoqueAntes: 180, custoMedioAntes: 12, transferenciaId: "t1", transferenciaCom: "limao" });
    expect(r.saida.custoUnit).toBeUndefined();
    expect(r.entrada).toMatchObject({ id: "tr-t1-e", productId: "limao", tipo: "entrada", quantidade: 50, custoUnit: 12, estoqueAntes: 100, custoMedioAntes: 10, transferenciaCom: "limao-ag" });
    expect(r.sobraNaOrigem).toBe(130);
    // (100 × 10 + 50 × 12) / 150 = 10,6667
    expect(r.novoCustoDestino).toBeCloseTo(10.6667, 4);
    expect(r.custoUnit).toBe(12);
  });

  it("não deixa passar do que há em casa (a origem não pode ficar negativa)", () => {
    const r = planejarTransferencia({ de: ag, para: full, quantidade: 181, ...base });
    expect(r).toEqual({ ok: false, motivo: "Só há 180 un em casa em “Limão Caipira Agências” — não dá pra transferir 181." });
  });
  it("origem sem nada em casa", () => {
    const r = planejarTransferencia({ de: full, para: ag, quantidade: 1, ...base });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/Não há estoque em casa/);
  });
  it("transferir exatamente tudo é permitido e zera a origem", () => {
    const r = planejarTransferencia({ de: ag, para: full, quantidade: 180, ...base });
    expect(r.ok && r.sobraNaOrigem).toBe(0);
  });
  it("recusa quantidade zero, negativa, fracionada ou NaN", () => {
    for (const q of [0, -3, 2.5, NaN]) expect(planejarTransferencia({ de: ag, para: full, quantidade: q, ...base }).ok).toBe(false);
  });
  it("recusa origem = destino, destino vazio e data inválida", () => {
    expect(planejarTransferencia({ de: ag, para: ag, quantidade: 1, ...base }).ok).toBe(false);
    expect(planejarTransferencia({ de: ag, para: { ...full, id: "" }, quantidade: 1, ...base }).ok).toBe(false);
    expect(planejarTransferencia({ de: ag, para: full, quantidade: 1, data: "2026-02-30", idBase: "t" }).ok).toBe(false);
    expect(planejarTransferencia({ de: ag, para: full, quantidade: 1, data: "17/10/2026", idBase: "t" }).ok).toBe(false);
  });
  it("origem sem custo: a entrada vai sem custo (não inventa zero) e a média do destino não mexe", () => {
    const r = planejarTransferencia({ de: { ...ag, custoMedio: 0 }, para: full, quantidade: 10, ...base });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("custoUnit" in r.entrada).toBe(false);
    expect(r.custoUnit).toBeNull();
    expect(r.novoCustoDestino).toBe(10);
  });
  it("o motivo vai nas duas pernas, e o texto respeita o limite de 500", () => {
    const r = planejarTransferencia({ de: ag, para: full, quantidade: 5, obs: "sobrou nas agências", ...base });
    expect(r.ok && r.saida.obs).toBe("Transferência para Limão Caipira — sobrou nas agências");
    expect(r.ok && r.entrada.obs).toBe("Transferência de Limão Caipira Agências — sobrou nas agências");
    const longo = planejarTransferencia({ de: ag, para: full, quantidade: 5, obs: "x".repeat(900), ...base });
    expect(longo.ok && longo.saida.obs.length).toBeLessThanOrEqual(500);
  });
  it("ids determinísticos: o mesmo idBase gera os mesmos ids (retry idempotente)", () => {
    const a = planejarTransferencia({ de: ag, para: full, quantidade: 5, ...base });
    const b = planejarTransferencia({ de: ag, para: full, quantidade: 5, ...base });
    expect(a).toEqual(b);
  });
});

describe("custoDestinoAposReceber", () => {
  it("destino vazio ou sem custo: assume o custo de quem chegou", () => {
    expect(custoDestinoAposReceber(0, 0, 10, 7)).toBe(7);
    expect(custoDestinoAposReceber(50, 0, 10, 7)).toBe(7);
  });
  it("mesmo custo dos dois lados: a média não muda", () => {
    expect(custoDestinoAposReceber(100, 10, 30, 10)).toBe(10);
  });
  it("estoque negativo no destino conta como zero", () => {
    expect(custoDestinoAposReceber(-5, 99, 10, 8)).toBe(8);
  });
});
