"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import CustoForm from "@/components/custos/CustoForm";
import { fmtBRL, mesAtual, parseBRNumber, totalCustosMes } from "@/lib/domain/calc";
import { COST_CATEGORIA_LABEL, type Cost } from "@/lib/domain/types";
import { ESCOPO_META, FREQUENCIA_META, type Escopo } from "@/lib/domain/custo-form";
import { deleteCost, logAudit, upsertCost } from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { useAccess } from "@/components/tabs/AccessGuard";
import { authedFetch } from "@/lib/api/authed-fetch";

/**
 * Custos — a lista do que a operação e a empresa gastam.
 *
 * ─── O QUE MUDOU, E POR QUÊ ─────────────────────────────────────────────
 *
 * Cada custo era um bloco de SETE campos abertos, todos editáveis, gravando a
 * cada tecla. Com três custos a aba virava um formulário sem fim, e não havia
 * como bater o olho e responder "quanto eu gasto por mês e com o quê".
 *
 * Agora a lista é pra LER: uma linha por custo, com quanto ele pesa no mês. A
 * edição acontece num formulário separado, com botão de salvar — ver
 * components/custos/CustoForm.tsx.
 *
 * A lista também se divide em dois grupos, custo da operação e despesa da
 * empresa. Essa diferença decide se o custo mexe no lucro do Dashboard, e
 * antes ela vivia num select dentro de cada bloco, explicada num quadro no
 * topo da página. Agrupada, ela aparece sozinha.
 */

type Aviso = { tipo: "ok" | "erro"; texto: string };
type Edicao = { custo: Cost | null; escopo: Escopo };

/**
 * Quanto um custo pesa no mês corrente.
 *
 * `totalCustosMes`, e não uma conta própria: a versão anterior tinha a sua
 * (com `parseFloat` e comparação de mês diferente pro avulso), e a soma das
 * linhas podia não bater com o total exibido logo acima delas.
 */
function pesoNoMes(c: Cost): number {
  return totalCustosMes([c], mesAtual());
}

function sufixoDaFrequencia(c: Cost): string {
  if (c.freq === "diario") return "por dia";
  if (c.freq === "mensal") return "por mês";
  const [y, m, d] = String(c.data ?? "").split("-");
  return d ? `em ${d}/${m}/${y}` : "uma vez";
}

export default function CustosTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("custos");
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [mostrarArquivados, setMostrarArquivados] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const timerAviso = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * A confirmação de que deu certo — que a aba antiga nunca dava. Some sozinha
   * depois de uns segundos quando é sucesso; erro fica até a próxima ação,
   * porque erro que some antes de ser lido é o mesmo que erro engolido.
   */
  function avisar(a: Aviso) {
    if (timerAviso.current) clearTimeout(timerAviso.current);
    setAviso(a);
    if (a.tipo === "ok") timerAviso.current = setTimeout(() => setAviso(null), 4000);
  }
  useEffect(() => () => { if (timerAviso.current) clearTimeout(timerAviso.current); }, []);

  // Arquivado (ativo:false) para de contar em tudo — mesmo filtro que a rota
  // de métricas aplica, senão "Arquivar" não significaria nada.
  const ativos = data.costs.filter((c) => c.ativo !== false);
  const arquivados = data.costs.filter((c) => c.ativo === false);
  const daOperacao = ativos.filter((c) => (c.escopo ?? "dash") === "dash");
  const daEmpresa = ativos.filter((c) => c.escopo === "dre");
  const totalOperacao = totalCustosMes(daOperacao, mesAtual());
  const totalEmpresa = totalCustosMes(daEmpresa, mesAtual());

  // Contexto: quanto os custos da operação comem do faturamento e do lucro do
  // mês. Mesma rota que o Dashboard usa.
  const [ref, setRef] = useState<{ faturamentoLiquido: number; lucroSemCustos: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    authedFetch(`/api/ml/metrics?month=${mesAtual()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j) setRef({ faturamentoLiquido: j.faturamentoLiquido ?? 0, lucroSemCustos: j.lucroSemCustos ?? 0 });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  const pctFaturamento = ref && ref.faturamentoLiquido > 0 ? (totalOperacao / ref.faturamentoLiquido) * 100 : null;
  const pctLucro = ref && ref.lucroSemCustos > 0 ? (totalOperacao / ref.lucroSemCustos) * 100 : null;
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date());

  async function arquivar(c: Cost, ativo: boolean) {
    try {
      await upsertCost(uid, { ...c, ativo });
      logAudit({
        acao: ativo ? "reativar" : "arquivar", entidade: "custo", entidadeId: c.id, entidadeLabel: c.nome || "(sem nome)",
      }).catch(() => {});
      avisar({ tipo: "ok", texto: ativo ? `"${c.nome}" voltou a contar.` : `"${c.nome}" arquivado — parou de contar.` });
    } catch (err) {
      avisar({ tipo: "erro", texto: `Não consegui ${ativo ? "reativar" : "arquivar"}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function excluir(c: Cost) {
    if (!confirm(`Excluir "${c.nome || "este custo"}" de vez? Não dá pra desfazer — arquivar mantém o histórico.`)) return;
    try {
      await deleteCost(uid, c.id);
      logAudit({ acao: "excluir", entidade: "custo", entidadeId: c.id, entidadeLabel: c.nome || "(sem nome)" }).catch(() => {});
      avisar({ tipo: "ok", texto: `"${c.nome}" excluído.` });
    } catch (err) {
      avisar({ tipo: "erro", texto: `Não consegui excluir: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const abrirNovo = (escopo: Escopo) => setEdicao({ custo: null, escopo });
  const abrirEdicao = (c: Cost) => setEdicao({ custo: c, escopo: c.escopo ?? "dash" });

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">Custos</h2>
          <span className="tab-head-sub">{ativos.length} ativo(s) · valores de {nomeMes}</span>
        </div>
        {canEdit && (
          <div className="tab-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => abrirNovo("dash")}>
              ＋ Novo custo
            </button>
          </div>
        )}
      </div>

      {/* Quatro números, cada um respondendo uma pergunta. Eram seis, e
          "custo fixo por dia" e "mensais fixos" ao lado de "impacto no mês"
          obrigavam a somar de cabeça pra achar o total. */}
      <div className="kpi-grid">
        <div className="kpi k-neg">
          <div className="k-lbl">Pesa no lucro do mês</div>
          <div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalOperacao)}</div>
          <div className="k-sub">{daOperacao.length} custo(s) da operação</div>
        </div>
        <div className="kpi k-acc">
          <div className="k-lbl">Só na DRE</div>
          <div className="k-val" style={{ color: daEmpresa.length ? "var(--text)" : "var(--muted)" }}>{fmtBRL(totalEmpresa)}</div>
          <div className="k-sub">{daEmpresa.length} despesa(s) da empresa</div>
        </div>
        <div className="kpi k-warn">
          <div className="k-lbl">% do faturamento</div>
          <div className="k-val" style={{ color: "var(--yellow)" }}>{pctFaturamento != null ? `${pctFaturamento.toFixed(1)}%` : "—"}</div>
          <div className="k-sub">custos da operação ÷ faturamento do mês</div>
        </div>
        <div className="kpi k-neg">
          <div className="k-lbl">% do lucro</div>
          <div className="k-val" style={{ color: "var(--red)" }}>{pctLucro != null ? `${pctLucro.toFixed(1)}%` : "—"}</div>
          <div className="k-sub">quanto do lucro, antes deles, eles consomem</div>
        </div>
      </div>

      {aviso && (
        <div className={`note ${aviso.tipo === "ok" ? "note-accent" : "note-danger"}`} role={aviso.tipo === "erro" ? "alert" : "status"}>
          {aviso.tipo === "ok" ? "✓ " : ""}{aviso.texto}
        </div>
      )}

      {!canEdit && (
        <div className="note">Você pode ver os custos, mas não tem permissão pra editar.</div>
      )}

      {ativos.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <span className="empty-ico">💸</span>
            Nenhum custo cadastrado ainda.
            {canEdit && (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => abrirNovo("dash")}>
                  ＋ Cadastrar o primeiro custo
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <GrupoCustos
            escopo="dash" custos={daOperacao} total={totalOperacao} canEdit={canEdit}
            onNovo={abrirNovo} onEditar={abrirEdicao} onArquivar={arquivar} onExcluir={excluir}
          />
          <GrupoCustos
            escopo="dre" custos={daEmpresa} total={totalEmpresa} canEdit={canEdit}
            onNovo={abrirNovo} onEditar={abrirEdicao} onArquivar={arquivar} onExcluir={excluir}
          />
        </>
      )}

      {arquivados.length > 0 && (
        <div className="panel">
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMostrarArquivados((v) => !v)}>
            {mostrarArquivados ? "▾ Ocultar" : "▸ Mostrar"} arquivados ({arquivados.length})
          </button>
          {mostrarArquivados && (
            <div className="list-stack" style={{ marginTop: 12 }}>
              {arquivados.map((c) => (
                <LinhaCusto
                  key={c.id} custo={c} canEdit={canEdit}
                  onEditar={abrirEdicao} onArquivar={arquivar} onExcluir={excluir}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {edicao && (
        <Modal open onClose={() => setEdicao(null)}>
          <CustoForm
            inicial={edicao.custo}
            escopoPadrao={edicao.escopo}
            onCancelar={() => setEdicao(null)}
            onSalvo={(c) => {
              setEdicao(null);
              avisar({ tipo: "ok", texto: edicao.custo ? `"${c.nome}" atualizado.` : `"${c.nome}" cadastrado.` });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function GrupoCustos({ escopo, custos, total, canEdit, onNovo, onEditar, onArquivar, onExcluir }: {
  escopo: Escopo;
  custos: Cost[];
  total: number;
  canEdit: boolean;
  onNovo: (escopo: Escopo) => void;
  onEditar: (c: Cost) => void;
  onArquivar: (c: Cost, ativo: boolean) => void;
  onExcluir: (c: Cost) => void;
}) {
  const meta = ESCOPO_META[escopo];
  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 4 }}>
        <span className="panel-title">{escopo === "dash" ? "Custos da operação" : "Despesas da empresa"}</span>
        <span className="panel-sub">{fmtBRL(total)} no mês</span>
      </div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 12 }}>{meta.explica}</div>

      {custos.length === 0 ? (
        <div style={{ fontSize: ".84rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Nenhum cadastrado.
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onNovo(escopo)}>
              ＋ Adicionar {escopo === "dash" ? "custo da operação" : "despesa da empresa"}
            </button>
          )}
        </div>
      ) : (
        <div className="list-stack">
          {custos.map((c) => (
            <LinhaCusto
              key={c.id} custo={c} canEdit={canEdit}
              onEditar={onEditar} onArquivar={onArquivar} onExcluir={onExcluir}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaCusto({ custo: c, canEdit, onEditar, onArquivar, onExcluir }: {
  custo: Cost;
  canEdit: boolean;
  onEditar: (c: Cost) => void;
  onArquivar: (c: Cost, ativo: boolean) => void;
  onExcluir: (c: Cost) => void;
}) {
  const arquivado = c.ativo === false;
  const peso = arquivado ? 0 : pesoNoMes(c);
  return (
    <div className="list-row" style={{ padding: "12px 14px", opacity: arquivado ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{c.nome || "(sem nome)"}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4, fontSize: ".72rem", color: "var(--muted)" }}>
            <span className="chip">{FREQUENCIA_META[c.freq]?.rotulo ?? c.freq}</span>
            {c.categoria && <span className="chip">{COST_CATEGORIA_LABEL[c.categoria]}</span>}
            {c.centroCusto && <span>{c.centroCusto}</span>}
            {c.observacao && <span>· {c.observacao}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {fmtBRL(parseBRNumber(c.valor))}{" "}
            <span style={{ fontWeight: 400, fontSize: ".74rem", color: "var(--muted)" }}>{sufixoDaFrequencia(c)}</span>
          </div>
          <div style={{ fontSize: ".74rem", color: arquivado ? "var(--muted)" : "var(--red)", whiteSpace: "nowrap" }}>
            {arquivado ? "arquivado — não conta" : `pesa ${fmtBRL(peso)} no mês`}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="row-actions" style={{ marginTop: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onEditar(c)}>Editar</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onArquivar(c, arquivado)}>
            {arquivado ? "Reativar" : "Arquivar"}
          </button>
          <button type="button" className="btn btn-danger btn-xs" onClick={() => onExcluir(c)}>Excluir</button>
        </div>
      )}
    </div>
  );
}
