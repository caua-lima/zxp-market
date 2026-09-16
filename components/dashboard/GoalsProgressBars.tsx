"use client";

import { clamp, fmtBRL, mesAtual, diaAtualNoMes, diasNoMes, fmtPct } from "@/lib/domain/calc";
import type { Goals } from "@/lib/domain/types";
import type { ArchivedDay } from "@/lib/domain/types";

type Props = {
  goals: Goals | null;
  days: ArchivedDay[];
  liveRevenue: number;
};

function ProgressBar({
  label,
  current,
  target,
  fillClass,
}: {
  label: string;
  current: number;
  target: number;
  fillClass: string;
}) {
  const pct = clamp((current / target) * 100, 0, 100);
  const done = current >= target;

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: ".82rem",
          marginBottom: 5,
        }}
      >
        <span style={{ color: done ? "var(--green)" : "var(--text)", fontWeight: 600 }}>
          {label} {done ? "" : ""}
        </span>
        <span style={{ color: "var(--muted)" }}>
          {fmtBRL(current)} / {fmtBRL(target)}
        </span>
      </div>
      <div className="pbar-wrap" style={{ height: 12 }}>
        <div className={`pbar-fill ${done ? "fill-green" : fillClass}`} style={{ width: `${pct}%` }} />
        <div
          className="pbar-label"
          style={{ left: `${clamp(pct, 4, 76)}%`, paddingLeft: 4 }}
        >
          {fmtPct(pct, 0)}
        </div>
      </div>
    </div>
  );
}

export default function GoalsProgressBars({ goals, days, liveRevenue }: Props) {
  if (!goals?.meta1) {
    return (
      <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "12px 0" }}>
        Nenhuma meta configurada.
      </div>
    );
  }

  const mes = goals.mes || mesAtual();
  const fatHist = days
    .filter((d) => d.date.startsWith(mes))
    .reduce((s, d) => s + d.totalFaturamento, 0);
  const totalFat = fatHist + (mes === mesAtual() ? liveRevenue : 0);

  const diaHoje = mes === mesAtual() ? diaAtualNoMes() : diasNoMes(mes);
  const totalDias = diasNoMes(mes);
  const metaDiariaCurrent = goals.metaDiaria ?? (goals.meta1 / totalDias);
  const metaDiariaProgress = diaHoje > 0 ? metaDiariaCurrent * diaHoje : 0;

  return (
    <div>
      <ProgressBar
        label="Meta 1 (mensal)"
        current={totalFat}
        target={goals.meta1}
        fillClass="fill-blue"
      />
      <ProgressBar
        label="Meta diaria acumulada"
        current={totalFat}
        target={metaDiariaProgress}
        fillClass="fill-yellow"
      />
      {goals.meta2 ? (
        <ProgressBar
          label="Meta 2 (mensal)"
          current={totalFat}
          target={goals.meta2}
          fillClass="fill-yellow"
        />
      ) : null}
      {goals.meta3 ? (
        <ProgressBar
          label="Meta 3 (mensal)"
          current={totalFat}
          target={goals.meta3}
          fillClass="fill-purple"
        />
      ) : null}
    </div>
  );
}
