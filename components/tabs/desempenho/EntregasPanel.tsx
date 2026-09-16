"use client";

import type { ResultadoEntregas } from "@/lib/domain/shipping-performance";
import { fmtPct } from "@/lib/domain/calc";

export default function EntregasPanel({ entregas }: { entregas: ResultadoEntregas }) {
  const cor = (p: number) => (p >= 90 ? "var(--green)" : p >= 75 ? "var(--yellow)" : "var(--red)");

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <span className="panel-title">Entregas no prazo</span>
        <span className="panel-sub">estimativa própria, não é o índice oficial do Mercado Livre</span>
      </div>

      {entregas.percentual == null ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>
          Sem pedidos com data de entrega confirmada e prazo estimado no período pra calcular.
        </div>
      ) : (
        <>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: cor(entregas.percentual) }}>
            {fmtPct(entregas.percentual, 1)}
          </div>
          <div style={{ fontSize: ".82rem", color: "var(--muted)", marginTop: 4 }}>
            {entregas.noPrazo} de {entregas.comDados} pedido(s) entregues até a data estimada pelo Mercado Livre
          </div>
        </>
      )}

      <div style={{ marginTop: 10, fontSize: ".75rem", color: "var(--muted)", lineHeight: 1.5 }}>
        O painel &quot;Desempenho em envios&quot; do Mercado Livre (exposição, restrição de catálogo) usa uma
        fórmula própria que a API não expõe — o número acima é só a comparação entre a data de entrega estimada
        e a data em que o pedido foi realmente entregue, nos pedidos já sincronizados.
      </div>
    </div>
  );
}
