"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL } from "@/lib/domain/calc";
import { metricasDeQualidade, progressoDaMedalha } from "@/lib/domain/proxima-medalha";

/**
 * "Quanto falta pra próxima medalha."
 *
 * ─── POR QUE O ALVO É DIGITADO ──────────────────────────────────────────
 *
 * A API do ML devolve o nível atual e as métricas de qualidade, mas NÃO os
 * limiares de faturamento que separam Silver de Gold. A documentação oficial
 * bloqueia leitura automatizada e as fontes de terceiros divergem.
 *
 * Tentou-se deduzir do próprio painel do ML, que exibe "R$ 76.490 faturado em
 * vendas concluídas" na tela do Gold. Medido contra a conta, esse valor é
 * praticamente o faturamento acumulado em ~120 dias (R$ 77.218 na medição) —
 * ou seja, é PROGRESSO, não meta.
 *
 * Chutar o limiar seria pior que não ter: compra e verba de anúncio seriam
 * planejadas em cima de um número que ninguém conferiu. Então o alvo vem do
 * painel do ML, digitado uma vez, e o app faz o que sabe fazer com precisão:
 * medir o acumulado e projetar o ritmo.
 */

const CHAVE = "zxp:meta-medalha";

export default function ProximaMedalhaPanel({ metrics, nivelAtual }: {
  metrics: {
    claims?: { rate?: number | null; value?: number | null } | null;
    cancellations?: { rate?: number | null; value?: number | null } | null;
    delayed_handling_time?: { rate?: number | null; value?: number | null } | null;
  } | null | undefined;
  nivelAtual: string | null | undefined;
}) {
  /**
   * Inicializacao PREGUICOSA, sem efeito: ler o storage num useEffect e
   * chamar setState dispara render em cascata (react-hooks/set-state-in-effect)
   * e faz o campo piscar vazio antes de mostrar o valor salvo.
   *
   * O guarda de `window` existe porque este componente ainda renderiza no
   * servidor pra hidratacao, e la localStorage nao existe.
   */
  const [alvo, setAlvo] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem(CHAVE) ?? ""; } catch { return ""; }
  });
  /**
   * Mesmo endpoint que o ReputacaoPanel usa — e a janela de 60 dias que o ML
   * julga, e ela precisa vir ao vivo (o banco so cobre mes atual e anterior,
   * ver lib/domain/reputacao-vendas.ts).
   */
  const [bloco, setBloco] = useState<{ concluidas: number; faturado: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    authedFetch("/api/ml/reputacao-vendas?dias=60", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("falhou"))))
      .then((j) => { if (vivo) setBloco(j?.bloco ?? null); })
      .catch(() => { if (vivo) setBloco(null); });
    return () => { vivo = false; };
  }, []);

  const faturado60d = bloco?.faturado ?? 0;
  const vendasConcluidas60d = bloco?.concluidas ?? 0;

  /**
   * O alvo fica no navegador: e preferencia de exibicao, nao dado de negocio,
   * e nao vale abrir um caminho de escrita no banco pra ele.
   */
  const guardar = (v: string) => {
    setAlvo(v);
    try { window.localStorage.setItem(CHAVE, v); } catch { /* idem */ }
  };

  const alvoNum = Number(String(alvo).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const p = progressoDaMedalha(faturado60d, alvoNum, 60, hoje);
  const qualidade = metricasDeQualidade(metrics, vendasConcluidas60d);

  const proximo = String(nivelAtual ?? "").toLowerCase() === "silver" ? "MercadoLíder Gold"
    : String(nivelAtual ?? "").toLowerCase() === "gold" ? "MercadoLíder Platinum"
    : "o próximo nível";

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          Próxima medalha
          <span className="panel-sub"> · {proximo}</span>
        </span>
      </div>

      {/* A qualidade é o que o app SABE medir com precisão: as três métricas
          vêm da API e os limites são os publicados pelo ML. */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 6 }}>
          Qualidade — nos últimos 60 dias, sobre {vendasConcluidas60d} vendas concluídas
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

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div className="config-field" style={{ margin: 0, maxWidth: 260 }}>
          <label>Faturamento que o ML pede pro {proximo}</label>
          <input
            inputMode="decimal" value={alvo} onChange={(e) => guardar(e.target.value)}
            placeholder="Ex.: 120000"
          />
          <div className="hint">
            A API do Mercado Livre não devolve esse limiar, e chutar seria pior que não ter —
            você planejaria compra em cima de um número que ninguém conferiu. Pegue no painel
            de Reputação do ML e digite aqui; fica salvo neste navegador.
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: ".84rem" }}>
          <div style={{ color: "var(--muted)", fontSize: ".72rem" }}>Faturamento em 60 dias (vendas concluídas)</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{fmtBRL(faturado60d)}</div>

          {alvoNum > 0 && (
            <>
              <div style={{ height: 8, borderRadius: 999, background: "var(--surface2)", margin: "10px 0 6px", overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(100, Math.max(0, p.pct))}%`, height: "100%",
                  background: p.alcancado ? "var(--green)" : "var(--accent)",
                }} />
              </div>
              {p.alcancado ? (
                <div style={{ color: "var(--green)", fontWeight: 700 }}>
                  Alvo alcançado — {fmtBRL(p.atual)} de {fmtBRL(p.alvo)}.
                </div>
              ) : (
                <div>
                  <b>{p.pct.toFixed(0)}%</b> do alvo · faltam{" "}
                  <b style={{ color: "var(--warning)" }}>{fmtBRL(p.falta)}</b>
                  <div style={{ color: "var(--muted)", fontSize: ".76rem", marginTop: 2 }}>
                    No ritmo atual de {fmtBRL(p.porDia)}/dia
                    {p.diasNoRitmo != null
                      ? `, chega em ${p.diasNoRitmo} dia(s)${p.chegaEm ? ` — ${p.chegaEm.split("-").reverse().join("/")}` : ""}.`
                      : ". Sem vendas no período, não dá pra projetar quando chega."}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
