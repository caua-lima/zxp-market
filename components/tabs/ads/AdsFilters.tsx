"use client";

import type { Modo, StatusAnuncio } from "./ads-types";

export type FiltrosAdsState = {
  busca: string; setBusca: (v: string) => void;
  statusFiltro: StatusAnuncio | ""; setStatusFiltro: (v: StatusAnuncio | "") => void;
  lucroFiltro: "" | "lucro" | "prejuizo"; setLucroFiltro: (v: "" | "lucro" | "prejuizo") => void;
  roasMin: string; setRoasMin: (v: string) => void;
  roasMax: string; setRoasMax: (v: string) => void;
  acosMin: string; setAcosMin: (v: string) => void;
  acosMax: string; setAcosMax: (v: string) => void;
  investMin: string; setInvestMin: (v: string) => void;
  investMax: string; setInvestMax: (v: string) => void;
};

/** Contadores por status pra virar botão de filtro rápido, igual já existia. */
export function AdsStatusQuickFilters({
  items, statusFiltro, setStatusFiltro, lucroFiltro, setLucroFiltro,
}: {
  items: { status: StatusAnuncio }[];
  statusFiltro: StatusAnuncio | ""; setStatusFiltro: (v: StatusAnuncio | "") => void;
  lucroFiltro: "" | "lucro" | "prejuizo"; setLucroFiltro: (v: "" | "lucro" | "prejuizo") => void;
}) {
  const STATUS_META_LOCAL: Record<StatusAnuncio, { label: string; cor: string; bg: string }> = {
    ativo: { label: "Ativa", cor: "var(--green)", bg: "rgba(54,179,126,.12)" },
    pausado: { label: "Pausada", cor: "var(--warning)", bg: "var(--warning-soft)" },
    sem_campanha: { label: "Sem campanha", cor: "var(--muted)", bg: "rgba(185,181,166,.14)" },
    config_indisponivel: { label: "Campanha ?", cor: "var(--warning)", bg: "var(--warning-soft)" },
  };
  if (items.length === 0) return null;
  return (
    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {(["ativo", "pausado", "config_indisponivel", "sem_campanha"] as const).map((s) => {
        const n = items.filter((i) => i.status === s).length;
        if (!n) return null;
        const m = STATUS_META_LOCAL[s];
        const ativo = statusFiltro === s;
        return (
          <button
            key={s} type="button" title={`Filtrar: só ${m.label.toLowerCase()}`}
            onClick={() => setStatusFiltro(ativo ? "" : s)}
            style={{
              fontSize: ".75rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "1px 7px",
              borderRadius: 5, border: ativo ? `1px solid ${m.cor}` : "1px solid transparent", cursor: "pointer",
            }}
          >
            {n} {m.label.toLowerCase()}
          </button>
        );
      })}
      {(["lucro", "prejuizo"] as const).map((f) => {
        const ativo = lucroFiltro === f;
        const cor = f === "lucro" ? "var(--success,var(--green))" : "var(--danger,var(--red))";
        return (
          <button
            key={f} type="button" onClick={() => setLucroFiltro(ativo ? "" : f)}
            style={{
              fontSize: ".75rem", fontWeight: 700, color: cor, background: "transparent", padding: "1px 7px",
              borderRadius: 5, border: `1px solid ${ativo ? cor : "var(--border)"}`, cursor: "pointer",
            }}
          >
            {f === "lucro" ? "lucrativos" : "prejuízo"}
          </button>
        );
      })}
      {(statusFiltro || lucroFiltro) && (
        <button type="button" onClick={() => { setStatusFiltro(""); setLucroFiltro(""); }} style={{ fontSize: ".75rem", color: "var(--muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
          limpar filtro
        </button>
      )}
    </span>
  );
}

export default function AdsFilters({ modo, f }: { modo: Modo; f: FiltrosAdsState }) {
  const inputStyle = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: ".82rem", outline: "none" };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <input
        type="text" placeholder="Buscar produto…" value={f.busca} onChange={(e) => f.setBusca(e.target.value)}
        style={{ ...inputStyle, minWidth: 160, padding: "5px 10px" }}
      />
      <span style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 600 }}>ROAS:</span>
      <input type="number" inputMode="decimal" placeholder="mín." value={f.roasMin} onChange={(e) => f.setRoasMin(e.target.value)} style={{ ...inputStyle, width: 64 }} />
      <span style={{ color: "var(--muted)" }}>–</span>
      <input type="number" inputMode="decimal" placeholder="máx." value={f.roasMax} onChange={(e) => f.setRoasMax(e.target.value)} style={{ ...inputStyle, width: 64 }} />

      <span style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 600, marginLeft: 6 }}>{modo === "pub" ? "ACOS" : "TACOS"} %:</span>
      <input type="number" inputMode="decimal" placeholder="mín." value={f.acosMin} onChange={(e) => f.setAcosMin(e.target.value)} style={{ ...inputStyle, width: 64 }} />
      <span style={{ color: "var(--muted)" }}>–</span>
      <input type="number" inputMode="decimal" placeholder="máx." value={f.acosMax} onChange={(e) => f.setAcosMax(e.target.value)} style={{ ...inputStyle, width: 64 }} />

      <span style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 600, marginLeft: 6 }}>Investido R$:</span>
      <input type="number" inputMode="decimal" placeholder="mín." value={f.investMin} onChange={(e) => f.setInvestMin(e.target.value)} style={{ ...inputStyle, width: 74 }} />
      <span style={{ color: "var(--muted)" }}>–</span>
      <input type="number" inputMode="decimal" placeholder="máx." value={f.investMax} onChange={(e) => f.setInvestMax(e.target.value)} style={{ ...inputStyle, width: 74 }} />

      {(f.roasMin || f.roasMax || f.acosMin || f.acosMax || f.investMin || f.investMax) && (
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => { f.setRoasMin(""); f.setRoasMax(""); f.setAcosMin(""); f.setAcosMax(""); f.setInvestMin(""); f.setInvestMax(""); }}>
          Limpar faixas
        </button>
      )}
    </div>
  );
}
