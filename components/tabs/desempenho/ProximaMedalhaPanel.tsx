"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL } from "@/lib/domain/calc";
import { metricasDeQualidade } from "@/lib/domain/proxima-medalha";
import {
  REQUISITOS_COMUNS,
  janelaDaMedalha,
  progressoMercadoLider,
  type EixoMedalha,
} from "@/lib/domain/mercadolider-metas";

/**
 * "Quanto falta pra próxima medalha."
 *
 * ─── O ALVO DEIXOU DE SER DIGITADO ──────────────────────────────────────
 *
 * Este painel pedia o limiar de faturamento na mão, porque a API não devolve
 * e chutar seria pior que não ter. A tabela oficial foi localizada em
 * 05/09/2026 na página "Tudo sobre ser MercadoLíder" e agora mora em
 * lib/domain/mercadolider-metas.ts — 230/575/1.725 vendas e
 * R$ 37.000/118.400/296.000.
 *
 * ─── DUAS JANELAS DIFERENTES, DE PROPÓSITO ──────────────────────────────
 *
 * A qualidade é medida em 60 dias (janela da REPUTAÇÃO). A medalha é medida
 * em "3 meses mais os dias do mês vigente" — 97 dias em 05/09. São critérios
 * distintos do ML, e misturá-los subestimava o acumulado em ~40%: foi o que
 * fez R$ 76.490 do painel parecer meta quando era progresso.
 *
 * Por isso duas buscas. A alternativa — uma janela só — daria um número
 * errado nos dois lados.
 */
export default function ProximaMedalhaPanel({ metrics, nivelAtual }: {
  metrics: {
    claims?: { rate?: number | null; value?: number | null } | null;
    cancellations?: { rate?: number | null; value?: number | null } | null;
    delayed_handling_time?: { rate?: number | null; value?: number | null } | null;
  } | null | undefined;
  nivelAtual: string | null | undefined;
}) {
  /** Janela da reputação — denominador das três métricas de qualidade. */
  const [reputacao, setReputacao] = useState<{ concluidas: number; faturado: number } | null>(null);
  /** Janela da medalha — 3 meses + mês vigente. */
  const [medalha, setMedalha] = useState<{ concluidas: number; faturado: number } | null>(null);
  /**
   * Comeca em true e so cai pra false quando as duas buscas voltam.
   * Chamar setCarregando(true) DENTRO do efeito seria setState sincrono em
   * efeito — render em cascata, e o lint pega (react-hooks/set-state-in-effect).
   */
  const [carregando, setCarregando] = useState(true);

  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const janela = janelaDaMedalha(hoje);

  useEffect(() => {
    let vivo = true;
    const pega = (qs: string) =>
      authedFetch(`/api/ml/reputacao-vendas?${qs}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("falhou"))))
        .then((j) => j?.bloco ?? null)
        .catch(() => null);

    Promise.all([
      pega("dias=60"),
      pega(`from=${janela.de}&to=${janela.ate}&dias=${janela.dias}`),
    ]).then(([rep, med]) => {
      if (!vivo) return;
      setReputacao(rep);
      setMedalha(med);
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, [janela.de, janela.ate, janela.dias]);

  const vendasReputacao = reputacao?.concluidas ?? 0;
  const qualidade = metricasDeQualidade(metrics, vendasReputacao);

  const p = progressoMercadoLider(
    medalha?.concluidas ?? 0,
    medalha?.faturado ?? 0,
    nivelAtual,
    hoje,
  );

  const dataBR = (iso: string) => iso.split("-").reverse().join("/");

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          Próxima medalha
          <span className="panel-sub"> · {p ? p.meta.label : "MercadoLíder Platinum — você está no topo"}</span>
        </span>
      </div>

      {/* ─── OS DOIS EIXOS DA MEDALHA ───────────────────────────────────
          Vendas E faturamento, lado a lado. Acompanhar só o dinheiro esconde
          metade do critério: dá pra estar com o faturamento fechado e a
          medalha travada na contagem de vendas — e a ação nos dois casos é
          oposta (girar volume × subir margem). */}
      {p && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 8 }}>
            O Mercado Livre mede os 3 meses mais os dias do mês vigente —{" "}
            <b>{dataBR(janela.de)} a {dataBR(janela.ate)}</b> ({janela.dias} dias).
            {carregando && " Carregando…"}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <BarraEixo
              titulo="Vendas concretizadas"
              eixo={p.vendas}
              formato={(n) => n.toLocaleString("pt-BR")}
              gargalo={p.gargalo === "vendas"}
            />
            <BarraEixo
              titulo="Faturamento"
              eixo={p.faturamento}
              formato={fmtBRL}
              gargalo={p.gargalo === "faturamento"}
            />
          </div>

          <div style={{ marginTop: 10, fontSize: ".82rem" }}>
            {p.ambosOk ? (
              <span style={{ color: "var(--green)", fontWeight: 700 }}>
                Vendas e faturamento fechados pro {p.meta.label}. O que decide agora são os
                requisitos abaixo — o ML revisa e concede.
              </span>
            ) : (
              <>
                Falta{" "}
                <b style={{ color: "var(--warning)" }}>
                  {p.gargalo === "vendas"
                    ? `${p.vendas.falta.toLocaleString("pt-BR")} venda(s)`
                    : fmtBRL(p.faturamento.falta)}
                </b>{" "}
                no que está mais atrasado.
                <div style={{ color: "var(--muted)", fontSize: ".76rem", marginTop: 2 }}>
                  Ritmo de {p.vendasPorDia.toFixed(1)} venda(s)/dia e {fmtBRL(p.faturamentoPorDia)}/dia.
                  {p.diasNoRitmo != null
                    ? ` Nesse passo, ${p.diasNoRitmo} dia(s)${p.chegaEm ? ` — ${dataBR(p.chegaEm)}` : ""}.`
                    : " Sem vendas no período, não dá pra projetar quando chega."}
                </div>
                {/* Os dois eixos avançam juntos, mas a projeção segue o pior:
                    prometer a data do eixo adiantado erraria sempre pra menos. */}
                {p.vendas.ok !== p.faturamento.ok && (
                  <div style={{ color: "var(--muted)", fontSize: ".72rem", marginTop: 4 }}>
                    {p.gargalo === "vendas"
                      ? "O faturamento já fechou — o que trava é a contagem de vendas. Girar volume vale mais aqui que subir preço."
                      : "As vendas já fecharam — o que trava é o faturamento. Aqui ticket e mix pesam mais que volume."}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* A qualidade tem janela própria (60 dias) — é o critério da REPUTAÇÃO,
          não o da medalha, e os limites são os publicados pelo ML. */}
      <div style={{ borderTop: p ? "1px solid var(--border)" : "none", paddingTop: p ? 12 : 0 }}>
        <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 6 }}>
          Qualidade — nos últimos 60 dias, sobre {vendasReputacao} vendas concluídas
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {qualidade.map((q) => (
            <div key={q.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", fontSize: ".82rem" }}>
              <span>
                <span style={{ color: q.ok === false ? "var(--red)" : q.ok ? "var(--green)" : "var(--muted)", fontWeight: 800 }}>
                  {q.ok === false ? "✕" : q.ok ? "✓" : "—"}
                </span>{" "}
                {q.label}
                <span style={{ color: "var(--muted)", fontSize: ".72rem" }}>
                  {" "}· limite {(q.limite * 100).toFixed(q.limite < 0.01 ? 1 : 0)}%
                </span>
              </span>
              <span style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                <b>{q.taxa == null ? "—" : `${(q.taxa * 100).toFixed(2)}%`}</b>
                {q.casos != null && <span style={{ color: "var(--muted)" }}> ({q.casos})</span>}
                {/* A folga em CASOS é o que dá pra agir: "0,22%" não diz se
                    está perto do limite; "cabem mais 54" diz. */}
                {q.folgaEmCasos != null && (
                  <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>
                    cabem mais {q.folgaEmCasos}
                  </div>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── OS REQUISITOS QUE NÃO ESCALAM ──────────────────────────────
          Valem igual pras três medalhas, e são a resposta pra "bati vendas e
          faturamento, por que não subi?". Sem eles a tela responderia só
          metade da pergunta. */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: ".78rem", color: "var(--muted)" }}>
          Requisitos que valem pra qualquer medalha ({REQUISITOS_COMUNS.length})
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          {REQUISITOS_COMUNS.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: ".78rem" }}>
              <span>{r.label}</span>
              <span style={{ color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>{r.exigencia}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: 8 }}>
          Fonte: página oficial &quot;Tudo sobre ser MercadoLíder&quot; do Mercado Livre, lida em 05/09/2026.
          O faturamento do critério não conta vendas vindas de anúncios Grátis.
        </div>
      </details>
    </div>
  );
}

/**
 * Uma barra por eixo, com o alvo escrito ao lado.
 *
 * O alvo aparece SEMPRE, mesmo com a barra cheia: "575" é o que transforma
 * "520 vendas" em informação — sem ele o número é só um número.
 */
function BarraEixo({ titulo, eixo, formato, gargalo }: {
  titulo: string;
  eixo: EixoMedalha;
  formato: (n: number) => string;
  gargalo: boolean;
}) {
  const pct = Math.min(100, Math.max(0, eixo.pct));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: ".8rem" }}>
        <span>
          {titulo}
          {gargalo && (
            <span
              className="chip chip-muted" style={{ marginLeft: 6, fontSize: ".62rem" }}
              title="É o eixo mais atrasado — é ele que está segurando a medalha."
            >
              trava aqui
            </span>
          )}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>
          <b style={{ color: eixo.ok ? "var(--green)" : "var(--text)" }}>{formato(eixo.atual)}</b>
          <span style={{ color: "var(--muted)" }}> / {formato(eixo.alvo)}</span>
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--surface2)", margin: "4px 0 2px", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: eixo.ok ? "var(--green)" : gargalo ? "var(--warning)" : "var(--accent)",
        }} />
      </div>
      <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>
        {eixo.ok ? "critério fechado" : `${eixo.pct.toFixed(0)}% · faltam ${formato(eixo.falta)}`}
      </div>
    </div>
  );
}
