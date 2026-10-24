import { describe, expect, it } from "vitest";
import { contasDaVenda, montarVendaPresencial, problemaDoCarrinho, resumoPresencial, ultimoPrecoPresencial, type VendaPresencial } from "./venda-presencial";
import { rotuloDoMovimento, type Product } from "./types";

const produto = (o: Partial<Product> & { id: string }): Product => ({ name: o.id, custo: "0", ativo: true, ...o } as Product);
const PRODUTOS: Product[] = [
  // custo médio subiu em 20/10: venda do dia 15 usa 6,00, a do dia 23 usa 7,00
  produto({ id: "limao", name: "Limão Caipira", sku: "LimaoCaipira", custoMedio: 7, custoMedioFaixas: [{ desde: "2000-01-01", custo: 6 }, { desde: "2026-10-20", custo: 7 }] }),
  produto({ id: "erva", name: "Erva Mate", custo: "12,50" }),
];

const base = {
  id: "venda123", desconto: 0, pagamento: "pix" as const, data: "2026-10-23", hora: "14:30",
  produtos: PRODUTOS, email: "dono@x.com", agora: 1000,
};

describe("contasDaVenda — no presencial é preço menos custo, sem imposto nem taxa", () => {
  it("bruto, desconto, total, custo, lucro e margem", () => {
    const c = contasDaVenda([{ quantidade: 3, precoUnit: 15, custoUnit: 7 }, { quantidade: 1, precoUnit: 20, custoUnit: 12.5 }], 5);
    expect(c).toEqual({ bruto: 65, desconto: 5, total: 60, custo: 33.5, lucro: 26.5, margem: (26.5 / 60) * 100 });
  });
  it("desconto não passa do bruto nem fica negativo; sem total, sem margem", () => {
    expect(contasDaVenda([{ quantidade: 1, precoUnit: 10, custoUnit: 4 }], 50).total).toBe(0);
    expect(contasDaVenda([{ quantidade: 1, precoUnit: 10, custoUnit: 4 }], -3).desconto).toBe(0);
    expect(contasDaVenda([{ quantidade: 1, precoUnit: 10, custoUnit: 4 }], 10).margem).toBeNull();
  });
});

describe("problemaDoCarrinho", () => {
  it("carrinho vazio, quantidade torta, preço inválido, total zero e desconto demais", () => {
    expect(problemaDoCarrinho([], 0)).toMatch(/pelo menos um produto/);
    expect(problemaDoCarrinho([{ productId: "a", quantidade: 1.5, precoUnit: 10 }], 0)).toMatch(/inteiro/);
    expect(problemaDoCarrinho([{ productId: "a", quantidade: 0, precoUnit: 10 }], 0)).toMatch(/inteiro/);
    expect(problemaDoCarrinho([{ productId: "a", quantidade: 1, precoUnit: -1 }], 0)).toMatch(/Preço/);
    expect(problemaDoCarrinho([{ productId: "a", quantidade: 1, precoUnit: 0 }], 0)).toMatch(/total zero/);
    expect(problemaDoCarrinho([{ productId: "a", quantidade: 1, precoUnit: 10 }], 11)).toMatch(/desconto é maior/);
    expect(problemaDoCarrinho([{ productId: "a", quantidade: 2, precoUnit: 10 }], 20)).toBeNull();
  });
});

describe("montarVendaPresencial", () => {
  it("custo do DIA da venda (congelado), lucro sem imposto e uma baixa por produto no livro", () => {
    const r = montarVendaPresencial({
      ...base, cliente: "  Dona Maria ",
      linhas: [{ productId: "limao", quantidade: 2, precoUnit: 15 }, { productId: "erva", quantidade: 1, precoUnit: 25 }, { productId: "limao", quantidade: 1, precoUnit: 15 }],
    });
    if (!r.ok) throw new Error(r.erro);
    expect(r.venda.itens).toEqual([
      { productId: "limao", nome: "Limão Caipira", sku: "LimaoCaipira", quantidade: 3, precoUnit: 15, custoUnit: 7 },
      { productId: "erva", nome: "Erva Mate", quantidade: 1, precoUnit: 25, custoUnit: 12.5 },
    ]);
    expect(r.venda).toMatchObject({ bruto: 70, desconto: 0, total: 70, custo: 33.5, lucro: 36.5, status: "ativa", cliente: "Dona Maria", criadoPor: "dono@x.com", criadoEm: 1000 });
    expect(r.baixas).toEqual([
      { id: "pdv_venda123_1", productId: "limao", tipo: "ajuste", quantidade: -3, data: "2026-10-23", obs: "Venda presencial — Dona Maria", vendaPresencialId: "venda123" },
      { id: "pdv_venda123_2", productId: "erva", tipo: "ajuste", quantidade: -1, data: "2026-10-23", obs: "Venda presencial — Dona Maria", vendaPresencialId: "venda123" },
    ]);
  });

  it("venda de antes da compra nova usa o custo antigo", () => {
    const r = montarVendaPresencial({ ...base, data: "2026-10-15", linhas: [{ productId: "limao", quantidade: 1, precoUnit: 15 }] });
    expect(r.ok && r.venda.itens[0].custoUnit).toBe(6);
  });

  it("mesmo produto com preços diferentes fica em duas linhas, mas a baixa é uma só", () => {
    const r = montarVendaPresencial({ ...base, linhas: [{ productId: "limao", quantidade: 1, precoUnit: 15 }, { productId: "limao", quantidade: 2, precoUnit: 12 }] });
    if (!r.ok) throw new Error(r.erro);
    expect(r.venda.itens.map((i) => [i.quantidade, i.precoUnit])).toEqual([[1, 15], [2, 12]]);
    expect(r.baixas.map((b) => b.quantidade)).toEqual([-3]);
  });

  it("recusa produto que não existe, data/hora/pagamento/id inválidos", () => {
    expect(montarVendaPresencial({ ...base, linhas: [{ productId: "x", quantidade: 1, precoUnit: 1 }] })).toMatchObject({ ok: false });
    expect(montarVendaPresencial({ ...base, data: "23/10", linhas: [{ productId: "limao", quantidade: 1, precoUnit: 1 }] })).toMatchObject({ ok: false, erro: "Data inválida." });
    expect(montarVendaPresencial({ ...base, hora: "2pm", linhas: [{ productId: "limao", quantidade: 1, precoUnit: 1 }] })).toMatchObject({ ok: false });
    expect(montarVendaPresencial({ ...base, pagamento: "cheque" as never, linhas: [{ productId: "limao", quantidade: 1, precoUnit: 1 }] })).toMatchObject({ ok: false });
    expect(montarVendaPresencial({ ...base, id: "a/b", linhas: [{ productId: "limao", quantidade: 1, precoUnit: 1 }] })).toMatchObject({ ok: false });
  });

  it("a baixa aparece no histórico como 'Venda presencial'", () => {
    expect(rotuloDoMovimento({ tipo: "ajuste", quantidade: -3, vendaPresencialId: "v" })).toBe("Venda presencial");
    expect(rotuloDoMovimento({ tipo: "ajuste", quantidade: -3 })).toBe("Ajuste");
  });
});

const venda = (o: Partial<VendaPresencial>): VendaPresencial => ({
  id: "v", data: "2026-10-23", hora: "10:00", itens: [], bruto: 0, desconto: 0, total: 0, custo: 0, lucro: 0,
  pagamento: "pix", status: "ativa", criadoEm: 1, criadoPor: "a", ...o,
});

describe("resumoPresencial", () => {
  const vendas = [
    venda({ id: "1", data: "2026-10-22", pagamento: "dinheiro", itens: [{ productId: "limao", nome: "Limão", quantidade: 2, precoUnit: 15, custoUnit: 7 }], bruto: 30, total: 30, custo: 14, lucro: 16 }),
    // desconto de 10 em 50: o faturamento por produto é rateado (80%)
    venda({ id: "2", data: "2026-10-23", itens: [{ productId: "limao", nome: "Limão", quantidade: 2, precoUnit: 15, custoUnit: 7 }, { productId: "erva", nome: "Erva", quantidade: 1, precoUnit: 20, custoUnit: 12 }], bruto: 50, desconto: 10, total: 40, custo: 26, lucro: 14 }),
    venda({ id: "3", data: "2026-10-23", status: "cancelada", itens: [{ productId: "erva", nome: "Erva", quantidade: 5, precoUnit: 20, custoUnit: 12 }], bruto: 100, total: 100, custo: 60, lucro: 40 }),
    venda({ id: "4", data: "2026-10-01", itens: [{ productId: "erva", nome: "Erva", quantidade: 1, precoUnit: 20, custoUnit: 12 }], bruto: 20, total: 20, custo: 12, lucro: 8 }),
  ];

  it("só ativas e dentro do período; por pagamento, produto e dia", () => {
    const r = resumoPresencial(vendas, "2026-10-20", "2026-10-31");
    expect(r).toMatchObject({ vendas: 2, unidades: 5, faturamento: 70, custo: 40, lucro: 30, desconto: 10, ticketMedio: 35 });
    expect(r.margem).toBeCloseTo((30 / 70) * 100, 6);
    expect(r.porPagamento).toEqual([{ forma: "pix", vendas: 1, total: 40 }, { forma: "dinheiro", vendas: 1, total: 30 }]);
    expect(r.porProduto).toEqual([
      { productId: "limao", nome: "Limão", unidades: 4, faturamento: 54, lucro: 26 },
      { productId: "erva", nome: "Erva", unidades: 1, faturamento: 16, lucro: 4 },
    ]);
    expect(r.porProduto.reduce((s, p) => s + p.faturamento, 0)).toBe(r.faturamento);
    expect(r.porDia).toEqual([{ data: "2026-10-22", vendas: 1, faturamento: 30, lucro: 16 }, { data: "2026-10-23", vendas: 1, faturamento: 40, lucro: 14 }]);
  });

  it("período vazio", () => {
    expect(resumoPresencial(vendas, "2025-01-01", "2025-01-31")).toMatchObject({ vendas: 0, faturamento: 0, margem: null, ticketMedio: null });
  });

  it("último preço cobrado do produto (ignora cancelada)", () => {
    const vs = [
      venda({ id: "a", data: "2026-10-20", itens: [{ productId: "limao", nome: "L", quantidade: 1, precoUnit: 14, custoUnit: 7 }] }),
      venda({ id: "b", data: "2026-10-22", itens: [{ productId: "limao", nome: "L", quantidade: 1, precoUnit: 16, custoUnit: 7 }] }),
      venda({ id: "c", data: "2026-10-23", status: "cancelada", itens: [{ productId: "limao", nome: "L", quantidade: 1, precoUnit: 99, custoUnit: 7 }] }),
    ];
    expect(ultimoPrecoPresencial("limao", vs)).toBe(16);
    expect(ultimoPrecoPresencial("erva", vs)).toBeNull();
  });
});

describe("baixasDaVenda", () => {
  it("os mesmos ids e quantidades que a venda gravou", async () => {
    const { baixasDaVenda } = await import("./venda-presencial");
    const r = montarVendaPresencial({ ...base, linhas: [{ productId: "erva", quantidade: 1, precoUnit: 25 }, { productId: "limao", quantidade: 1, precoUnit: 15 }, { productId: "limao", quantidade: 2, precoUnit: 12 }] });
    if (!r.ok) throw new Error(r.erro);
    expect(baixasDaVenda(r.venda)).toEqual(r.baixas.map((b) => ({ id: b.id, productId: b.productId, quantidade: -b.quantidade })));
  });
});
