/**
 * O placar do dia que sai pra fora do app — hoje, só o widget do iPhone
 * (`/api/widget/ao-vivo`, desenhado pelo script do Scriptable em
 * lib/domain/widget-script.ts).
 *
 * Só faturamento e contagem: nada de custo, lucro, visitas nem estoque — a rota
 * do widget não tem sessão, quem a autoriza é o código secreto.
 */
export type PlacarAoVivo = {
  /** Dia (BR) a que os números se referem, "AAAA-MM-DD". */
  dia: string;
  vendas: number;
  pedidos: number;
  unidades: number;
  /** A meta de hoje. `null` sem meta configurada. */
  meta: { alvo: number; pct: number; falta: number; batida: boolean; mesBatido: boolean } | null;
  ultima: { valor: number; titulo: string; em: number } | null;
  /** Faturamento por hora de hoje (24 posições). */
  porHora: number[];
  /** Ontem até o mesmo relógio — o "ritmo". */
  ontemAteAgora: number;
  atualizadoEm: number;
};

type DadosDoPlacar = {
  dia: string;
  hoje: { vendas: number; pedidos: number; unidades: number };
  ontemAteAgora: { vendas: number };
  porHora: { hoje: number[] };
  ultimaVenda: { em: number; valor: number; titulo: string } | null;
  metaDoDia?: { alvo: number; pct: number; falta: number; batida: boolean; mesBatido: boolean } | null;
  atualizadoEm: number;
};

const dinheiro = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** O placar a partir do que a barra ao vivo já tem (resposta de /api/ml/ao-vivo). */
export function placarDe(d: DadosDoPlacar): PlacarAoVivo {
  const m = d.metaDoDia ?? null;
  return {
    dia: d.dia,
    vendas: dinheiro(d.hoje.vendas),
    pedidos: d.hoje.pedidos,
    unidades: d.hoje.unidades,
    // `pct` sem arredondar: a barra arredonda uma vez só, e o widget tem que dar o MESMO %.
    meta: m ? { alvo: dinheiro(m.alvo), pct: m.pct, falta: dinheiro(m.falta), batida: m.batida, mesBatido: m.mesBatido } : null,
    ultima: d.ultimaVenda ? { valor: dinheiro(d.ultimaVenda.valor), titulo: String(d.ultimaVenda.titulo ?? "").slice(0, 60), em: d.ultimaVenda.em } : null,
    porHora: Array.from({ length: 24 }, (_, i) => dinheiro(d.porHora.hoje[i] ?? 0)),
    ontemAteAgora: dinheiro(d.ontemAteAgora.vendas),
    atualizadoEm: d.atualizadoEm,
  };
}
