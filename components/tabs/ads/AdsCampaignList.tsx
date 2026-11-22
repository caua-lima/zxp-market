"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { fmtBRL } from "@/lib/domain/calc";
import { agregarPorCampanha, rotuloCampanha, type CampanhaAgregada, type ItemParaCampanha, type MetricasReais } from "@/lib/domain/ads-campaigns";
import type { Consolidacao } from "@/lib/domain/ads-consolidacao";
import { corMargem, corRoas, num, type Modo } from "./ads-types";
import AdsFunnel from "./AdsFunnel";
import t from "./AdsTable.module.css";

/**
 * Performance POR CAMPANHA. O funil do topo soma tudo, o que esconde o caso
 * mais comum: uma campanha saudável carregando outra que sangra. Aqui cada
 * campanha tem seu próprio "Ver performance", que abre o mesmo funil aplicado
 * só a ela — mesmas fórmulas, mesmo componente, só o recorte muda.
 */
export default function AdsCampaignList({ itens, modo, metricasReais, consolidacao }: {
  itens: ItemParaCampanha[];
  modo: Modo;
  /**
   * Métricas que o ML devolve pra própria campanha. Mandam sobre a soma dos
   * anúncios — ver agregarPorCampanha. Sem elas a tela continua funcionando,
   * só volta a derivar (e a divergir do painel quando um anúncio roda em
   * mais de uma campanha).
   */
  metricasReais?: Map<string, MetricasReais>;
  /**
   * O ML ainda não consolidou ONTEM no recurso de campanha. Sem isto a tela
   * comparava uma fonte sem ontem com outra com ontem e acendia "rateado" em
   * quase toda campanha (ver lib/domain/ads-consolidacao.ts).
   */
  consolidacao?: Consolidacao | null;
}) {
  // "log" (logística) não tem recorte próprio de campanha — cai no geral.
  const modoAgg: "pub" | "geral" = modo === "pub" ? "pub" : "geral";
  const defasadas = !!consolidacao?.pendente;
  const campanhas = useMemo(
    () => agregarPorCampanha(itens, modoAgg, metricasReais, { campanhasDefasadas: defasadas }),
    [itens, modoAgg, metricasReais, defasadas],
  );
  const [aberta, setAberta] = useState<CampanhaAgregada | null>(null);

  if (campanhas.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <span className="panel-title">Performance por campanha</span>
        <span className="panel-sub">
          {campanhas.length} campanha(s) · maior investimento primeiro
          {/* A legenda evita que o "≈" vire um simbolo misterioso: aparece so
              quando ha ao menos uma linha rateada, e explica na hora. */}
          {campanhas.some((c) => c.lucroAproximado) && (
            <span title={campanhas.find((c) => c.avisoLucro)?.avisoLucro ?? undefined} style={{ cursor: "help" }}>
              {" · "}<b style={{ color: "var(--warning)" }}>≈</b> = anúncio dividido entre campanhas, receita rateada pelo gasto
            </span>
          )}
        </span>
      </div>

      {/* Diz o que falta e quando volta a bater, em vez de deixar a diferença parecer erro de conta. */}
      {defasadas && consolidacao && (
        <div className="panel-sub" role="status" style={{ margin: "0 0 10px", padding: "8px 10px", borderRadius: 8, background: "var(--warning-soft)", color: "var(--text)" }}>
          <b>⏳ O Mercado Livre ainda não liberou as vendas de ontem ({consolidacao.dia.split("-").reverse().join("/")}) na API.</b>{" "}
          Investimento e cliques já batem com o painel ({fmtBRL(consolidacao.custoAnuncios)} gastos ontem);
          a receita atribuída de ontem ainda não chegou, então receita, ROAS e lucro deste período estão menores do que serão.
          Nas campanhas marcadas, o ROAS &quot;consolidado&quot; é o dos dias que o ML já fechou. Para decidir verba,
          use um período que termine anteontem.
        </div>
      )}

      <div className="table-wrapper" style={{ border: "none" }}>
        <table className={`tbl-modern tbl-cards ${t.tabela}`}>
          <thead>
            <tr>
              <th className={t.lCampanha}>Campanha</th>
              {/* Orçamento e meta são o que se ajusta no painel do ML — tê-los aqui permite decidir e agir sem trocar de tela. */}
              <th className={t.lVerba} title="Orçamento diário e ROAS objetivo configurados na campanha.">Verba · meta</th>
              <th className={t.lInvestido}>Investido</th>
              <th className={t.lReceita}>Receita</th>
              <th className={t.lRoas} title="ROAS no modo escolhido. Embaixo, o do painel do Mercado Ads quando difere.">ROAS</th>
              <th className={t.lLucro} title="Lucro após Ads e margem sobre a receita da campanha. Comparar pelo valor absoluto escala a errada: R$ 373 sobre R$ 2.369 é 15,8%; R$ 125 sobre R$ 992 é 12,7%.">Lucro · margem</th>
              <th className={t.cAcao}><span className="sr-only">Performance</span></th>
            </tr>
          </thead>
          <tbody>
            {campanhas.map((c) => (
              <tr key={c.campaignId} className={t.linha} data-tom={c.lucroAposAds != null && c.lucroAposAds < 0 ? "ruim" : undefined} onClick={() => setAberta(c)}>
                <td className={t.campanha}>
                  <span className={t.topo}><span className={t.nome} title={c.campaignName || c.campaignId}>{rotuloCampanha(c.campaignName)}</span></span>
                  <span className={t.produto}>
                    {/* Cadastrados = o que o painel do ML mostra HOJE; "gastaram" = quem entrou na conta do período.
                        Diferem quando um anúncio saiu da campanha no meio do período (Pura Folha - Full: 0 hoje, 1 gastou). */}
                    {c.anunciosCadastrados == null || c.anunciosCadastrados === c.anuncios
                      ? `${c.anuncios} anúncio(s)`
                      : `${c.anunciosCadastrados} anúncio(s) hoje · ${c.anuncios} gastou(aram) no período`}
                    {" · "}{num(c.clicks)} cliques
                    {/* Um anúncio desta campanha roda em outra também: o "≈" do lucro e esta marca dizem o mesmo fato. */}
                    {c.atribuicaoIncerta && <span title={c.avisoLucro ?? undefined} style={{ marginLeft: 6, cursor: "help", color: "var(--warning)" }}>⚠ rateado</span>}
                    {c.receitaParcial && <span title={c.avisoLucro ?? undefined} style={{ marginLeft: 6, cursor: "help", color: "var(--warning)" }}>⏳ receita parcial</span>}
                  </span>
                </td>
                <td data-label="Verba · meta">
                  <div className={t.celula}>
                    <span className={t.valor} style={{ color: c.dailyBudget > 0 ? undefined : "var(--muted)" }}>{c.dailyBudget > 0 ? `${fmtBRL(c.dailyBudget)}/dia` : "—"}</span>
                    <span className={t.sub}>{c.roasTarget > 0 ? `meta ${num(c.roasTarget, 2)}x` : "sem meta"}</span>
                  </div>
                </td>
                <td data-label="Investido"><div className={t.celula}><span className={t.valor}>{fmtBRL(c.cost)}</span></div></td>
                <td data-label="Receita">
                  <div className={t.celula}>
                    <span className={t.valor}>{fmtBRL(c.receita)}</span>
                    {/* "Vendas atribuídas" do painel: unidades, direta + assistida. */}
                    <span className={t.sub} title={`Receita atribuída total no Mercado Ads: ${fmtBRL(c.receitaAtribuida)} (direta + assistida).`}>
                      {num(c.vendasAtribuidas)} vendas atribuídas
                    </span>
                  </div>
                </td>
                {/* Dois ROAS de propósito: o do modo e o do painel do Mercado Ads (receita atribuída total). Sem o segundo,
                    o daqui parece quebrado ao lado do ML (4,71x aqui × 10,77x lá, mesma campanha). */}
                <td data-label="ROAS">
                  <div className={t.celula}>
                    <span className={t.valor} style={{ color: c.roas != null ? corRoas(c.roas) : "var(--muted)" }}>{c.roas != null ? `${num(c.roas, 2)}x` : "—"}</span>
                    {c.roasMlAds != null && c.roas != null && Math.abs(c.roasMlAds - c.roas) > 0.01 && (
                      <span
                        className={`${t.sub} ${t.ajuda}`}
                        title={`No Mercado Ads esta campanha aparece com ROAS ${num(c.roasMlAds, 2)}x, porque lá a conta usa a receita atribuída TOTAL (${fmtBRL(c.receitaAtribuida)}: clique direto + venda assistida). Aqui a base é ${fmtBRL(c.receita)}. Os dois estão certos e respondem perguntas diferentes.`}
                      >
                        no ML {num(c.roasMlAds, 2)}x
                      </span>
                    )}
                    {c.receitaParcial && c.roasConsolidado != null && (
                      <span className={`${t.sub} ${t.ajuda}`} title="ROAS do Mercado Ads só dos dias que o ML já consolidou — sem o investimento de ontem, que ainda não tem a venda de ontem do lado.">
                        consolidado {num(c.roasConsolidado, 2)}x
                      </span>
                    )}
                    {/* O ROAS que paga a conta: abaixo dele a campanha dá prejuízo com a margem real do produto. */}
                    {c.roasEquilibrio != null && (
                      <span
                        className={`${t.sub} ${t.ajuda}`}
                        style={{ color: c.roas != null && c.roas >= c.roasEquilibrio ? "var(--green)" : "var(--red-text)" }}
                        title={`ROAS mínimo pra não dar prejuízo: 1 ÷ margem antes de ads (${num((c.margemAntesAds ?? 0) * 100, 1)}%, já com custo, imposto, taxa do ML e frete). Na mesma base da coluna ROAS.`}
                      >
                        mín. {num(c.roasEquilibrio, 2)}x
                      </span>
                    )}
                  </div>
                </td>
                {/* Sem número, entra o MOTIVO (traço mudo não diz se falta custo ou venda). Rateado, entra o "≈". */}
                <td data-label="Lucro · margem" title={c.avisoLucro ?? c.motivoSemLucro ?? undefined}>
                  <div className={t.celula}>
                    {c.lucroAposAds != null ? (
                      <span className={`${t.valor} ${c.lucroAposAds >= 0 ? t.positivo : t.negativo}`} style={{ cursor: c.lucroAproximado ? "help" : undefined }}>
                        {c.lucroAproximado && <span style={{ fontWeight: 400 }}>≈ </span>}{fmtBRL(c.lucroAposAds)}
                      </span>
                    ) : <span className={t.motivo}>{c.motivoSemLucro ?? "—"}</span>}
                    {c.margem != null
                      ? <span className={t.sub} style={{ color: c.margem < 0 ? "var(--red-text)" : corMargem(c.margem) }}>margem {c.lucroAproximado ? "≈ " : ""}{num(c.margem, 1)}%</span>
                      : c.lucroAposAds != null && <span className={t.motivo} title={c.motivoSemMargem ?? undefined}>{c.motivoSemMargem ?? "sem margem"}</span>}
                  </div>
                </td>
                <td data-cell="acoes" className={t.acao}>
                  <button
                    type="button" className={t.abrir} title="Ver performance" aria-label={`Ver performance de ${rotuloCampanha(c.campaignName)}`}
                    onClick={(e) => { e.stopPropagation(); setAberta(c); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aberta && (
        <Modal open onClose={() => setAberta(null)} wide>
          <div className="modal-title">{rotuloCampanha(aberta.campaignName)}</div>
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
