"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { fmtBRL } from "@/lib/domain/calc";
import { agregarPorCampanha, type CampanhaAgregada, type ItemParaCampanha, type MetricasReais } from "@/lib/domain/ads-campaigns";
import { corMargem, corRoas, num, type Modo } from "./ads-types";
import AdsFunnel from "./AdsFunnel";

/**
 * Performance POR CAMPANHA. O funil do topo soma tudo, o que esconde o caso
 * mais comum: uma campanha saudável carregando outra que sangra. Aqui cada
 * campanha tem seu próprio "Ver performance", que abre o mesmo funil aplicado
 * só a ela — mesmas fórmulas, mesmo componente, só o recorte muda.
 */
export default function AdsCampaignList({ itens, modo, metricasReais }: {
  itens: ItemParaCampanha[];
  modo: Modo;
  /**
   * Métricas que o ML devolve pra própria campanha. Mandam sobre a soma dos
   * anúncios — ver agregarPorCampanha. Sem elas a tela continua funcionando,
   * só volta a derivar (e a divergir do painel quando um anúncio roda em
   * mais de uma campanha).
   */
  metricasReais?: Map<string, MetricasReais>;
}) {
  // "log" (logística) não tem recorte próprio de campanha — cai no geral.
  const modoAgg: "pub" | "geral" = modo === "pub" ? "pub" : "geral";
  const campanhas = useMemo(
    () => agregarPorCampanha(itens, modoAgg, metricasReais),
    [itens, modoAgg, metricasReais],
  );
  const [aberta, setAberta] = useState<CampanhaAgregada | null>(null);

  if (campanhas.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <span className="panel-title">Performance por campanha</span>
        <span className="panel-sub">{campanhas.length} campanha(s) · maior investimento primeiro</span>
      </div>

      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Campanha</th>
              {/* Orçamento e ROAS objetivo são o que se ajusta no painel do ML —
                  tê-los aqui é o que permite decidir e agir sem trocar de tela. */}
              <th title="Orçamento diário configurado na campanha.">Orçamento</th>
              <th title="ROAS objetivo que você configurou na campanha, no painel do Mercado Ads.">ROAS obj.</th>
              <th>Investido</th>
              <th>Receita</th>
              <th>ROAS</th>
              <th>Lucro após Ads</th>
              <th title="Lucro após Ads ÷ receita da campanha. Comparar campanhas pelo valor absoluto escala a errada: R$ 373 sobre R$ 2.369 é 15,8%, e R$ 125 sobre R$ 992 é 12,7%.">Margem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {campanhas.map((c) => (
              <tr key={c.campaignId}>
                <td style={{ textAlign: "left", fontWeight: 600 }}>
                  {c.campaignName}
                  <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", fontWeight: 400 }}>
                    {c.anuncios} anúncio(s) · {num(c.clicks)} cliques
                    {c.atribuicaoIncerta && (
                      <span title={
                        "Algum anúncio desta campanha roda também em outra, e o Mercado Livre entrega as métricas dele já somadas, "
                        + "sem dizer quanto foi de cada campanha. Investimento, cliques e impressões acima são os da CAMPANHA "
                        + "(batem com o painel do ML). O lucro fica indisponível porque dependeria de repartir as suas vendas "
                        + "entre as campanhas, e esse dado o ML não fornece."
                      } style={{ marginLeft: 6, cursor: "help" }}>⚠</span>
                    )}
                  </span>
                </td>
                <td data-label="Orçamento" style={{ whiteSpace: "nowrap", color: c.dailyBudget > 0 ? "var(--text)" : "var(--muted)" }}>
                  {c.dailyBudget > 0 ? `${fmtBRL(c.dailyBudget)}/dia` : "—"}
                </td>
                <td data-label="ROAS obj." style={{ whiteSpace: "nowrap", fontWeight: 600, color: c.roasTarget > 0 ? "var(--text)" : "var(--muted)" }}>
                  {c.roasTarget > 0 ? `${num(c.roasTarget, 2)}x` : "—"}
                </td>
                <td data-label="Investido" style={{ color: "var(--red)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(c.cost)}</td>
                <td data-label="Receita" style={{ color: "var(--green)", whiteSpace: "nowrap" }}>{fmtBRL(c.receita)}</td>
                {/* Dois ROAS de propósito: o do modo escolhido e o do painel do
                    Mercado Ads (receita atribuída total). Sem o segundo, o
                    número daqui parece quebrado ao lado do ML — foi o que gerou
                    "o ROAS está errado" (4,71x aqui × 10,77x lá, mesma campanha). */}
                <td data-label="ROAS" style={{ fontWeight: 700, whiteSpace: "nowrap", color: c.roas != null ? corRoas(c.roas) : "var(--muted)" }}>
                  {c.roas != null ? `${num(c.roas, 2)}x` : "—"}
                  {c.roasMlAds != null && c.roas != null && Math.abs(c.roasMlAds - c.roas) > 0.01 && (
                    <span
                      style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "var(--muted)" }}
                      title={`No Mercado Ads esta campanha aparece com ROAS ${num(c.roasMlAds, 2)}x, porque lá a conta usa a receita atribuída TOTAL (${fmtBRL(c.receitaAtribuida)}: clique direto + venda assistida). Aqui a base é ${fmtBRL(c.receita)}. Os dois estão certos e respondem perguntas diferentes.`}
                    >
                      ML: {num(c.roasMlAds, 2)}x
                    </span>
                  )}
                </td>
                <td
                  data-label="Lucro após Ads"
                  /* Sem numero, entra o MOTIVO: traco mudo nao diz se falta
                     cadastrar custo, esperar venda ou revisar a campanha. */
                  title={c.motivoSemLucro ?? undefined}
                  style={{
                    fontWeight: 700, whiteSpace: "nowrap",
                    color: c.lucroAposAds == null ? "var(--muted)" : c.lucroAposAds >= 0 ? "var(--green)" : "var(--red)",
                  }}
                >
                  {c.lucroAposAds != null ? fmtBRL(c.lucroAposAds) : (
                    <span style={{ fontWeight: 400, fontSize: ".7rem", whiteSpace: "normal", display: "inline-block", maxWidth: 190 }}>
                      {c.motivoSemLucro ?? "—"}
                    </span>
                  )}
                </td>
                <td
                  data-label="Margem"
                  style={{
                    fontWeight: 700, whiteSpace: "nowrap",
                    color: c.margem == null ? "var(--muted)" : corMargem(c.margem),
                  }}
                >
                  {c.margem != null ? `${num(c.margem, 1)}%` : (
                    <span title={c.motivoSemLucro ?? undefined} style={{ fontWeight: 400 }}>—</span>
                  )}
                </td>
                <td data-cell="acoes" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAberta(c)}>
                    Ver performance
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aberta && (
        <Modal open onClose={() => setAberta(null)} wide>
          <div className="modal-title">{aberta.campaignName}</div>
          <div className="modal-sub">
            funil desta campanha · {aberta.anuncios} anúncio(s) ·{" "}
            {aberta.acos != null ? `ACOS ${num(aberta.acos, 1)}%` : "ACOS indisponível"}
          </div>
          <AdsFunnel
            impressoes={aberta.prints}
            cliques={aberta.clicks}
            investimento={aberta.cost}
            vendas={aberta.unidades}
            receita={aberta.receita}
            lucroAposAds={aberta.lucroAposAds}
          />
          <div className="modal-btns">
            <button type="button" className="btn btn-ghost" onClick={() => setAberta(null)}>Fechar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
