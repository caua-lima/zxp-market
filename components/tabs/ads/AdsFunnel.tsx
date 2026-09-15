"use client";

import { fmtBRL } from "@/lib/domain/calc";
import { num } from "./ads-types";

type Etapa = {
  label: string;
  valor: string;
  taxa?: string; // conversão pra próxima etapa
  tooltip: string;
  indisponivel?: boolean;
};

/**
 * Funil de performance — não é gráfico decorativo, é onde o dinheiro
 * escapa: cada etapa mostra o valor bruto e a taxa de conversão pra próxima,
 * pra ficar óbvio ONDE o funil está vazando (ex.: CTR ok mas conversão em
 * venda péssima = problema de página do anúncio, não de tráfego).
 */
export default function AdsFunnel({
  impressoes, cliques, investimento, vendas, receita, lucroAposAds,
}: {
  impressoes: number; cliques: number; investimento: number; vendas: number; receita: number;
  /** null = não disponível (ex.: nenhuma venda vinculada pra calcular a margem do modo Publicidade direta). */
  lucroAposAds: number | null;
}) {
  const ctr = impressoes > 0 ? (cliques / impressoes) * 100 : null;
  const cpc = cliques > 0 ? investimento / cliques : null;
  const convClique = cliques > 0 ? (vendas / cliques) * 100 : null;

  const etapas: Etapa[] = [
    { label: "Impressões", valor: num(impressoes), tooltip: "Vezes que o anúncio apareceu pro comprador." },
    {
      label: "Cliques", valor: num(cliques),
      taxa: ctr != null ? `CTR ${num(ctr, 2)}%` : undefined,
      tooltip: "CTR = cliques ÷ impressões. Mede se o anúncio (imagem/título/preço) chama atenção de quem viu.",
      indisponivel: impressoes === 0,
    },
    {
      label: "Custo por clique", valor: cpc != null ? fmtBRL(cpc) : "—",
      tooltip: "CPC = investido ÷ cliques. Quanto custou, em média, cada clique no período.",
      indisponivel: cpc == null,
    },
    {
      label: "Vendas", valor: `${num(vendas)} un`,
      taxa: convClique != null ? `${num(convClique, 2)}% dos cliques viraram venda` : undefined,
      tooltip: "Conversão clique → venda. CTR bom com conversão ruim aponta problema na página do anúncio (preço, foto, estoque), não no alcance.",
      indisponivel: cliques === 0,
    },
    { label: "Receita", valor: fmtBRL(receita), tooltip: "Valor total vendido no período (conforme o modo selecionado)." },
    {
      label: "Lucro após Ads", valor: lucroAposAds != null ? fmtBRL(lucroAposAds) : "—",
      tooltip: "Receita menos custo do produto, taxas, frete, imposto e investimento em Ads — o que sobrou de verdade.",
      indisponivel: lucroAposAds == null,
    },
  ];

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Funil de performance</span>
        <span className="panel-sub">onde o resultado está vazando</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
        {etapas.map((e, idx) => (
          <div key={e.label} style={{ display: "flex", alignItems: "center" }}>
            <div
              title={e.tooltip}
              style={{
                minWidth: 120, padding: "10px 14px", borderRadius: 10, cursor: "help",
                background: "var(--surface2)", border: "1px solid var(--border)",
                opacity: e.indisponivel ? 0.55 : 1,
              }}
            >
              <div style={{ fontSize: ".75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>{e.label}</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 800, color: e.indisponivel ? "var(--muted)" : "var(--text)", marginTop: 2 }}>
                {e.indisponivel ? "não disponível" : e.valor}
              </div>
              {e.taxa && !e.indisponivel && (
                <div style={{ fontSize: ".75rem", color: "var(--accent,#5b9bd5)", fontWeight: 600, marginTop: 2 }}>{e.taxa}</div>
              )}
            </div>
            {idx < etapas.length - 1 && (
              <div style={{ padding: "0 8px", color: "var(--muted)", fontSize: "1.1rem" }} aria-hidden>→</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
