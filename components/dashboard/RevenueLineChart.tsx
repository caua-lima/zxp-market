"use client";

import { useMemo, useState } from "react";
import { MARCA_DOURADO, MARCA_DOURADO_SUAVE } from "@/lib/marca";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type TooltipItem,
  type ChartEvent,
  type ActiveElement,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { formatDateBR, fmtBRL } from "@/lib/domain/calc";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

export type SerieDia = { data: string; faturamento: number };

type Props = {
  serie: SerieDia[];
  loading?: boolean;
  /** Chamado quando o usuário clica num ponto do gráfico — abre o detalhamento daquele dia. */
  onSelectDay?: (dateISO: string) => void;
};

const AXIS_COLOR = "#B5B2A6";
const GRID_COLOR = "#393A2D";

/**
 * Faturamento líquido por dia do período selecionado — a única série diária
 * que a API de métricas expõe hoje (lucro/ADS só existem agregados pro
 * período inteiro, não quebrados por dia). Lucro e ADS como séries diárias
 * ficam pra quando isso for exposto no backend; não fabrico esse dado aqui.
 */
export default function RevenueLineChart({ serie, loading, onSelectDay }: Props) {
  const [modo, setModo] = useState<"diario" | "acumulado">("diario");

  const sorted = useMemo(() => [...serie].sort((a, b) => (a.data < b.data ? -1 : 1)), [serie]);

  const valores = useMemo(() => {
    if (modo === "diario") return sorted.map((d) => d.faturamento);
    let acc = 0;
    return sorted.map((d) => (acc += d.faturamento));
  }, [sorted, modo]);

  const labels = sorted.map((d) => formatDateBR(d.data));

  const data = {
    labels,
    datasets: [
      {
        label: modo === "diario" ? "Faturamento líquido do dia" : "Faturamento líquido acumulado",
        data: valores,
        borderColor: MARCA_DOURADO,
        backgroundColor: MARCA_DOURADO_SUAVE,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: MARCA_DOURADO,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    onClick: (_evt: ChartEvent, elements: ActiveElement[]) => {
      if (!onSelectDay || !elements.length) return;
      const idx = elements[0].index;
      const dia = sorted[idx]?.data;
      if (dia) onSelectDay(dia);
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#24251D",
        borderColor: "#393A2D",
        borderWidth: 1,
        titleColor: "#F7F3E8",
        bodyColor: "#B5B2A6",
        padding: 10,
        callbacks: {
          label: (ctx: TooltipItem<"line">) => ` ${ctx.dataset.label}: ${fmtBRL((ctx.parsed.y as number | null) ?? 0)}`,
          afterLabel: () => (onSelectDay ? "Clique no ponto para ver o dia" : ""),
        },
      },
    },
    scales: {
      x: { ticks: { color: AXIS_COLOR, font: { size: 10 } }, grid: { color: GRID_COLOR } },
      y: {
        ticks: {
          color: AXIS_COLOR, font: { size: 10 },
          callback: (v: number | string) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}`,
        },
        grid: { color: GRID_COLOR },
      },
    },
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <div className="seg" style={{ alignSelf: "flex-end" }}>
          <button type="button" className={`seg-btn ${modo === "diario" ? "active" : ""}`} onClick={() => setModo("diario")}>Diário</button>
          <button type="button" className={`seg-btn ${modo === "acumulado" ? "active" : ""}`} onClick={() => setModo("acumulado")}>Acumulado</button>
        </div>
      </div>

      {loading ? (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: ".85rem" }}>
          Carregando série do período…
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: ".85rem" }}>
          Sem vendas no período selecionado.
        </div>
      ) : (
        <div style={{ height: 260, position: "relative" }}>
          <Line data={data} options={options} />
        </div>
      )}
    </div>
  );
}
