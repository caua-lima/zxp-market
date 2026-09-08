"use client";

import { fmtBRL } from "@/lib/domain/calc";
import { calcularParticipacaoAds, lerParticipacao } from "@/lib/domain/ads-participacao";
import { num } from "./ads-types";

/**
 * "Quanto da minha venda vem da publicidade?" — a pergunta que decide se
 * cortar verba é ajuste fino ou tiro no pé. Fica no topo da aba, acima do
 * detalhamento por anúncio, porque é leitura de negócio, não de campanha.
 */
export default function AdsParticipacao({
  receitaDireta, receitaAtribuida, receitaTotal, investimento,
}: {
  receitaDireta: number;
  receitaAtribuida: number;
  receitaTotal: number;
  investimento: number;
}) {
  const p = calcularParticipacaoAds(receitaDireta, receitaAtribuida, receitaTotal);
  const leitura = lerParticipacao(p.direta);
  // Receita que NÃO passou por anúncio nenhum. Só faz sentido quando a
  // proporção fecha — acima de 100% o "orgânico" viraria negativo, que não
  // existe: é o recorte das duas fontes não batendo, não venda negativa.
  const organica = p.comAssistidas != null && !p.acimaDe100
    ? receitaTotal - Math.max(receitaAtribuida, 0)
    : null;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Quanto da venda vem da publicidade</span>
        <span className="panel-sub">se o Ads parar hoje, é isto que fica em risco</span>
      </div>

      {p.direta == null ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>
          Sem venda registrada no período pra calcular a participação.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, lineHeight: 1, color: leitura.cor }}>
                {num(p.direta, 1)}%
              </div>
              <div style={{ fontSize: ".74rem", color: "var(--muted)", marginTop: 4 }}>
                da receita veio de <b>clique direto</b> no anúncio pago
              </div>
            </div>
            <div style={{ fontSize: ".82rem", color: leitura.cor, fontWeight: 600, paddingBottom: 4 }}>
              {leitura.texto}
            </div>
          </div>

          {/* Barra: direta (sólida) dentro do atribuído (translúcido), sobre o
              total. Deixa visível de relance o peso da venda assistida. */}
          {!p.acimaDe100 && (
            <div style={{ height: 12, borderRadius: 99, background: "var(--surface2)", overflow: "hidden", display: "flex", marginBottom: 10 }}>
              <div title={`Clique direto: ${num(p.direta, 1)}%`} style={{ width: `${Math.min(p.direta, 100)}%`, background: "var(--brand)" }} />
              <div
                title={`Assistida (viu o anúncio, comprou por outro caminho): ${num(Math.max((p.comAssistidas ?? 0) - p.direta, 0), 1)}%`}
                style={{ width: `${Math.min(Math.max((p.comAssistidas ?? 0) - p.direta, 0), 100)}%`, background: "rgba(var(--brand-rgb),.4)" }}
              />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, fontSize: ".82rem" }}>
            <div>
              <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Receita por clique direto</div>
              <div style={{ fontWeight: 700 }}>{fmtBRL(receitaDireta)}</div>
            </div>
            <div>
              <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Atribuída à campanha</div>
              <div style={{ fontWeight: 700 }}>
                {fmtBRL(receitaAtribuida)}
                {p.comAssistidas != null && <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {num(p.comAssistidas, 1)}%</span>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Sem passar por anúncio</div>
              <div style={{ fontWeight: 700, color: organica != null && organica > 0 ? "var(--green)" : "var(--muted)" }}>
                {organica != null ? fmtBRL(organica) : "—"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Investido no período</div>
              <div style={{ fontWeight: 700, color: "var(--red)" }}>{fmtBRL(investimento)}</div>
            </div>
          </div>

          {p.acimaDe100 && (
            <div style={{
              marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".76rem", lineHeight: 1.5,
              background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.35)", color: "var(--warning)",
            }}>
              A venda atribuída ao Ads ficou <b>acima</b> da venda total do período. Não é erro de conta: o
              Mercado Livre credita a venda ao dia do <b>clique</b>, e os pedidos usam o dia da <b>compra</b> —
              num recorte curto os dois não fecham. Use um período maior pra ler esta participação.
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: ".7rem", color: "var(--muted)", lineHeight: 1.5 }}>
            <b>Clique direto</b> = o comprador clicou no anúncio pago e comprou. <b>Atribuída</b> inclui
            também a venda assistida (viu o anúncio e comprou depois por outro caminho) — é o número mais
            generoso, e o que o Mercado Ads usa como mérito da campanha.
          </div>
        </>
      )}
    </div>
  );
}
