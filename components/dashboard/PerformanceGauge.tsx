"use client";

import InfoDica from "@/components/InfoDica";
import { useEffect, useId, useState } from "react";
import { clampGaugePercent, formatarPercentualDaMeta, rawGoalPercent, type GaugeTone } from "@/lib/domain/gauge";

export type PerformanceGaugeProps = {
  title: string;
  eyebrow?: string;
  value: number;
  max: number;
  valueLabel: string;
  minLabel?: string;
  maxLabel?: string;
  target?: number;
  targetLabel?: string;
  status?: GaugeTone;
  comparison?: { label: string; value: string; tone: GaugeTone };
  helperText?: string;
  insight?: string;
  tooltip?: string;
  showNeedle?: boolean;
  compact?: boolean;
  /** Estado de carregamento — mostra skeleton no lugar do arco/textos. */
  loading?: boolean;
  /** Quando não há dado suficiente pra desenhar o arco de verdade. */
  emptyReason?: "no-data" | "no-goal" | "error";
  onRetry?: () => void;
  ctaLabel?: string;
  onClick?: () => void;
  className?: string;
};

const TONE_VAR: Record<GaugeTone, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  neutral: "var(--brand)",
};

const TONE_ICON: Record<GaugeTone, string> = {
  success: "✓",
  warning: "!",
  danger: "▾",
  neutral: "●",
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

// Semicírculo: 180 (esquerda) → 0 (direita), passando por cima. cx=100 cy=94 r=76.
const CX = 100, CY = 94, R = 76;
function pointOnArc(pct: number) {
  const angle = 180 - (pct / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY - R * Math.sin(rad) };
}
function arcPath(fromPct: number, toPct: number) {
  const a = pointOnArc(fromPct);
  const b = pointOnArc(toPct);
  // Flag "arco maior" do SVG é sobre GRAUS (>180°), não sobre a escala 0-100
  // daqui — nosso range inteiro (0 a 100%) já é só 180° de varredura, então
  // nenhum trecho dele passa de 180° e a flag é sempre 0 (arco menor/curto).
  // Com `toPct - fromPct > 50` (comparando pontos percentuais com o limiar
  // errado de graus) o SVG desenhava o arco pelo lado LONGO sempre que o
  // progresso passava de 50%, e o traço saía bem maior que a barrinha real
  // — por isso um trecho "flutuava" separado do marcador do valor.
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Ponto de corte entre faixas de status — vira uma marca (tick) na trilha, não um arco colorido cheio. */
const REVENUE_TICKS = [59, 89];
const MARGIN_TICKS = [70, 99];

function tickLine(pct: number) {
  const angle = 180 - (pct / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad), dy = -Math.sin(rad);
  return {
    x1: (CX + (R - 8) * dx).toFixed(2), y1: (CY + (R - 8) * dy).toFixed(2),
    x2: (CX + (R + 8) * dx).toFixed(2), y2: (CY + (R + 8) * dy).toFixed(2),
  };
}

export default function PerformanceGauge({
  title, eyebrow, value, max, valueLabel, minLabel = "0", maxLabel,
  target, targetLabel, status, comparison, helperText, insight, tooltip,
  showNeedle = true, compact = false, loading = false, emptyReason, onRetry,
  ctaLabel, onClick, className,
}: PerformanceGaugeProps) {
  const titleId = useId();
  const descId = useId();
  const reducedMotion = usePrefersReducedMotion();

  const clamped = clampGaugePercent(value, max);
  const raw = rawGoalPercent(value, max);
  const tone: GaugeTone = status ?? "neutral";
  const toneVar = TONE_VAR[tone];
  const needleTip = pointOnArc(clamped);
  const markerPos = pointOnArc(clamped);
  const ticks = title.toLowerCase().includes("margem") ? MARGIN_TICKS : REVENUE_TICKS;

  const percentText = formatarPercentualDaMeta(raw);
  const a11ySummary = `${title}: ${valueLabel}${target != null ? `, meta ${targetLabel ?? target}` : ""}. ${percentText} da meta. ${helperText ?? ""}`.trim();

  const interactive = typeof onClick === "function";
  const Wrapper = interactive ? "button" : "div";

  return (
    <div className={`pg-card ${compact ? "pg-compact" : ""} ${className ?? ""}`}>
      <div className="pg-head">
        <span className="pg-eyebrow">{eyebrow ?? title}</span>
        {tooltip && (
          <InfoDica id={descId}>{tooltip}</InfoDica>
        )}
      </div>

      <Wrapper
        type={interactive ? "button" : undefined}
        onClick={onClick}
        className={`pg-body ${interactive ? "pg-clickable" : ""}`}
      >
        {loading ? (
          <div className="pg-skeleton" aria-hidden="true">
            <div className="pg-skeleton-arc" />
            <div className="pg-skeleton-line pg-skeleton-line--lg" />
            <div className="pg-skeleton-line" />
          </div>
        ) : emptyReason ? (
          <div className="pg-empty">
            <div className="pg-empty-icon" aria-hidden="true">○</div>
            {emptyReason === "no-goal" && <p>Defina uma meta para acompanhar seu ritmo.</p>}
            {emptyReason === "no-data" && <p>Aguardando dados para calcular a meta.</p>}
            {emptyReason === "error" && <p>Não foi possível atualizar a meta.</p>}
            {emptyReason === "error" && onRetry && (
              <button type="button" className="pg-cta" onClick={onRetry}>Tentar novamente</button>
            )}
            {emptyReason === "no-goal" && ctaLabel && (
              <span className="pg-cta">{ctaLabel}</span>
            )}
          </div>
        ) : (
          <>
            <svg
              viewBox="0 0 200 116"
              className="pg-svg"
              role="img"
              aria-labelledby={titleId}
            >
              <title id={titleId}>{a11ySummary}</title>
              {/* trilha base */}
              <path d={arcPath(0, 100)} fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
              {/* progresso real — cor única do status atual */}
              <path
                d={arcPath(0, clamped)}
                fill="none"
                stroke={toneVar}
                strokeWidth="10"
                strokeLinecap="round"
                style={{ transition: reducedMotion ? "none" : "d 600ms cubic-bezier(.4,0,.2,1), stroke 300ms ease" }}
              />
              {/* marcas discretas nos limites de faixa — só no gauge detalhado;
                  no compact o raio é menor e a marca de ~90% quase encosta no
                  marcador do valor atual, duplicando visualmente o mesmo ponto */}
              {!compact && ticks.map((t) => {
                const { x1, y1, x2, y2 } = tickLine(t);
                return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />;
              })}
              {/* marcador de meta (alvo intermediário, se houver) */}
              {target != null && max > 0 && target !== max && (() => {
                const tp = pointOnArc(clampGaugePercent(target, max));
                return <circle cx={tp.x} cy={tp.y} r="3.2" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2" />;
              })()}
              {/* ponteiro */}
              {showNeedle && !compact && (
                <g aria-hidden="true" style={{ transition: reducedMotion ? "none" : "transform 600ms cubic-bezier(.4,0,.2,1)" }}>
                  <line x1={CX} y1={CY} x2={needleTip.x.toFixed(2)} y2={needleTip.y.toFixed(2)} stroke="var(--text-primary)" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx={CX} cy={CY} r="6" fill="var(--surface)" stroke={toneVar} strokeWidth="2" />
                  <circle cx={CX} cy={CY} r="2" fill="var(--text-primary)" />
                </g>
              )}
              {compact && (
                <circle cx={markerPos.x} cy={markerPos.y} r="4" fill={toneVar} stroke="var(--surface)" strokeWidth="1.5" aria-hidden="true" />
              )}
            </svg>

            <p id={descId + "-sr"} className="pg-sr-only">{a11ySummary}</p>

            <div className="pg-center">
              <div className="pg-percent" style={{ color: toneVar }}>{percentText}</div>
              <div className="pg-value money">
                <span className="pg-value-current">{valueLabel}</span>
              </div>
              <div className="pg-status-pill" style={{ color: toneVar, background: `color-mix(in srgb, ${toneVar} 14%, transparent)` }}>
                <span aria-hidden="true">{TONE_ICON[tone]}</span>
                <span>{helperText}</span>
              </div>
              {insight && !compact && <div className="pg-insight">{insight}</div>}
              {ctaLabel && onClick && !compact && (
                <span className="pg-cta" aria-hidden="true">{ctaLabel} →</span>
              )}
            </div>

            {(minLabel || maxLabel) && !compact && (
              <div className="pg-scale">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
              </div>
            )}

            {comparison && !compact && (
              <div className="pg-comparison" style={{ color: TONE_VAR[comparison.tone] }}>
                {comparison.label}: {comparison.value}
              </div>
            )}
          </>
        )}
      </Wrapper>
    </div>
  );
}
