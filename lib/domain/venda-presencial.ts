import { parseBRNumber } from "./calc";
import { custoNaData, type EstoqueMovimento, type Product } from "./types";

/**
 * PDV — as vendas feitas no PRESENCIAL (balcão, entrega em mão), fora do
 * Mercado Livre.
 *
 * ─── A CONTA É OUTRA ────────────────────────────────────────────────────
 *
 * No presencial não há nota, imposto, comissão nem frete: o lucro é o preço
 * de venda menos o custo da mercadoria, e só. Por isso NADA aqui passa por
 * `order-finance` (que desconta taxa do ML, frete e imposto) — misturar as
 * duas contas daria imposto onde não existe.
 *
 * O custo é o custo médio que valia NO DIA da venda (custoNaData), congelado
 * na venda: uma compra nova depois não muda o lucro do que já foi vendido —
 * a mesma regra das vendas do ML.
 *
 * ─── O ESTOQUE ──────────────────────────────────────────────────────────
 *
 * A mercadoria saiu do galpão: cada produto vendido vira uma BAIXA no livro
 * (ajuste negativo, marcado com `vendaPresencialId`), no mesmo lote da venda.
 * Cancelar a venda desfaz as baixas. Ajuste negativo tira de "em casa" e não
 * mexe no custo médio (ver reconstruirCusto).
 */

export const FORMAS_PAGAMENTO = ["pix", "dinheiro", "debito", "credito", "outro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];
export const ROTULO_PAGAMENTO: Record<FormaPagamento, string> = {
  pix: "Pix", dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito", outro: "Outro",
};

export type ItemVendaPresencial = {
  productId: string;
  nome: string;
  sku?: string;
  quantidade: number;
  /** Preço cobrado por unidade. */
  precoUnit: number;
  /** Custo médio da unidade no dia da venda — congelado. */
  custoUnit: number;
};

export type StatusVendaPresencial = "ativa" | "cancelada";

export type VendaPresencial = {
  id: string;
  /** Dia da venda (Brasília), AAAA-MM-DD. */
  data: string;
  /** Hora (Brasília), HH:MM. */
  hora: string;
  itens: ItemVendaPresencial[];
  /** Soma de quantidade × preço, antes do desconto. */
  bruto: number;
  /** Desconto no total (R$). */
  desconto: number;
  /** O que entrou no caixa: bruto − desconto. */
  total: number;
  /** Custo da mercadoria vendida. */
  custo: number;
  /** total − custo. Sem imposto, sem taxa: é presencial. */
  lucro: number;
  pagamento: FormaPagamento;
  cliente?: string;
  obs?: string;
  status: StatusVendaPresencial;
  criadoEm: number;
  criadoPor: string;
  canceladaEm?: number;
  canceladaPor?: string;
  motivoCancelamento?: string;
};

/** Uma linha do carrinho, como a tela monta. */
export type LinhaDoCarrinho = { productId: string; quantidade: number; precoUnit: number };

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * O custo da unidade no dia. Produto sem livro ainda tem só o custo digitado
 * no cadastro, que vem em formato brasileiro ("12,50") — lido como número
 * puro daria 0, e o lucro sairia inflado pelo custo inteiro.
 */
export function custoDoDia(p: Product, data: string): number {
  const c = custoNaData(p, data);
  return c > 0 ? c : parseBRNumber(p.custo);
}

/** As contas da venda. Lucro = total − custo; margem sobre o total (null sem total). */
export function contasDaVenda(
  itens: readonly { quantidade: number; precoUnit: number; custoUnit: number }[],
  desconto = 0,
): { bruto: number; desconto: number; total: number; custo: number; lucro: number; margem: number | null } {
  const bruto = centavos(itens.reduce((s, i) => s + i.quantidade * i.precoUnit, 0));
  const d = centavos(Math.min(Math.max(Number(desconto) || 0, 0), bruto));
  const total = centavos(bruto - d);
  const custo = centavos(itens.reduce((s, i) => s + i.quantidade * i.custoUnit, 0));
  const lucro = centavos(total - custo);
  return { bruto, desconto: d, total, custo, lucro, margem: total > 0 ? (lucro / total) * 100 : null };
}

/** O que impede de fechar a venda, em português; `null` = pode fechar. */
export function problemaDoCarrinho(linhas: readonly LinhaDoCarrinho[], desconto: number): string | null {
  if (linhas.length === 0) return "Adicione pelo menos um produto.";
  for (const l of linhas) {
    if (!Number.isInteger(l.quantidade) || l.quantidade < 1) return "Quantidade tem que ser um número inteiro, de 1 pra cima.";
    if (l.quantidade > 9999) return "Quantidade grande demais pra uma venda só.";
    if (!Number.isFinite(l.precoUnit) || l.precoUnit < 0) return "Preço inválido.";
  }
  const bruto = linhas.reduce((s, l) => s + l.quantidade * l.precoUnit, 0);
  if (bruto <= 0) return "A venda está com total zero — confira os preços.";
  if (!Number.isFinite(desconto) || desconto < 0) return "Desconto inválido.";
  if (desconto > bruto + 0.001) return "O desconto é maior que o total da venda.";
  return null;
}

type BaixaNoLivro = Omit<EstoqueMovimento, "createdBy" | "createdAt" | "revisao">;

/**
 * A venda pronta pra gravar e as baixas no livro (uma por produto).
 *
 * Linhas do MESMO produto com o MESMO preço viram uma linha só; com preços
 * diferentes ficam separadas (é o que foi cobrado). A baixa soma o produto
 * inteiro. Ids fixos a partir do id da venda: repetir cai nos mesmos documentos.
 */
export function montarVendaPresencial(e: {
  id: string;
  linhas: readonly LinhaDoCarrinho[];
  desconto: number;
  pagamento: FormaPagamento;
  cliente?: string;
  obs?: string;
  data: string;
  hora: string;
  produtos: readonly Product[];
  email: string;
  agora: number;
}): { ok: true; venda: VendaPresencial; baixas: BaixaNoLivro[] } | { ok: false; erro: string } {
  const problema = problemaDoCarrinho(e.linhas, e.desconto);
  if (problema) return { ok: false, erro: problema };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.data)) return { ok: false, erro: "Data inválida." };
  if (!/^\d{2}:\d{2}$/.test(e.hora)) return { ok: false, erro: "Hora inválida." };
  if (!FORMAS_PAGAMENTO.includes(e.pagamento)) return { ok: false, erro: "Forma de pagamento inválida." };
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(e.id)) return { ok: false, erro: "Id da venda inválido." };

  const porId = new Map(e.produtos.map((p) => [p.id, p]));
  const itens: ItemVendaPresencial[] = [];
  for (const l of e.linhas) {
    const p = porId.get(l.productId);
    if (!p) return { ok: false, erro: "Um dos produtos não existe mais no cadastro." };
    const precoUnit = centavos(l.precoUnit);
    const igual = itens.find((i) => i.productId === p.id && i.precoUnit === precoUnit);
    if (igual) { igual.quantidade += l.quantidade; continue; }
    itens.push({
      productId: p.id,
      nome: String(p.name ?? "").slice(0, 200),
      ...(p.sku ? { sku: String(p.sku).slice(0, 80) } : {}),
      quantidade: l.quantidade,
      precoUnit,
      custoUnit: Math.round(custoDoDia(p, e.data) * 10000) / 10000,
    });
  }

  const contas = contasDaVenda(itens, e.desconto);
  const cliente = String(e.cliente ?? "").trim().slice(0, 120);
  const obs = String(e.obs ?? "").trim().slice(0, 500);
  const venda: VendaPresencial = {
    id: e.id, data: e.data, hora: e.hora, itens,
    bruto: contas.bruto, desconto: contas.desconto, total: contas.total, custo: contas.custo, lucro: contas.lucro,
    pagamento: e.pagamento,
    ...(cliente ? { cliente } : {}),
    ...(obs ? { obs } : {}),
    status: "ativa", criadoEm: e.agora, criadoPor: e.email,
  };

  const porProduto = new Map<string, number>();
  for (const i of itens) porProduto.set(i.productId, (porProduto.get(i.productId) ?? 0) + i.quantidade);
  const baixas: BaixaNoLivro[] = [...porProduto.entries()].map(([productId, qtd], k) => ({
    id: `pdv_${e.id}_${k + 1}`,
    productId,
    tipo: "ajuste",
    quantidade: -qtd,
    data: e.data,
    obs: `Venda presencial${cliente ? ` — ${cliente}` : ""}`.slice(0, 500),
    vendaPresencialId: e.id,
  }));

  return { ok: true, venda, baixas };
}

/** O preço da última venda presencial ATIVA deste produto — a sugestão do PDV. `null` sem histórico. */
export function ultimoPrecoPresencial(productId: string, vendas: readonly VendaPresencial[]): number | null {
  let melhor: { quando: string; preco: number } | null = null;
  for (const v of vendas) {
    if (v.status !== "ativa") continue;
    const item = v.itens.find((i) => i.productId === productId);
    if (!item) continue;
    const quando = `${v.data} ${v.hora} ${String(v.criadoEm).padStart(15, "0")}`;
    if (!melhor || quando > melhor.quando) melhor = { quando, preco: item.precoUnit };
  }
  return melhor?.preco ?? null;
}

export type ResumoPresencial = {
  vendas: number;
  unidades: number;
  faturamento: number;
  custo: number;
  lucro: number;
  desconto: number;
  /** Lucro ÷ faturamento, em %. `null` sem faturamento. */
  margem: number | null;
  ticketMedio: number | null;
  porPagamento: { forma: FormaPagamento; vendas: number; total: number }[];
  porProduto: { productId: string; nome: string; unidades: number; faturamento: number; lucro: number }[];
  porDia: { data: string; vendas: number; faturamento: number; lucro: number }[];
};

/**
 * O período inteiro (de/até inclusive, AAAA-MM-DD). Só vendas ativas: a
 * cancelada sai de tudo. O faturamento por produto rateia o desconto da venda
 * proporcionalmente ao valor de cada item — senão a soma por produto passaria
 * do total.
 */
export function resumoPresencial(vendas: readonly VendaPresencial[], de: string, ate: string): ResumoPresencial {
  const ativas = vendas.filter((v) => v.status === "ativa" && v.data >= de && v.data <= ate);
  const r: ResumoPresencial = {
    vendas: ativas.length, unidades: 0, faturamento: 0, custo: 0, lucro: 0, desconto: 0, margem: null, ticketMedio: null,
    porPagamento: [], porProduto: [], porDia: [],
  };
  const pagamentos = new Map<FormaPagamento, { vendas: number; total: number }>();
  const produtos = new Map<string, { productId: string; nome: string; unidades: number; faturamento: number; lucro: number }>();
  const dias = new Map<string, { data: string; vendas: number; faturamento: number; lucro: number }>();

  for (const v of ativas) {
    r.faturamento += v.total;
    r.custo += v.custo;
    r.lucro += v.lucro;
    r.desconto += v.desconto;
    const pg = pagamentos.get(v.pagamento) ?? { vendas: 0, total: 0 };
    pg.vendas += 1; pg.total += v.total;
    pagamentos.set(v.pagamento, pg);
    const dia = dias.get(v.data) ?? { data: v.data, vendas: 0, faturamento: 0, lucro: 0 };
    dia.vendas += 1; dia.faturamento += v.total; dia.lucro += v.lucro;
    dias.set(v.data, dia);
    const fator = v.bruto > 0 ? v.total / v.bruto : 0;
    for (const i of v.itens) {
      r.unidades += i.quantidade;
      const p = produtos.get(i.productId) ?? { productId: i.productId, nome: i.nome, unidades: 0, faturamento: 0, lucro: 0 };
      const receita = i.quantidade * i.precoUnit * fator;
      p.unidades += i.quantidade;
      p.faturamento += receita;
      p.lucro += receita - i.quantidade * i.custoUnit;
      produtos.set(i.productId, p);
    }
  }

  r.faturamento = centavos(r.faturamento);
  r.custo = centavos(r.custo);
  r.lucro = centavos(r.lucro);
  r.desconto = centavos(r.desconto);
  r.margem = r.faturamento > 0 ? (r.lucro / r.faturamento) * 100 : null;
  r.ticketMedio = r.vendas > 0 ? centavos(r.faturamento / r.vendas) : null;
  r.porPagamento = FORMAS_PAGAMENTO.filter((f) => pagamentos.has(f)).map((f) => ({ forma: f, vendas: pagamentos.get(f)!.vendas, total: centavos(pagamentos.get(f)!.total) }));
  r.porProduto = [...produtos.values()]
    .map((p) => ({ ...p, faturamento: centavos(p.faturamento), lucro: centavos(p.lucro) }))
    .sort((a, b) => b.faturamento - a.faturamento || a.nome.localeCompare(b.nome));
  r.porDia = [...dias.values()]
    .map((d) => ({ ...d, faturamento: centavos(d.faturamento), lucro: centavos(d.lucro) }))
    .sort((a, b) => a.data.localeCompare(b.data));
  return r;
}
