"use client";

import type { ProdutoEmRisco } from "@/lib/domain/risk";
import { fmtPct } from "@/lib/domain/calc";

export default function ProdutosEmRisco({ produtos, onVerEstoque }: { produtos: ProdutoEmRisco[]; onVerEstoque?: () => void }) {
  if (produtos.length === 0) {
    return (
      <div className="panel" style={{ color: "var(--text-secondary,var(--muted))", fontSize: ".85rem", textAlign: "center", padding: "18px 12px" }}>
        Nenhum produto ativo com estoque baixo ou margem abaixo da meta agora.
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-title" style={{ marginBottom: 12 }}>Produtos em risco</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {produtos.slice(0, 8).map((p) => (
          <div key={p.produtoId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "var(--surface-raised,var(--surface2))", borderRadius: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: ".85rem", color: "var(--text-primary,var(--text))", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 160px" }}>
              {p.nome}
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {p.motivos.includes("estoque-baixo") && (
                <span className="severity-chip severity-warning">
                  {p.coberturaDias != null ? `cobertura ${p.coberturaDias.toFixed(0)}d` : `${p.qtdLocal} un. em estoque`}
                </span>
              )}
              {p.motivos.includes("margem-baixa") && p.margem != null && (
                <span className="severity-chip severity-critical">margem {fmtPct(p.margem, 1)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {onVerEstoque && (
        <button type="button" className="ac-cta" style={{ marginTop: 10 }} onClick={onVerEstoque}>Ver Estoque →</button>
      )}
    </div>
  );
}
