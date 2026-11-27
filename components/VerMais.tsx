import type { ReactNode } from "react";

/**
 * Painel que começa FECHADO, com "ver mais" (pedido do dono, 27/11/2026: o
 * Dashboard e o Estoque tinham painel demais aberto). É um <details>: abre e
 * fecha sem estado nem JavaScript.
 *
 * Fechado, é uma barra com o título. Aberto, a moldura de fora SOME e fica só o
 * painel original (que já tem título próprio), com um "ocultar" pequeno em cima
 * — sem título repetido nem painel dentro de painel. Estilos em globals.css.
 */
export default function VerMais({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return (
    <details className="ver-mais">
      <summary className="ver-mais-barra">
        <span className="ver-mais-fechado">
          <span className="panel-title">{titulo}</span>
          {sub && <span className="panel-sub">{sub}</span>}
          <span className="panel-sub ver-mais-acao">ver mais ▾</span>
        </span>
        <span className="ver-mais-aberto panel-sub">▴ ocultar {titulo.toLowerCase()}</span>
      </summary>
      <div className="ver-mais-corpo">{children}</div>
    </details>
  );
}
