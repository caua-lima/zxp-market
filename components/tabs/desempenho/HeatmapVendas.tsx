"use client";

import type { ResultadoHeatmap } from "@/lib/domain/sales-heatmap";

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // começa na segunda, como o resto do app

function diasDoPeriodo(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function intensidade(v: number, max: number): { cor: string; tamanho: number } {
  if (v === 0 || max === 0) return { cor: "var(--surface2)", tamanho: 6 };
  const r = v / max;
  const cor = r >= 0.66 ? "var(--accent)" : r >= 0.33 ? "rgba(155,107,206,.55)" : "rgba(155,107,206,.28)";
  const tamanho = 6 + r * 10;
  return { cor, tamanho };
}

export default function HeatmapVendas({ heatmap, from, to }: { heatmap: ResultadoHeatmap; from: string; to: string }) {
  if (heatmap.totalVendas === 0) {
    return (
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 6 }}>Concentração de vendas por dia e horário</div>
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Sem vendas no período pra montar o mapa.</div>
      </div>
    );
  }

  const dias = diasDoPeriodo(from, to);
  const maxCelula = Math.max(...heatmap.grid.flat());
  const mediaDiaria = heatmap.totalVendas / dias;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Concentração de vendas por dia e horário</span>
        <span className="panel-sub">{dias} dia(s) no período — cada célula é a soma de vendas naquele dia/hora</span>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14, fontSize: ".8rem" }}>
        <div><span style={{ color: "var(--muted)" }}>Vendas totais: </span><b>{heatmap.totalVendas}</b></div>
        <div><span style={{ color: "var(--muted)" }}>Média diária: </span><b>{mediaDiaria.toFixed(1)}</b></div>
        {heatmap.diaMaisForte != null && (
          <div><span style={{ color: "var(--muted)" }}>Dia mais forte: </span><b style={{ color: "var(--accent)" }}>{DIAS_SEMANA[heatmap.diaMaisForte]}</b></div>
        )}
        {heatmap.horaMaisForte != null && (
          <div><span style={{ color: "var(--muted)" }}>Horário mais forte: </span><b style={{ color: "var(--accent)" }}>{String(heatmap.horaMaisForte).padStart(2, "0")}h</b></div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead>
            <tr>
              <th></th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 400, padding: "0 2px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ORDEM_DIAS.map((wd) => (
              <tr key={wd}>
                <td style={{ fontSize: ".75rem", color: "var(--muted)", paddingRight: 8, whiteSpace: "nowrap", textAlign: "right" }}>{DIAS_SEMANA[wd].slice(0, 3)}</td>
                {heatmap.grid[wd].map((v, h) => {
                  const { cor, tamanho } = intensidade(v, maxCelula);
                  return (
                    <td key={h} style={{ padding: 3, textAlign: "center" }} title={`${DIAS_SEMANA[wd]} ${h}h — ${v} venda(s)`}>
                      <div style={{ width: tamanho, height: tamanho, borderRadius: "50%", background: cor, margin: "0 auto" }} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
