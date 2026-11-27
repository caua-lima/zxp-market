import type { ReactNode } from "react";

/**
 * Painel que começa FECHADO, com "ver mais" (pedido do dono, 27/11/2026: o
 * Dashboard e o Estoque tinham painel demais aberto). É um <details>: abre e
 * fecha sem estado nem JavaScript, e o conteúdo só monta a leitura de quem abre.
 */
export default function VerMais({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return (
    <details className="panel ver-mais">
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", listStyle: "revert" }}>
        <span className="panel-title">{titulo}</span>
        {sub && <span className="panel-sub">{sub}</span>}
        <span className="panel-sub" style={{ marginLeft: "auto" }}>ver mais</span>
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}
