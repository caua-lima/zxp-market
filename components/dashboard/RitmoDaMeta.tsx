"use client";

import { calcularRitmoDaMeta, preenchimento } from "@/lib/domain/ritmo-meta";
import s from "./RitmoDaMeta.module.css";

/**
 * Ritmo do mês — duas barras alinhadas, a leitura mais direta de "estou bem?":
 *
 *   · Meta do mês: quanto do total já foi, com uma marquinha de onde a barra
 *     deveria estar HOJE;
 *   · Meta diária acumulada: o faturamento contra o que a meta pedia até hoje
 *     (124% = à frente do ritmo).
 *
 * A conta mora em lib/domain/ritmo-meta.ts. Os números saem sem centavos: é
 * leitura de relance, e R$ 294.804,37 ao lado de R$ 238.609,12 só atrapalha
 * comparar.
 */

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const pct = (v: number) => `${Math.round(v).toLocaleString("pt-BR")}%`;

function tomDoRitmo(pctIdeal: number): "bom" | "atencao" | "ruim" {
  if (pctIdeal >= 100) return "bom";
  if (pctIdeal >= 85) return "atencao";
  return "ruim";
}

export default function RitmoDaMeta({
  faturamento, meta, metaIndex, diaAtual, diasNoMes,
}: {
  faturamento: number;
  meta: number;
  metaIndex: number;
  diaAtual: number;
  diasNoMes: number;
}) {
  const r = calcularRitmoDaMeta({ faturamento, meta, diaAtual, diasNoMes });
  if (!r) return null;

  const tom = tomDoRitmo(r.pctIdeal);
  const metaBatida = r.faltaMeta === 0;
  const borda = r.marcoIdealPct < 12 ? "ini" : r.marcoIdealPct > 88 ? "fim" : undefined;

  return (
    <section className={s.caixa} aria-label="Ritmo do mês">
      <div className={s.cabeca}>
        <span className={s.titulo}>Ritmo do mês</span>
        <span className={s.dia}>dia {Math.min(diaAtual, diasNoMes)} de {diasNoMes}</span>
      </div>

      {/* ── Meta do mês, com a marquinha de hoje ── */}
      <div className={s.linha}>
        <div className={s.topo}>
          <span className={s.rotulo}>
            Meta {metaIndex} do mês{metaBatida && <span className={s.check} aria-label="batida">✓</span>}
          </span>
          <span className={s.valores}><b>{reais(faturamento)}</b> / {reais(meta)}</span>
          <span className={s.pct} style={{ color: metaBatida ? "var(--green)" : "var(--text)" }}>{pct(r.pctMeta)}</span>
        </div>
        <div
          className={`${s.trilho} ${!metaBatida ? s.comMarco : ""}`}
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preenchimento(r.pctMeta))}
          aria-valuetext={`${pct(r.pctMeta)} da meta ${metaIndex}; hoje o ideal era ${reais(r.idealHoje)}`}
        >
          <div className={s.cheio} data-tom="meta" style={{ width: `${preenchimento(r.pctMeta)}%` }} />
          {!metaBatida && (
            <>
              <div className={s.marco} style={{ left: `${r.marcoIdealPct}%` }} title={`Onde deveria estar hoje: ${reais(r.idealHoje)}`} />
              <div className={s.marcoRotulo} data-borda={borda} style={{ left: `${r.marcoIdealPct}%` }} aria-hidden>
                hoje: {reais(r.idealHoje)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Meta diária acumulada: onde deveria estar hoje ── */}
      <div className={s.linha}>
        <div className={s.topo}>
          <span className={s.rotulo}>
            Meta diária acumulada{r.noRitmo && <span className={s.check} aria-label="no ritmo">✓</span>} <small>(onde deveria estar hoje)</small>
          </span>
          <span className={s.valores}><b>{reais(faturamento)}</b> / {reais(r.idealHoje)}</span>
          <span className={s.pct} style={{ color: tom === "bom" ? "var(--green)" : tom === "atencao" ? "var(--warning)" : "var(--red-text)" }}>{pct(r.pctIdeal)}</span>
        </div>
        <div
          className={s.trilho}
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preenchimento(r.pctIdeal))}
          aria-valuetext={`${pct(r.pctIdeal)} do ideal até hoje`}
        >
          <div className={s.cheio} data-tom={tom} style={{ width: `${preenchimento(r.pctIdeal)}%` }} />
        </div>
        <div className={s.status} data-tom={tom} role="status">
          {r.noRitmo ? (
            <>▲ {reais(r.diferenca)} à frente do ritmo{!metaBatida && <span>pra fechar a meta: {reais(r.porDiaParaBater)}/dia</span>}</>
          ) : (
            <>▼ {reais(-r.diferenca)} atrás do ritmo <span>pra fechar a meta: {reais(r.porDiaParaBater)}/dia até o fim do mês</span></>
          )}
        </div>
      </div>
    </section>
  );
}
