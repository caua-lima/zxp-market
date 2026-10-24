import { metaDoDia, type MetaDoDia } from "./ao-vivo";
import type { VendaPresencial } from "./venda-presencial";

/**
 * As vendas PRESENCIAIS (PDV) dentro da barra "Ao vivo".
 *
 * A meta de hoje da barra tem que ser a MESMA do Dashboard — e o Dashboard
 * agora soma o balcão (ver metricas-com-presencial). Então aqui também: o dia,
 * o ontem até o mesmo relógio (o ritmo), as vendas por hora, a última venda e
 * o mês até ontem (a base da meta).
 *
 * Entra na resposta, por cima do cálculo do ML (que fica em cache): uma venda
 * registrada no balcão aparece na próxima leitura.
 */

type Total = { vendas: number; pedidos: number; unidades: number };
type BaseAoVivo = {
  dia: string;
  hoje: Total & Record<string, unknown>;
  ontemAteAgora: Total;
  ontemInteiro: Total;
  porHora: { hoje: number[]; ontem: number[] };
  ultimaVenda: { em: number; valor: number; titulo: string } | null;
  metaDoDia: MetaDoDia | null;
};

export type ContextoDaMeta = {
  /** Vendas válidas do ML no mês até ontem. `null` = não deu pra ler (sem meta, como antes). */
  ateOntemML: number | null;
  metas: { meta1: number; meta2?: number | null; meta3?: number | null } | null;
  diaAtual: number;
  diasNoMes: number;
};

const DIA_MS = 24 * 3600 * 1000;
const diaBR = (ms: number) => {
  const d = new Date(ms - 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
const horaBR = (ms: number) => {
  const d = new Date(ms - 3 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const centavos = (v: number) => Math.round(v * 100) / 100;
const unidadesDe = (v: VendaPresencial) => v.itens.reduce((s, i) => s + i.quantidade, 0);
/** O instante da venda (Brasília, sem horário de verão). */
const instante = (v: VendaPresencial) => Date.parse(`${v.data}T${v.hora}:00.000-03:00`);

export function aoVivoComPresencial<T extends BaseAoVivo>(
  base: T,
  vendas: readonly VendaPresencial[],
  agoraMs: number,
  ctx: ContextoDaMeta | null,
): T & { presencial: { faturamento: number; vendas: number } | null } {
  const hoje = diaBR(agoraMs);
  const ontem = diaBR(agoraMs - DIA_MS);
  const relogio = horaBR(agoraMs);
  const mes = hoje.slice(0, 7);
  const ativas = vendas.filter((v) => v.status === "ativa");

  const deHoje = ativas.filter((v) => v.data === hoje);
  const deOntem = ativas.filter((v) => v.data === ontem);
  const mesAteOntem = ativas.filter((v) => v.data >= `${mes}-01` && v.data <= ontem);

  const somar = (t: Total, vs: VendaPresencial[]): Total => ({
    vendas: centavos(t.vendas + vs.reduce((s, v) => s + v.total, 0)),
    pedidos: t.pedidos + vs.length,
    unidades: t.unidades + vs.reduce((s, v) => s + unidadesDe(v), 0),
  });

  const porHora = { hoje: [...base.porHora.hoje], ontem: [...base.porHora.ontem] };
  for (const v of deHoje) { const h = Number(v.hora.slice(0, 2)) || 0; porHora.hoje[h] = (porHora.hoje[h] ?? 0) + v.total; }
  for (const v of deOntem) { const h = Number(v.hora.slice(0, 2)) || 0; porHora.ontem[h] = (porHora.ontem[h] ?? 0) + v.total; }

  let ultimaVenda = base.ultimaVenda;
  for (const v of deHoje) {
    const em = instante(v);
    if (!Number.isFinite(em)) continue;
    if (!ultimaVenda || em > ultimaVenda.em) ultimaVenda = { em, valor: v.total, titulo: `Presencial · ${v.itens[0]?.nome ?? ""}`.trim() };
  }

  const hojeTotal = { ...base.hoje, ...somar(base.hoje, deHoje) };
  const ontemAteAgora = somar(base.ontemAteAgora, deOntem.filter((v) => v.hora <= relogio));
  const ontemInteiro = somar(base.ontemInteiro, deOntem);

  // A meta de hoje refeita com o balcão nos dois lados: no mês até ontem e no dia.
  const meta = ctx && ctx.ateOntemML != null
    ? metaDoDia({
        metas: ctx.metas,
        vendasAteOntem: ctx.ateOntemML + mesAteOntem.reduce((s, v) => s + v.total, 0),
        vendasHoje: hojeTotal.vendas,
        diaAtual: ctx.diaAtual,
        diasNoMes: ctx.diasNoMes,
      })
    : base.metaDoDia;

  return {
    ...base,
    hoje: hojeTotal,
    ontemAteAgora,
    ontemInteiro,
    porHora,
    ultimaVenda,
    metaDoDia: meta,
    presencial: deHoje.length > 0 ? { faturamento: centavos(deHoje.reduce((s, v) => s + v.total, 0)), vendas: deHoje.length } : null,
  };
}
