"use client";

import { useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { compararMetrica, type ComparacaoMetrica } from "@/lib/domain/ads-comparison";
import { num, type Modo } from "./ads-types";

export type OverviewTotais = {
  investimento: number;
  receita: number;
  lucroAposAds: number;
  eficiencia: number; // ROAS (modo pub) ou TACOS % (modo geral)
  impressoes: number; clicks: number; ctr: number; cpc: number;
  vendas: number; unidades: number;
  acosOuTacosComplementar: number; // o outro dos dois (mostrado nos detalhes)
  margemMedia: number | null;
  // Nota: "retorno" (valor − taxa ML − frete, antes de custo/imposto) NÃO é
  // exposto por app/api/ml/ads/route.ts hoje (só o lucro já líquido de tudo
  // isso) — por isso não aparece aqui. Melhor omitir do que fabricar um
  // número que a API não fornece.
  lucroAntesAds: number;
};

function DeltaTag({ c, positivoEhBom }: { c: ComparacaoMetrica; positivoEhBom: boolean }) {
  if (c.deltaPercentual == null) return <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>sem período anterior comparável</span>;
  const subiu = c.deltaPercentual > 0;
  const bom = subiu === positivoEhBom;
  const cor = c.deltaPercentual === 0 ? "var(--muted)" : bom ? "var(--green)" : "var(--red)";
  const seta = c.deltaPercentual === 0 ? "→" : subiu ? "↑" : "↓";
  return <span style={{ fontSize: ".75rem", color: cor, fontWeight: 700 }}>{seta} {num(Math.abs(c.deltaPercentual), 1)}% vs. período anterior</span>;
}

function Kpi({
  label, valor, definicao, tooltip, cor, comparacao, positivoEhBom, semDados, confiabilidade,
}: {
  label: string; valor: string; definicao: string; tooltip: string; cor?: string;
  comparacao?: ComparacaoMetrica; positivoEhBom?: boolean;
  semDados?: boolean;
  confiabilidade?: "confirmado" | "estimado" | "incompleto";
}) {
  return (
    <div className="kpi k-acc" title={tooltip} style={{ cursor: "help" }}>
      <div className="k-lbl">{label}</div>
      <div className="k-val" style={{ color: semDados ? "var(--muted)" : cor }}>{semDados ? "—" : valor}</div>
      <div className="k-sub">{definicao}</div>
      {!semDados && comparacao && positivoEhBom != null && (
        <div style={{ marginTop: 4 }}><DeltaTag c={comparacao} positivoEhBom={positivoEhBom} /></div>
      )}
      {confiabilidade && confiabilidade !== "confirmado" && (
        <div style={{ marginTop: 3, fontSize: ".75rem", color: "var(--warning)", fontWeight: 600 }}>
          {confiabilidade === "estimado" ? "estimado" : "dado incompleto"}
        </div>
      )}
    </div>
  );
}

export default function AdsOverview({
  modo, atual, anterior, loading,
}: {
  modo: Modo; atual: OverviewTotais; anterior: OverviewTotais | null; loading: boolean;
}) {
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  const pub = modo === "pub";

  if (loading) {
    return (
      <div className="kpi-grid">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="kpi k-acc" style={{ opacity: 0.5 }}>
            <div className="k-lbl">Carregando dados de Ads…</div>
            <div className="k-val" style={{ color: "var(--muted)" }}>···</div>
          </div>
        ))}
      </div>
    );
  }

  const cInvest = compararMetrica(atual.investimento, anterior?.investimento ?? null);
  const cReceita = compararMetrica(atual.receita, anterior?.receita ?? null);
  const cLucro = compararMetrica(atual.lucroAposAds, anterior?.lucroAposAds ?? null);
  const cEficiencia = compararMetrica(atual.eficiencia, anterior?.eficiencia ?? null);

  return (
    <div>
      <div className="kpi-grid">
        <Kpi
          label="Investimento em Ads" valor={fmtBRL(atual.investimento)}
          definicao="Total gasto no período" tooltip="Soma do custo de todos os anúncios com investimento no período."
          cor="var(--red)" comparacao={cInvest} positivoEhBom={false}
        />
        <Kpi
          label={pub ? "Receita atribuída" : "Receita analisada"} valor={fmtBRL(atual.receita)}
          definicao={pub ? "Vendas diretas do clique no ad" : "Todas as vendas do item (ads + orgânico)"}
          tooltip={pub ? "Compras feitas logo após clicar no anúncio." : "Tudo que os itens anunciados venderam no período, com ou sem Ads."}
          cor="var(--green)" comparacao={cReceita} positivoEhBom={true}
        />
        <Kpi
          label="Lucro após Ads" valor={fmtBRL(atual.lucroAposAds)}
          definicao="Receita − custo − taxas − frete − imposto − Ads"
          tooltip="O que sobrou de verdade depois de pagar o produto, o Mercado Livre e o investimento em Ads."
          cor={atual.lucroAposAds >= 0 ? "var(--green)" : "var(--red)"}
          comparacao={cLucro} positivoEhBom={true}
        />
        <Kpi
          label={pub ? "ROAS" : "TACOS"} valor={pub ? `${num(atual.eficiencia, 2)}x` : `${num(atual.eficiencia, 1)}%`}
          definicao={pub ? "Vendas diretas ÷ investido" : "Investido ÷ vendas totais"}
          tooltip={pub ? "Quanto voltou em venda direta pra cada R$1 investido em Ads." : "Fatia do faturamento do item que foi consumida pelo investimento em Ads — quanto menor, melhor."}
          cor="var(--accent,#5b9bd5)" comparacao={cEficiencia} positivoEhBom={pub}
        />
      </div>

      <button
        type="button" onClick={() => setDetalhesAbertos((v) => !v)}
        className="btn btn-ghost btn-xs" style={{ marginTop: 8 }}
      >
        {detalhesAbertos ? "Ocultar" : "Ver"} detalhes do período
      </button>

      {detalhesAbertos && (
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
          <Detalhe label="Impressões" valor={num(atual.impressoes)} />
          <Detalhe label="Cliques" valor={num(atual.clicks)} />
          <Detalhe label="CTR" valor={`${num(atual.ctr, 2)}%`} />
          <Detalhe label="CPC" valor={fmtBRL(atual.cpc)} />
          <Detalhe label="Pedidos/vendas" valor={num(atual.vendas)} />
          <Detalhe label="Unidades" valor={num(atual.unidades)} />
          <Detalhe label={pub ? "TACOS (complementar)" : "ACOS (complementar)"} valor={`${num(atual.acosOuTacosComplementar, 1)}%`} />
          <Detalhe label="Margem média" valor={atual.margemMedia != null ? `${num(atual.margemMedia, 1)}%` : "—"} />
          <Detalhe label="Lucro antes de Ads" valor={fmtBRL(atual.lucroAntesAds)} />
        </div>
      )}
    </div>
  );
}

function Detalhe({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>{label}</div>
      <div style={{ fontSize: ".92rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
    </div>
  );
}
