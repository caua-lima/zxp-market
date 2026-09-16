"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL, formatDateLong, fmtPct } from "@/lib/domain/calc";

type AnuncioDia = {
  item_id: string;
  title: string;
  retorno: number;
  custoProduto: number;
  envioFull: number;
  taxaML: number;
  imposto: number;
  ads: number;
  lucro: number;
  margem: number;
  qty: number;
  semVenda?: boolean;
};

type DayMetrics = {
  faturamentoLiquido: number;
  lucroComCustos: number;
  margemComCustos: number;
  ordersCount: number;
  totalAds: number;
  adsFalhou?: boolean;
  anuncios?: AnuncioDia[];
};

/**
 * Detalhamento de um único dia, aberto ao clicar num ponto do gráfico de
 * tendência. Reaproveita a MESMA rota de métricas que o resto do Dashboard já
 * usa (só com from=to=o dia clicado) — nenhum cálculo novo, nenhuma rota nova.
 */
export default function DayDetailModal({ date, onClose }: { date: string; onClose: () => void }) {
  /**
   * ─── A RESPOSTA CARREGA O DIA A QUE ELA PERTENCE ─────────────────────
   *
   * Eram três estados soltos — `dados`, `erro`, `loading` — e o efeito
   * começava com `setLoading(true); setErro(false);`. Isso é reset SÍNCRONO
   * dentro do efeito, e o efeito roda DEPOIS da pintura.
   *
   * Quando `date` muda sem o componente remontar, a sequência é: pinta o
   * título novo com os números ANTIGOS, e só no quadro seguinte aparece
   * "Carregando…". Um quadro de dado errado sob o cabeçalho certo.
   *
   * Guardar o dia JUNTO da resposta elimina o reset: resposta de outro dia
   * simplesmente não é a resposta deste, e isso se decide durante o render,
   * sem setState nenhum e sem quadro intermediário.
   *
   * (Hoje o modal cobre a tela, então trocar de dia sem fechar não é
   * alcançável pelo mouse. O `key` que faltava resolveria o caso de hoje;
   * isto resolve o caso de hoje E o do dia em que alguém puser dois pontos
   * clicáveis fora do overlay.)
   */
  const [resposta, setResposta] = useState<{ dia: string; dados: DayMetrics | null } | null>(null);

  const atual = resposta?.dia === date ? resposta : null;
  const loading = atual === null;
  const dados = atual?.dados ?? null;
  const erro = atual !== null && atual.dados === null;

  useEffect(() => {
    let alive = true;
    authedFetch(`/api/ml/metrics?from=${date}&to=${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (alive) setResposta({ dia: date, dados: j }); })
      .catch(() => { if (alive) setResposta({ dia: date, dados: null }); });
    return () => { alive = false; };
  }, [date]);

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" style={{ textAlign: "left" }}>{formatDateLong(date)}</div>
        {loading ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: ".85rem" }}>Carregando…</div>
        ) : erro || !dados ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: ".85rem" }}>Não consegui carregar este dia agora.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <Linha label="Faturamento líquido" value={fmtBRL(dados.faturamentoLiquido)} />
            <Linha label="Lucro líquido" value={fmtBRL(dados.lucroComCustos)} tone={dados.lucroComCustos >= 0 ? "pos" : "neg"} />
            <Linha label="Margem líquida" value={`${fmtPct(dados.margemComCustos, 1)}`} />
            <Linha label="Pedidos" value={String(dados.ordersCount)} />
            <Linha label="Gasto com ADS" value={dados.adsFalhou ? "indisponível" : fmtBRL(dados.totalAds)} />

            {dados.anuncios && dados.anuncios.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: ".82rem", color: "var(--text-secondary)", marginBottom: 6 }}>
                  Anúncios do dia (pior lucro primeiro)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                  {[...dados.anuncios]
                    .sort((a, b) => a.lucro - b.lucro)
                    .map((a) => (
                      <div
                        key={a.item_id}
                        style={{
                          display: "flex", flexDirection: "column", gap: 2,
                          padding: "8px 10px", borderRadius: 8,
                          background: "var(--surface-raised,var(--surface2))",
                          borderLeft: `3px solid ${a.lucro >= 0 ? "var(--success)" : "var(--danger)"}`,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".82rem", fontWeight: 600 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                          <span className="money" style={{ color: a.lucro >= 0 ? "var(--success)" : "var(--danger)", flexShrink: 0 }}>
                            {fmtBRL(a.lucro)}
                          </span>
                        </div>
                        <div style={{ fontSize: ".75rem", color: "var(--text-secondary)" }}>
                          {a.semVenda
                            ? "sem venda hoje — só ADS"
                            : `${a.qty} un · retorno ${fmtBRL(a.retorno)} · CMV ${fmtBRL(a.custoProduto)} · frete ${fmtBRL(a.envioFull)} · taxa ML ${fmtBRL(a.taxaML)} · imposto ${fmtBRL(a.imposto)} · ads ${fmtBRL(a.ads)} · margem ${fmtPct(a.margem, 1)}`}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="modal-btns">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function Linha({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".88rem" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="money" style={{ fontWeight: 700, color: tone === "pos" ? "var(--success)" : tone === "neg" ? "var(--danger)" : "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
