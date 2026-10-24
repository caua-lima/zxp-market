import { resumoPresencial, type VendaPresencial } from "./venda-presencial";

/**
 * As vendas PRESENCIAIS (PDV) dentro dos números do negócio.
 *
 * O `/api/ml/metrics` é o número do Mercado Livre, conciliado com o Seller
 * Center. O presencial entra POR CIMA dele, na hora da resposta (fora do cache
 * do ML, então a venda aparece logo depois de registrada), somado onde o
 * dinheiro do negócio é medido:
 *
 *  - faturamento (bruto e líquido) e a receita com custo conhecido;
 *  - CMV e lucro (no presencial, lucro = preço − custo: sem imposto, taxa, frete);
 *  - pedidos, o bloco "Vendas do Dia" e a série diária (meta e gráfico).
 *
 * NÃO entra em `conciliacao` (que é comparada com o Seller Center e tem que
 * continuar batendo com ele), nem em `anuncios`/`curvaBruta` (são por anúncio
 * do ML). O bloco `presencial` vai junto, pra a tela dizer quanto do total é
 * do balcão.
 */

export type BlocoPresencial = {
  faturamento: number;
  custo: number;
  lucro: number;
  vendas: number;
  unidades: number;
  desconto: number;
  /** O dia em foco do bloco "Vendas do Dia". */
  hoje: { faturamento: number; custo: number; lucro: number; vendas: number; unidades: number };
  serieDiaria: { data: string; faturamento: number }[];
};

export function blocoPresencial(vendas: readonly VendaPresencial[], de: string, ate: string, dia: string): BlocoPresencial {
  const per = resumoPresencial(vendas, de, ate);
  const h = resumoPresencial(vendas, dia, dia);
  return {
    faturamento: per.faturamento, custo: per.custo, lucro: per.lucro, vendas: per.vendas, unidades: per.unidades, desconto: per.desconto,
    hoje: { faturamento: h.faturamento, custo: h.custo, lucro: h.lucro, vendas: h.vendas, unidades: h.unidades },
    serieDiaria: per.porDia.map((d) => ({ data: d.data, faturamento: d.faturamento })),
  };
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const centavos = (v: number) => Math.round(v * 100) / 100;

/** A resposta de `/api/ml/metrics` com o presencial somado. Não muda o objeto recebido. */
export function comPresencial<T extends Record<string, unknown>>(body: T, p: BlocoPresencial): T & { presencial: BlocoPresencial } {
  const nada = p.vendas === 0 && p.hoje.vendas === 0;
  if (nada) return { ...body, presencial: p };

  const soma = (campo: string, v: number) => (campo in body ? { [campo]: centavos(num(body[campo]) + v) } : {});
  const out: Record<string, unknown> = {
    ...body,
    ...soma("faturamentoBruto", p.faturamento),
    ...soma("faturamentoLiquido", p.faturamento),
    ...soma("totalRetorno", p.faturamento),
    ...soma("totalCMV", p.custo),
    ...soma("lucroSemCustos", p.lucro),
    ...soma("lucroComCustos", p.lucro),
    ...soma("faturamentoHoje", p.hoje.faturamento),
    ...("ordersCount" in body ? { ordersCount: num(body.ordersCount) + p.vendas } : {}),
    ...("pedidosHoje" in body ? { pedidosHoje: num(body.pedidosHoje) + p.hoje.vendas } : {}),
    presencial: p,
  };

  // Margem = lucro ÷ receita com custo conhecido — a mesma conta da rota, refeita com o presencial dentro.
  const retorno = num(out.totalRetorno);
  if ("margemSemCustos" in body) out.margemSemCustos = retorno > 0 ? (num(out.lucroSemCustos) / retorno) * 100 : 0;
  if ("margemComCustos" in body) out.margemComCustos = retorno > 0 ? (num(out.lucroComCustos) / retorno) * 100 : 0;

  const hoje = body.hoje as Record<string, unknown> | undefined;
  if (hoje && typeof hoje === "object" && p.hoje.vendas > 0) {
    out.hoje = {
      ...hoje,
      faturamentoBruto: centavos(num(hoje.faturamentoBruto) + p.hoje.faturamento),
      faturamentoLiquido: centavos(num(hoje.faturamentoLiquido) + p.hoje.faturamento),
      totalRetorno: centavos(num(hoje.totalRetorno) + p.hoje.faturamento),
      totalCMV: centavos(num(hoje.totalCMV) + p.hoje.custo),
      lucroLiquido: centavos(num(hoje.lucroLiquido) + p.hoje.lucro),
      pedidos: num(hoje.pedidos) + p.hoje.vendas,
      unidadesVendidas: num(hoje.unidadesVendidas) + p.hoje.unidades,
    };
  }

  const serie = body.serieDiaria;
  if (Array.isArray(serie) && p.serieDiaria.length > 0) {
    const porDia = new Map<string, number>();
    for (const d of serie as { data: string; faturamento: number }[]) porDia.set(d.data, num(d.faturamento));
    for (const d of p.serieDiaria) porDia.set(d.data, centavos((porDia.get(d.data) ?? 0) + d.faturamento));
    out.serieDiaria = [...porDia.entries()].map(([data, faturamento]) => ({ data, faturamento })).sort((a, b) => a.data.localeCompare(b.data));
  }

  return out as T & { presencial: BlocoPresencial };
}
