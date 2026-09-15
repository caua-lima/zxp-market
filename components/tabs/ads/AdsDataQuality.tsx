"use client";

import { useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { calculateAdsReconciliation, getAdsDataQualityLabel, type AdsDataQualityStatus } from "@/lib/domain/ads-reconciliation";

const STATUS_COR: Record<AdsDataQualityStatus, { cor: string; bg: string }> = {
  confirmada: { cor: "var(--green)", bg: "rgba(54,179,126,.12)" },
  parcial: { cor: "var(--warning)", bg: "var(--warning-soft)" },
  atencao: { cor: "var(--red)", bg: "rgba(214,90,74,.12)" },
  "sem-dados": { cor: "var(--muted)", bg: "rgba(185,181,166,.14)" },
};

/**
 * Faixa compacta e expansível de qualidade de dado — nunca deixar a pessoa
 * tomar decisão com dado incompleto sem saber. Nada aqui é recalculado: usa
 * calculateAdsReconciliation() (lib/domain/ads-reconciliation.ts) em cima do
 * que a rota já devolve (gastoOrfao/gastoSemVinculo/campanhasEncontradas).
 */
export default function AdsDataQuality({
  investimentoTotal, gastoOrfao, gastoSemVinculo, anunciosContagemFalhou, temItens,
  campanhasEncontradas, campanhasTotal, atualizadoEm,
}: {
  investimentoTotal: number; gastoOrfao: number; gastoSemVinculo: number;
  anunciosContagemFalhou: boolean; temItens: boolean;
  campanhasEncontradas: number; campanhasTotal: number;
  atualizadoEm: Date | null;
}) {
  const [aberto, setAberto] = useState(false);
  const r = calculateAdsReconciliation({ investimentoTotal, gastoOrfao, gastoSemVinculo, anunciosContagemFalhou, temItens });
  const cor = STATUS_COR[r.status];

  return (
    <div style={{ border: `1px solid ${cor.cor}55`, background: cor.bg, borderRadius: 10, overflow: "hidden" }}>
      <button
        type="button" onClick={() => setAberto((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "8px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: ".82rem", fontWeight: 700, color: cor.cor }}>
          Qualidade dos dados: {getAdsDataQualityLabel(r.status)}
          {r.coveragePercent != null && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {num1(r.coveragePercent)}% do investimento conciliado</span>}
        </span>
        <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>{aberto ? "ocultar detalhes ▲" : "ver detalhes ▼"}</span>
      </button>

      {aberto && (
        <div style={{ padding: "0 14px 12px", fontSize: ".82rem", color: "var(--text)", display: "grid", gap: 6 }}>
          <Item label="Investimento total coletado" valor={fmtBRL(r.investimentoTotal)} />
          <Item label="Investimento vinculado a anúncios/campanhas" valor={fmtBRL(r.investimentoVinculado)} />
          <Item
            label="Diferença não vinculada"
            valor={r.investimentoNaoVinculado > 0 ? fmtBRL(r.investimentoNaoVinculado) : "R$ 0,00"}
            destaque={r.investimentoNaoVinculado > 0}
          />
          <Item label="Campanhas encontradas" valor={`${campanhasEncontradas} de ${campanhasTotal}`} />
          <Item label="Última atualização" valor={atualizadoEm ? atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"} />
          <Item label="Fonte" valor="API Mercado Ads + cálculo interno (custo médio, imposto, frete)" />
          {anunciosContagemFalhou && (
            <div style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }}>
              A contagem de anúncios cadastrados por campanha falhou — o gasto por campanha continua confiável, só a
              contagem total de anúncios que não veio.
            </div>
          )}
          {r.status === "sem-dados" && (
            <div style={{ color: "var(--muted)", marginTop: 4 }}>
              Há investimento no período, mas não deu pra calcular a cobertura — nunca assumimos 0% nem 100% quando o
              cálculo não fecha. Trate os números desta tela como não confirmados até isso resolver sozinho na próxima atualização.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function num1(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function Item({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontWeight: 700, color: destaque ? "var(--red)" : "var(--text)" }}>{valor}</span>
    </div>
  );
}
