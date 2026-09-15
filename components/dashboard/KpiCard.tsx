"use client";

import { fmtBRL } from "@/lib/domain/calc";

type KpiCardProps = {
  label: string;
  value: number;
  isCurrency?: boolean;
  isPercent?: boolean;
  percentValue?: number;
  colorOverride?: "positive" | "negative" | "neutral" | "margin";
};

function marginColor(pct: number): string {
  if (pct >= 20) return "var(--green)";
  if (pct >= 10) return "var(--yellow)";
  return "var(--red)";
}

export default function KpiCard({
  label,
  value,
  isCurrency = false,
  isPercent = false,
  percentValue,
  colorOverride,
}: KpiCardProps) {
  const displayValue = isCurrency
    ? fmtBRL(value)
    : isPercent
    ? `${value.toFixed(1)}%`
    : value.toFixed(2);

  let color = "var(--text)";
  if (colorOverride === "positive") color = "var(--green)";
  else if (colorOverride === "negative") color = "var(--red)";
  else if (colorOverride === "margin") color = marginColor(percentValue ?? value);
  else if (isCurrency || isPercent) {
    color = value > 0 ? "var(--green)" : value < 0 ? "var(--red)" : "var(--muted)";
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "18px 20px",
        position: "relative",
        overflow: "hidden",
        transition: "transform .18s",
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: ".75rem",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: ".06em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          color,
          lineHeight: 1.1,
        }}
      >
        {displayValue}
      </div>
    </div>
  );
}
