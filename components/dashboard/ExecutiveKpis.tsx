"use client";

import { fmtBRL } from "@/lib/domain/calc";

export type KpiTone = "pos" | "neg" | "acc" | "warn";

/**
 * Mesma lógica de seta/cor/percentual usada no grid detalhado — única fonte,
 * evita duplicar a conta de delta. `invert` é pra métricas onde SUBIR é
 * ruim (ex.: custo) — sem isso, um custo que aumentou apareceria em verde.
 */
export function Delta({ current, previous, mode, invert, label = "vs período anterior" }: { current: number; previous: number | null | undefined; mode: "pct" | "points"; invert?: boolean; label?: string }) {
  if (previous == null) return null;
  const diff = current - previous;
  const flat = mode === "points"
    ? Math.abs(diff) < 0.05
    : Math.abs(diff) < 0.005 * Math.max(Math.abs(previous), 1);
  const up = diff > 0;
  const good = invert ? !up : up;
  const color = flat ? "var(--text-muted)" : good ? "var(--success)" : "var(--danger)";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  let text: string;
  if (mode === "points") {
    text = `${diff >= 0 ? "+" : "-"}${Math.abs(diff).toFixed(1)} p.p.`;
  } else {
    const pct = previous !== 0 ? (diff / Math.abs(previous)) * 100 : (current !== 0 ? 100 : 0);
    text = `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: ".75rem", fontWeight: 700, color }}>
      <span aria-hidden="true">{arrow}</span><span>{text} {label}</span>
    </div>
  );
}

export type ExecutiveKpiItem = {
  key: string;
  label: string;
  value: number;
  format: "currency" | "percent";
  tone: KpiTone;
  tooltip: string;
  delta?: { current: number; previous: number | null | undefined; mode: "pct" | "points"; invert?: boolean; label?: string };
  ctaLabel?: string;
  onClick?: () => void;
  indisponivel?: boolean;
};

const TONE_VAR: Record<KpiTone, string> = {
  pos: "var(--success)", neg: "var(--danger)", acc: "var(--brand)", warn: "var(--warning)",
};

/**
 * As 4 perguntas que respondem "quanto vendi e quanto lucrei" em poucos
 * segundos — versão resumida do grid detalhado que já existe em "Resultado
 * do período" mais abaixo (nenhum dos dois substitui o outro: este é o
 * resumo, o de baixo é o detalhamento por linha de custo).
 */
export default function ExecutiveKpis({ items }: { items: ExecutiveKpiItem[] }) {
  return (
    <section className="exec-kpis">
      {items.map((it) => {
        const color = TONE_VAR[it.tone];
        return (
          <div key={it.key} className="exec-kpi">
            <div className="exec-kpi-head">
              <span className="exec-kpi-label">{it.label}</span>
              <span className="pg-info" tabIndex={0}>
                ⓘ
                <span role="tooltip" className="pg-tooltip">{it.tooltip}</span>
              </span>
            </div>
            <div className="exec-kpi-value money" style={{ color: it.indisponivel ? "var(--text-muted)" : color }}>
              {it.indisponivel ? "—" : it.format === "percent" ? `${it.value.toFixed(1)}%` : fmtBRL(it.value)}
            </div>
            {it.delta && <Delta {...it.delta} />}
            {it.ctaLabel && it.onClick && (
              <button type="button" className="ac-cta" style={{ marginTop: 6 }} onClick={it.onClick}>{it.ctaLabel} →</button>
            )}
          </div>
        );
      })}
    </section>
  );
}
