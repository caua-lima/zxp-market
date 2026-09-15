"use client";

import { fmtBRL } from "@/lib/domain/calc";
import {
  traduzirStatusIndisponivel,
  unidadesComPerda,
  unidadesEmTransito,
  type LinhaIndisponivel,
} from "@/lib/domain/full-indisponivel";

/**
 * Estoque que está no Full e NÃO pode ser vendido.
 *
 * Existe porque este número não aparecia em lugar nenhum do app: o "Full" das
 * telas é `available_quantity`, que conta só o vendável. Unidade avariada, em
 * transferência ou retida em processo interno sumia dos dois lados — não
 * contava como disponível nem como perda.
 *
 * A separação entre TRÂNSITO e PERDA é o ponto do painel. Trânsito volta a
 * vender sozinho e não é problema; perda é dinheiro que já saiu e só volta se
 * alguém reclamar com o ML. Misturar os dois num total só transformaria um
 * alerta acionável em ruído.
 */

export type EstoqueFullRetido = {
  totalIndisponivel: number;
  porStatus: LinhaIndisponivel[];
  porProduto: {
    inventory: string;
    nome: string;
    productId: string;
    disponivel: number;
    indisponivel: number;
    porStatus: LinhaIndisponivel[];
  }[];
  poolsConsultados: number;
  poolsFalharam: number;
  poolsForaDoTeto: number;
};

export default function EstoqueRetidoFull({
  dados, custoPorProduto,
}: {
  dados?: EstoqueFullRetido | null;
  /** productId → custo médio, pra estimar quanto está imobilizado. */
  custoPorProduto?: Map<string, number>;
}) {
  if (!dados) return null;

  const perda = unidadesComPerda(dados.porStatus);
  const transito = unidadesEmTransito(dados.porStatus);
  const incompleto = dados.poolsFalharam > 0 || dados.poolsForaDoTeto > 0;

  // Nada retido e nada faltando: não vale ocupar espaço na tela.
  if (dados.totalIndisponivel === 0 && !incompleto) return null;

  /** Valor imobilizado só do que é PERDA — é o número que vira reclamação. */
  const valorPerda = dados.porProduto.reduce((s, p) => {
    const custo = custoPorProduto?.get(p.productId) ?? 0;
    return s + unidadesComPerda(p.porStatus) * custo;
  }, 0);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <span className="panel-title">Estoque retido no Full</span>
        <span className="panel-sub">
          unidades que estão no centro de distribuição mas NÃO estão à venda ·
          não aparecem no “Full” das outras telas
        </span>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 10 }}>
        <div className="kpi">
          <div className="k-lbl">Retido no total</div>
          <div className="k-val">{dados.totalIndisponivel} un</div>
        </div>
        <div className="kpi">
          <div className="k-lbl">Volta a vender sozinho</div>
          <div className="k-val" style={{ color: "var(--muted)" }}>{transito} un</div>
          <div className="k-sub">transferência, processo interno, revisão</div>
        </div>
        <div className="kpi">
          <div className="k-lbl">Provável perda</div>
          <div className="k-val" style={{ color: perda > 0 ? "var(--red)" : "var(--muted)" }}>{perda} un</div>
          <div className="k-sub">
            {valorPerda > 0 ? `≈ ${fmtBRL(valorPerda)} ao custo médio` : "avaria, extravio, item não aceito"}
          </div>
        </div>
      </div>

      {dados.porStatus.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {dados.porStatus.map((l) => {
            const t = traduzirStatusIndisponivel(l.status);
            return (
              <div
                key={l.status}
                style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
                  padding: "8px 10px", borderRadius: 8, flexWrap: "wrap",
                  background: "var(--surface-raised,var(--surface2))",
                  borderLeft: `3px solid ${t.perda ? "var(--red)" : "var(--muted)"}`,
                }}
              >
                <span style={{ fontSize: ".84rem", fontWeight: 600 }}>
                  {t.label}
                  <span style={{ display: "block", fontSize: ".75rem", fontWeight: 400, color: "var(--muted)" }}>
                    {t.acao}
                  </span>
                </span>
                <b style={{ whiteSpace: "nowrap", color: t.perda ? "var(--red)" : "var(--text)" }}>{l.qtd} un</b>
              </div>
            );
          })}
        </div>
      )}

      {dados.porProduto.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: ".82rem" }}>
            Ver por produto ({dados.porProduto.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {dados.porProduto.map((p) => (
              <div key={p.inventory} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-raised,var(--surface2))" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".82rem", fontWeight: 600 }}>
                  <span>{p.nome || `Pool ${p.inventory}`}</span>
                  <span style={{ whiteSpace: "nowrap" }}>{p.indisponivel} un retida(s)</span>
                </div>
                <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 2 }}>
                  {p.disponivel} un à venda ·{" "}
                  {p.porStatus.map((s) => `${traduzirStatusIndisponivel(s.status).label}: ${s.qtd}`).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Cobertura parcial precisa aparecer: sem isto, "0 retido" seria
          indistinguível de "não consegui perguntar ao ML". */}
      {incompleto && (
        <div style={{ marginTop: 10, fontSize: ".75rem", color: "var(--warning)", lineHeight: 1.5 }}>
          Leitura parcial: {dados.poolsConsultados} pool(s) consultado(s)
          {dados.poolsFalharam > 0 && `, ${dados.poolsFalharam} não respondeu(ram)`}
          {dados.poolsForaDoTeto > 0 && `, ${dados.poolsForaDoTeto} fora do teto de consultas`}.
          O total acima é o mínimo — pode haver mais estoque retido.
        </div>
      )}
    </div>
  );
}
