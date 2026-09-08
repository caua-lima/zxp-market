"use client";

import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type TooltipItem,
  type Plugin,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { fmtBRL } from "@/lib/domain/calc";
import { MARCA_DOURADO } from "@/lib/marca";

ChartJS.register(ArcElement, Tooltip, Legend);

/** Desenha "total gasto" no vão do meio do donut — sem isso o buraco fica vazio. */
const centerTextPlugin: Plugin<"doughnut"> = {
  id: "centerText",
  afterDraw(chart) {
    const total = (chart.data.datasets[0]?.data as number[] | undefined)?.reduce((s, v) => s + v, 0) ?? 0;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#F7F3E8";
    ctx.font = "700 17px sans-serif";
    ctx.fillText(fmtBRL(total), cx, cy - 8);
    ctx.fillStyle = "#B5B2A6";
    ctx.font = "600 10px sans-serif";
    ctx.fillText("TOTAL DE GASTOS", cx, cy + 12);
    ctx.restore();
  },
};

type Props = {
  produto: number;
  envio?: number;
  taxasML: number;
  imposto?: number;
  ads: number;
  operacional: number;
};

export default function ExpensesDoughnut({ produto, envio = 0, taxasML, imposto = 0, ads, operacional }: Props) {
  const total = produto + envio + taxasML + imposto + ads + operacional;

  if (total === 0) {
    return (
      <div
        style={{
          height: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: ".85rem",
        }}
      >
        Sem gastos registrados.
      </div>
    );
  }

  const data = {
    labels: ["Produto (CMV)", "Frete (envio)", "Taxas ML", "Imposto", "Ads", "Operacional"],
    datasets: [
      {
        data: [produto, envio, taxasML, imposto, ads, operacional],
        // MESMA ordem e MESMAS cores de COST_COLORS em Dashboard.tsx — a
        // barra de composição de custos e este gráfico mostram os mesmos
        // valores, então a cor de cada custo tem que bater nos dois.
        backgroundColor: [
          MARCA_DOURADO, // Produto (CMV)
          "#5B8DEF", // Frete (envio)
          "#C98218", // Taxas ML
          "#B9B5A6", // Imposto
          "#9B6BCE", // Ads
          "#D65A4A", // Operacional
        ],
        borderColor: "#10100E",
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "65%",
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: { color: "#B9B5A6", font: { size: 10 }, padding: 10 },
      },
      tooltip: {
        backgroundColor: "#22221C",
        borderColor: "#3B392A",
        borderWidth: 1,
        titleColor: "#F6F3E8",
        bodyColor: "#B9B5A6",
        callbacks: {
          label: (ctx: TooltipItem<"doughnut">) => {
            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : "0";
            return ` ${ctx.label}: ${pct}%`;
          },
        },
      },
    },
  };

  return (
    <div style={{ height: 220, position: "relative" }}>
      <Doughnut data={data} options={options} plugins={[centerTextPlugin]} />
    </div>
  );
}
