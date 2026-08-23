"use client";

import {
  CORES_NIVEL,
  METRIC_LABELS,
  METRIC_LIMITES,
  SITUACAO_COR,
  formatTaxaDecimal,
  getPowerSellerLabel,
  getProximoNivelLabel,
  getReputationLevelMeta,
  situacaoDaMetrica,
  type SellerReputation,
} from "@/lib/domain/reputation";

function fmtPct01(v: number | undefined): string | null {
  return formatTaxaDecimal(v);
}

export default function ReputacaoPanel({
  reputation, indisponivel,
}: {
  reputation: SellerReputation | null;
  indisponivel: boolean;
}) {
  if (indisponivel) {
    return (
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 6 }}>Reputação no Mercado Livre</div>
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>
          Não consegui buscar a reputação agora (token do ML pode estar sem acesso). Tente reconectar o ML.
        </div>
      </div>
    );
  }
  if (!reputation) {
    return (
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 6 }}>Reputação no Mercado Livre</div>
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Carregando…</div>
      </div>
    );
  }

  const nivel = getReputationLevelMeta(reputation.level_id);
  const selo = getPowerSellerLabel(reputation.power_seller_status);
  const proximo = getProximoNivelLabel(reputation.power_seller_status);
  const t = reputation.transactions;
  const ratings = t?.ratings;
  const positivas = fmtPct01(ratings?.positive);
  const negativas = fmtPct01(ratings?.negative);
  const neutras = fmtPct01(ratings?.neutral);
  const metrics = reputation.metrics;

  const linhasMetricas = (Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[])
    .map((k) => ({ key: k, label: METRIC_LABELS[k], entry: metrics?.[k] }))
    .filter((l) => l.entry != null);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Reputação no Mercado Livre</span>
        <span className="panel-sub" style={{ color: nivel.cor, fontWeight: 700 }}>{nivel.label}</span>
      </div>

      {/* A barra de 5 degraus — é como o vendedor reconhece a reputação de
          relance no painel do próprio Mercado Livre. Sem ela, "5_green" é
          jargão; com ela, a posição é imediata. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {CORES_NIVEL.map((c) => {
          const atual = c.id === reputation.level_id;
          return (
            <div
              key={c.id}
              title={atual ? "Seu nível atual" : undefined}
              style={{
                flex: 1, height: 8, borderRadius: 4, background: c.cor,
                // O atual ganha altura e contorno: cor sozinha não distingue
                // quando os tons vizinhos são próximos.
                transform: atual ? "scaleY(1.6)" : undefined,
                outline: atual ? "2px solid var(--text)" : "none",
                outlineOffset: 2,
              }}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "var(--surface2)" }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Selo atual</div>
          <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{selo}</div>
        </div>
        {proximo && (
          <>
            <span style={{ color: "var(--muted)" }}>→</span>
            <div>
              <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Próximo degrau</div>
              <div style={{ fontSize: ".95rem", fontWeight: 700, color: "var(--accent)" }}>{proximo}</div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Vendas concluídas</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{t?.completed ?? "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Vendas canceladas</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: (t?.canceled ?? 0) > 0 ? "var(--red)" : undefined }}>{t?.canceled ?? "—"}</div>
        </div>
        {(positivas || negativas || neutras) && (
          <div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Avaliações</div>
            <div style={{ fontSize: ".85rem", fontWeight: 700 }}>
              {positivas && <span style={{ color: "var(--green)" }}>{positivas} pos</span>}
              {negativas && <span style={{ color: "var(--red)", marginLeft: 8 }}>{negativas} neg</span>}
              {neutras && <span style={{ color: "var(--muted)", marginLeft: 8 }}>{neutras} neutra</span>}
            </div>
          </div>
        )}
      </div>

      {linhasMetricas.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 6 }}>
            Métricas que o Mercado Livre usa pra calcular seu nível:
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {linhasMetricas.map(({ key, label, entry }) => {
              const lim = METRIC_LIMITES[key];
              const sit = situacaoDaMetrica(key, entry?.rate);
              return (
                <div
                  key={key}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
                    fontSize: ".82rem", padding: "8px 10px", background: "var(--surface2)", borderRadius: 6,
                    borderLeft: `3px solid ${SITUACAO_COR[sit]}`,
                  }}
                >
                  <span>
                    {label}{entry?.period ? <span style={{ color: "var(--muted)" }}> · {entry.period}</span> : null}
                    {/* O teto é o que dá sentido à taxa: "0%" sozinho não diz
                        se 0,5% seria tranquilo ou já problema. */}
                    {lim && (
                      <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", fontWeight: 400 }}>
                        permitido até {lim.permitido}% · MercadoLíder exige até {lim.mercadoLider}%
                      </span>
                    )}
                  </span>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: SITUACAO_COR[sit] }}>
                    {fmtPct01(entry?.rate) ?? "—"}
                    {sit === "atencao" && (
                      <span style={{ display: "block", fontSize: ".64rem", fontWeight: 400 }}>
                        trava o MercadoLíder
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: ".7rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Ver o checklist completo de requisitos no painel &quot;O que falta pra ser MercadoLíder&quot; ao lado.
      </div>
    </div>
  );
}
