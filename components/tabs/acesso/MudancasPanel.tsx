"use client";

import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import {
  TIPO_META,
  agruparPorDia,
  diaPorExtenso,
  resumir,
  type Mudanca,
  type TipoMudanca,
} from "@/lib/domain/mudancas";

/**
 * O histórico de mudanças do próprio sistema — ao lado da trilha de auditoria.
 *
 * ─── POR QUE AQUI, JUNTO DA AUDITORIA ───────────────────────────────────
 *
 * São a mesma pergunta em dois níveis: "o que mudou e quando". A auditoria
 * cobre o que se mexe nos DADOS (um custo criado, um acesso trocado); esta
 * lista cobre o que se mexe no SISTEMA — a correção de um número errado, uma
 * tela nova, um teste que trava um comportamento.
 *
 * Esse segundo trabalho é invisível pra quem não escreve o código, e costuma
 * ser a maior parte dele. Separar em outra aba faria parecer assunto de
 * desenvolvedor; juntas, as duas contam a história completa do mês.
 */

type Resposta = {
  repo?: string;
  branch?: string;
  truncado?: boolean;
  autenticado?: boolean;
  mudancas?: Mudanca[];
  erro?: string;
  status?: number;
  detalhe?: string;
};

const ORDEM_TIPOS: TipoMudanca[] = ["recurso", "correcao", "refino", "teste", "documentacao", "manutencao", "outro"];

/** Quantas linhas antes do botão "ver mais" — o suficiente pra dar o tom. */
const PASSO = 40;

export default function MudancasPanel() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [limite, setLimite] = useState(PASSO);
  const [filtro, setFiltro] = useState<TipoMudanca | "todos">("todos");

  useEffect(() => {
    let vivo = true;
    authedFetch("/api/mudancas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Resposta) => { if (vivo) { setDados(j); setCarregando(false); } })
      .catch((e: unknown) => {
        if (vivo) {
          setDados({ erro: "falha_local", detalhe: e instanceof Error ? e.message : String(e) });
          setCarregando(false);
        }
      });
    return () => { vivo = false; };
  }, []);

  const todas = useMemo(() => dados?.mudancas ?? [], [dados]);
  const hoje = useMemo(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()), []);
  const resumo = useMemo(() => resumir(todas, hoje), [todas, hoje]);

  const filtradas = useMemo(
    () => (filtro === "todos" ? todas : todas.filter((m) => m.tipo === filtro)),
    [todas, filtro],
  );
  const dias = useMemo(() => agruparPorDia(filtradas.slice(0, limite)), [filtradas, limite]);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 4 }}>
        <span className="panel-title">Mudanças no sistema</span>
        <span className="panel-sub">
          {carregando ? "carregando…" : `${resumo.total.toLocaleString("pt-BR")} publicadas`}
        </span>
      </div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 14 }}>
        Cada linha é uma mudança que entrou no ar, com data e hora. Enquanto a trilha
        de auditoria registra o que se mexe nos <b>dados</b>, esta lista registra o que
        se mexe no <b>sistema</b> — a correção de um número, uma tela nova, um teste que
        trava um comportamento pra não voltar a quebrar.
      </div>

      {carregando ? (
        <div style={{ color: "var(--muted)", fontSize: ".9rem" }}>Carregando o histórico…</div>
      ) : dados?.erro ? (
        <div className="note note-warn">
          <b>Não consegui ler o histórico do repositório.</b>{" "}
          {dados.erro === "limite_github"
            ? <>O GitHub limita 60 consultas por hora sem credencial e o limite foi atingido —
              costuma liberar sozinho em minutos. Pra não acontecer de novo, dá pra criar um
              token de leitura no GitHub e gravar como <code>GITHUB_TOKEN</code>.</>
            : <>Verifique se o repositório <code>{dados.repo ?? "—"}</code> existe e está
              acessível.</>}
          {dados.detalhe && (
            <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: ".7rem", overflowWrap: "anywhere" }}>
              {dados.detalhe}
            </div>
          )}
        </div>
      ) : todas.length === 0 ? (
        <div className="empty-state"><span className="empty-ico">🧾</span>Nenhuma mudança encontrada.</div>
      ) : (
        <>
          {/* ─── O RESUMO ────────────────────────────────────────────────
              É o que o sócio lê primeiro: o tamanho do trabalho antes do
              detalhe de cada linha. */}
          <div className="kpi-grid" style={{ marginBottom: 14 }}>
            <div className="kpi k-acc">
              <div className="k-lbl">Mudanças publicadas</div>
              <div className="k-val">{resumo.total.toLocaleString("pt-BR")}</div>
              <div className="k-sub">
                {resumo.primeira ? `desde ${resumo.primeira.split("-").reverse().join("/")}` : "—"}
              </div>
            </div>
            <div className="kpi k-pos">
              <div className="k-lbl">Últimos 30 dias</div>
              <div className="k-val" style={{ color: "var(--green)" }}>{resumo.ultimos30.toLocaleString("pt-BR")}</div>
              <div className="k-sub">no mês corrido</div>
            </div>
            <div className="kpi">
              <div className="k-lbl">Dias de trabalho</div>
              <div className="k-val">{resumo.diasAtivos.toLocaleString("pt-BR")}</div>
              {/* Média por dia ATIVO, não por dia corrido — ver resumir(). */}
              <div className="k-sub">
                {resumo.mediaPorDiaAtivo.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mudanças por dia
              </div>
            </div>
            <div className="kpi k-warn">
              <div className="k-lbl">Dia mais forte</div>
              <div className="k-val" style={{ color: "var(--accent)" }}>
                {resumo.diaMaisForte ? resumo.diaMaisForte.quantas : "—"}
              </div>
              <div className="k-sub">
                {resumo.diaMaisForte ? resumo.diaMaisForte.dia.split("-").reverse().join("/") : "sem dados"}
              </div>
            </div>
          </div>

          {/* Filtro por tipo. Também é legenda: cada etiqueta traz o número
              ao lado, então dá pra ler a composição sem clicar em nada. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              className={`btn btn-xs ${filtro === "todos" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => { setFiltro("todos"); setLimite(PASSO); }}
            >
              Todas {resumo.total}
            </button>
            {ORDEM_TIPOS.filter((t) => resumo.porTipo[t] > 0).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn btn-xs ${filtro === t ? "btn-primary" : "btn-ghost"}`}
                title={TIPO_META[t].explica}
                onClick={() => { setFiltro(t); setLimite(PASSO); }}
              >
                <span style={{ color: filtro === t ? undefined : TIPO_META[t].cor }}>●</span>{" "}
                {TIPO_META[t].label} {resumo.porTipo[t]}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {dias.map((d) => (
              <div key={d.dia}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  gap: 8, marginBottom: 5, paddingBottom: 4, borderBottom: "1px solid var(--border)",
                }}>
                  <span style={{ fontSize: ".78rem", fontWeight: 700, textTransform: "capitalize" }}>
                    {diaPorExtenso(d.dia)}
                  </span>
                  <span style={{ fontSize: ".7rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {d.mudancas.length} mudança(s)
                  </span>
                </div>
                <div className="list-stack">
                  {d.mudancas.map((m) => (
                    <div key={m.sha} className="list-row" style={{ padding: "7px 12px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span
                          className="severity-chip"
                          title={TIPO_META[m.tipo].explica}
                          style={{ color: TIPO_META[m.tipo].cor, background: "transparent", border: `1px solid ${TIPO_META[m.tipo].cor}`, cursor: "help" }}
                        >
                          {TIPO_META[m.tipo].label}
                        </span>
                        <span style={{ fontSize: ".85rem", flex: 1, minWidth: 200 }}>{m.descricao}</span>
                      </div>
                      <div style={{ marginTop: 3, fontSize: ".74rem", color: "var(--muted)" }}>
                        {m.hora || "—"}
                        {m.escopo ? ` · ${m.escopo}` : ""}
                        {` · ${m.autor}`}
                        {m.url && (
                          <>
                            {" · "}
                            <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                              ver o código
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {filtradas.length > limite && (
            <button
              type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}
              onClick={() => setLimite((n) => n + PASSO)}
            >
              Ver mais ({(filtradas.length - limite).toLocaleString("pt-BR")} restantes)
            </button>
          )}

          {dados?.truncado && (
            <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)" }}>
              A lista mostra as mudanças mais recentes. Há outras, mais antigas, além do que
              a consulta alcança de uma vez.
            </div>
          )}
        </>
      )}
    </div>
  );
}
