"use client";

import type { Goals } from "@/lib/domain/types";
import { clamp, fmtBRL } from "@/lib/domain/calc";

export default function MetaDiaria({
  goals,
  fat,
}: {
  goals: Goals | null;
  fat: number;
}) {
  if (!goals) return null;
  const m1 = goals.metaDiaria || 0;
  const m2 = goals.meta2Diaria || 0;
  const m3 = goals.meta3Diaria || 0;
  if (!m1) return null;

  const m1ok = fat >= m1;
  const m2ok = m2 > 0 && fat >= m2;
  const m3ok = m3 > 0 && fat >= m3;

  return (
    <div className="meta-diaria-card">
      <div className="meta-diaria-top">
        <h3>📆 Metas Diárias de Faturamento</h3>
      </div>
      <Bar
        num={1}
        alvo={m1}
        atual={fat}
        desbloqueada={true}
        atingida={m1ok}
        fillCls="fill-blue"
        label="Objetivo"
      />
      {m2 > 0 && (
        <Bar
          num={2}
          alvo={m2}
          atual={fat}
          desbloqueada={m1ok}
          atingida={m2ok}
          fillCls="fill-yellow"
          label="Bônus"
        />
      )}
      {m3 > 0 && (
        <Bar
          num={3}
          alvo={m3}
          atual={fat}
          desbloqueada={m2ok}
          atingida={m3ok}
          fillCls="fill-purple"
          label="Super Bônus"
        />
      )}
    </div>
  );
}

function Bar({
  num,
  alvo,
  atual,
  desbloqueada,
  atingida,
  fillCls,
  label,
}: {
  num: 1 | 2 | 3;
  alvo: number;
  atual: number;
  desbloqueada: boolean;
  atingida: boolean;
  fillCls: string;
  label: string;
}) {
  const pct = clamp((atual / alvo) * 100, 0, 100);
  const falta = Math.max(alvo - atual, 0);
  const cor = atingida ? "fill-green" : fillCls;
  const icons = ["🥇", "🥈", "🥉"];

  if (!desbloqueada) {
    return (
      <div style={{ marginBottom: num < 3 ? 12 : 0, opacity: 0.45 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 5,
          }}
        >
          <span style={{ fontSize: ".8rem", fontWeight: 700 }}>
            {icons[num - 1]} Meta Diária {num} — {label}
          </span>
          <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
            🔒 Bata a Meta {num - 1}
          </span>
        </div>
        <div className="pbar-wrap">
          <div className={`pbar-fill ${cor}`} style={{ width: "0%" }} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: num < 3 ? 12 : 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 5,
        }}
      >
        <span style={{ fontSize: ".8rem", fontWeight: 700 }}>
          {icons[num - 1]} Meta Diária {num} — {label}
        </span>
        <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
          {fmtBRL(atual)} / {fmtBRL(alvo)}
        </span>
      </div>
      <div className="pbar-wrap">
        <div className={`pbar-fill ${cor}`} style={{ width: `${pct}%` }} />
        <div
          className="pbar-label"
          style={{
            left: `${clamp(pct, 2, 85)}%`,
            paddingLeft: 5,
          }}
        >
          {pct.toFixed(0)}%
        </div>
      </div>
      <div style={{ marginTop: 4, fontSize: ".82rem" }}>
        {atingida ? (
          <span style={{ color: "var(--green)", fontWeight: 600 }}>
            ✅ Meta atingida!
          </span>
        ) : (
          <span style={{ color: "var(--muted)" }}>
            Faltam{" "}
            <strong style={{ color: "var(--text)" }}>{fmtBRL(falta)}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
