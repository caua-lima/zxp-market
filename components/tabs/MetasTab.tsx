"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { fmtBRL, formatMesBR, mesAtual, diasNoMes, diaAtualNoMes, projetarMes, scenariosDeProjecao } from "@/lib/domain/calc";
import type { GoalEntry } from "@/lib/domain/types";
import {
  deleteGoalEntry,
  logAudit,
  saveGoalEntry,
  updateGoalEntry,
} from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { useAccess } from "@/components/tabs/AccessGuard";
import { authedFetch } from "@/lib/api/authed-fetch";
import { getRevenuePaceLabel, getRevenuePaceStatus, selectActiveGoal } from "@/lib/domain/gauge";
import { calcularMetaDiaria, idealAteHoje } from "@/lib/domain/meta-diaria";

type MetricsAtivo = { faturamentoLiquido: number; lucroComCustos: number; margemComCustos: number; faturamentoHoje: number };

const TONE_COLOR: Record<string, string> = {
  success: "var(--success,var(--green))", warning: "var(--warning,#F4B942)",
  danger: "var(--danger,var(--red))", neutral: "var(--brand,var(--accent))",
};

export default function MetasTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("metas");
  const [openNew, setOpenNew] = useState(false);
  const [editEntry, setEditEntry] = useState<GoalEntry | null>(null);

  // Histórico visual (meta vs realizado vs margem) — busca o resultado de
  // CADA mês com meta cadastrada, uma vez só por mês (cache no state, nunca
  // refaz pro mesmo mês). Meses futuros/sem venda ainda voltam 0, o que é
  // correto: ainda não tem realizado.
  const [historico, setHistorico] = useState<Record<string, { faturamentoLiquido: number; margemComCustos: number } | null>>({});
  useEffect(() => {
    const meses = Array.from(new Set(data.goalEntries.map((e) => e.mes))).filter((m) => !(m in historico));
    if (meses.length === 0) return;
    let vivo = true;
    Promise.all(
      meses.map((m) =>
        authedFetch(`/api/ml/metrics?month=${m}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => [m, j ? { faturamentoLiquido: j.faturamentoLiquido ?? 0, margemComCustos: j.margemComCustos ?? 0 } : null] as const)
          .catch(() => [m, null] as const),
      ),
    ).then((entries) => {
      if (!vivo) return;
      setHistorico((prev) => {
        const next = { ...prev };
        for (const [m, v] of entries) next[m] = v;
        return next;
      });
    });
    return () => { vivo = false; };
  }, [data.goalEntries, historico]);

  // Current month's active entry (first one matching current month, or latest)
  const activeEntry = useMemo<GoalEntry | null>(() => {
    const mes = mesAtual();
    return (
      data.goalEntries.find((e) => e.mes === mes) ??
      data.goalEntries[0] ??
      null
    );
  }, [data.goalEntries]);

  // Progresso real (faturamento/lucro do mês da meta ativa) — mesma rota que
  // o Dashboard já usa, só filtrando pelo mês da meta em vez do período livre.
  const [metricsAtivo, setMetricsAtivo] = useState<MetricsAtivo | null>(null);
  useEffect(() => {
    if (!activeEntry) { setMetricsAtivo(null); return; }
    let vivo = true;
    authedFetch(`/api/ml/metrics?month=${activeEntry.mes}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j) setMetricsAtivo({ faturamentoLiquido: j.faturamentoLiquido ?? 0, lucroComCustos: j.lucroComCustos ?? 0, margemComCustos: j.margemComCustos ?? 0, faturamentoHoje: j.faturamentoHoje ?? 0 }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [activeEntry]);

  // Ritmo/projeção só fazem sentido pro mês que está EM ANDAMENTO — meta de
  // mês passado já fechou, não tem "dia atual" nem "dias restantes" reais.
  const isMesAtualAtivo = activeEntry?.mes === mesAtual();
  const diaAtual = diaAtualNoMes();
  const totalDiasAtivo = activeEntry ? diasNoMes(activeEntry.mes) : 30;
  const diasRestantesAtivo = Math.max(totalDiasAtivo - diaAtual + 1, 1);

  /**
   * Meta diária adaptativa — MESMA função do Dashboard
   * (lib/domain/meta-diaria.ts). Era código duplicado aqui, e a cópia
   * carregava o mesmo bug: perseguia `meta1` fixo, então zerava assim que a
   * primeira meta era batida, mesmo com a meta vigente ainda longe.
   */
  const { diaria: metaDiariaAtiva, plana: metaDiariaPlana } = useMemo(() => {
    if (!activeEntry) return { diaria: null, plana: null };
    const fat = metricsAtivo?.faturamentoLiquido ?? 0;
    const { activeMeta } = selectActiveGoal(fat, activeEntry.meta1, activeEntry.meta2, activeEntry.meta3);
    return calcularMetaDiaria({
      metaAtiva: activeMeta,
      faturamentoMes: fat,
      faturamentoHoje: metricsAtivo?.faturamentoHoje ?? 0,
      diasRestantes: isMesAtualAtivo && metricsAtivo ? diasRestantesAtivo : null,
      diasNoMes: totalDiasAtivo,
    });
  }, [activeEntry, metricsAtivo, isMesAtualAtivo, diasRestantesAtivo, totalDiasAtivo]);

  const metasProgresso = useMemo(() => {
    if (!activeEntry || !metricsAtivo) return [];
    const fat = metricsAtivo.faturamentoLiquido;
    return ([
      { idx: 1, valor: activeEntry.meta1 },
      { idx: 2, valor: activeEntry.meta2 },
      { idx: 3, valor: activeEntry.meta3 },
    ] as { idx: number; valor: number | null }[])
      .filter((m): m is { idx: number; valor: number } => !!m.valor && m.valor > 0)
      .map((m) => {
        const idealDia = isMesAtualAtivo ? idealAteHoje(m.valor, diaAtual, totalDiasAtivo) : m.valor;
        const tone = getRevenuePaceStatus(fat, m.valor, idealDia);
        const falta = Math.max(m.valor - fat, 0);
        return {
          idx: m.idx, valor: m.valor, tone,
          label: getRevenuePaceLabel(fat, m.valor, tone),
          falta,
          ritmoDia: isMesAtualAtivo && falta > 0 ? falta / diasRestantesAtivo : null,
          projecao: isMesAtualAtivo ? projetarMes(fat, diaAtual, totalDiasAtivo) : fat,
          pctReal: (fat / m.valor) * 100,
        };
      });
  }, [activeEntry, metricsAtivo, isMesAtualAtivo, diaAtual, totalDiasAtivo, diasRestantesAtivo]);

  const lucroProgresso = useMemo(() => {
    if (!activeEntry?.metaLucro || !metricsAtivo) return null;
    const meta = activeEntry.metaLucro;
    const lucro = metricsAtivo.lucroComCustos;
    const idealDia = isMesAtualAtivo ? idealAteHoje(meta, diaAtual, totalDiasAtivo) : meta;
    const tone = getRevenuePaceStatus(lucro, meta, idealDia);
    return {
      meta, lucro, tone,
      label: getRevenuePaceLabel(lucro, meta, tone),
      falta: Math.max(meta - lucro, 0),
      pctReal: (lucro / meta) * 100,
    };
  }, [activeEntry, metricsAtivo, isMesAtualAtivo, diaAtual, totalDiasAtivo]);

  // Cenários só fazem sentido no mês em andamento — mês fechado já tem o
  // resultado real, não uma projeção.
  const cenarios = useMemo(() => {
    if (!activeEntry || !metricsAtivo || !isMesAtualAtivo) return null;
    const { activeMeta } = selectActiveGoal(metricsAtivo.faturamentoLiquido, activeEntry.meta1, activeEntry.meta2, activeEntry.meta3);
    return { ...scenariosDeProjecao(metricsAtivo.faturamentoLiquido, diaAtual, totalDiasAtivo), activeMeta };
  }, [activeEntry, metricsAtivo, isMesAtualAtivo, diaAtual, totalDiasAtivo]);

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left"><h2 className="tab-title">Definição de Metas</h2></div>
        {canEdit && (
          <div className="tab-actions">
            <button type="button" className="btn btn-purple btn-sm" onClick={() => setOpenNew(true)}>＋ Nova Meta</button>
          </div>
        )}
      </div>

      {/* Resumo da meta ativa */}
      {activeEntry && (
        <>
          <div className="panel-head" style={{ marginBottom: -4 }}>
            <span className="panel-title">Meta ativa — {formatMesBR(activeEntry.mes)}</span>
            <span className="panel-sub">acompanhamento (velocímetros) no Dashboard</span>
          </div>
          <div className="kpi-grid">
            <div className="kpi k-acc"><div className="k-lbl">Meta 1</div><div className="k-val">{fmtBRL(activeEntry.meta1)}</div><div className="k-sub">objetivo principal</div></div>
            <div className="kpi k-warn"><div className="k-lbl">Meta 2</div><div className="k-val" style={{ color: "var(--yellow)" }}>{activeEntry.meta2 ? fmtBRL(activeEntry.meta2) : "—"}</div></div>
            <div className="kpi" style={{ borderLeft: "3px solid var(--purple)" }}><div className="k-lbl">Meta 3</div><div className="k-val" style={{ color: "var(--purple)" }}>{activeEntry.meta3 ? fmtBRL(activeEntry.meta3) : "—"}</div></div>
            <div className="kpi k-acc">
              <div className="k-lbl">Meta diária</div>
              <div className="k-val">{fmtBRL(metaDiariaAtiva ?? metaDiariaPlana ?? 0)}</div>
              <div className="k-sub">
                {isMesAtualAtivo && metaDiariaAtiva != null && metaDiariaPlana != null && Math.abs(metaDiariaAtiva - metaDiariaPlana) > 0.5
                  ? `ajustada pelo ritmo · plana seria ${fmtBRL(metaDiariaPlana)}`
                  : `Meta 1 ÷ ${diasNoMes(activeEntry.mes)} dias`}
              </div>
            </div>
            <div className="kpi k-pos"><div className="k-lbl">Margem alvo</div><div className="k-val" style={{ color: "var(--green)" }}>{activeEntry.metaMargem ?? 10}%</div><div className="k-sub">lucro líquido</div></div>
          </div>

          {metasProgresso.length > 0 && (
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 12 }}>Progresso — {formatMesBR(activeEntry.mes)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {metasProgresso.map((m) => (
                  <div key={m.idx}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: ".85rem" }}>Meta {m.idx}</span>
                      <span className="severity-chip" style={{ color: TONE_COLOR[m.tone], background: "transparent", border: `1px solid ${TONE_COLOR[m.tone]}` }}>{m.label}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--surface-raised,var(--surface2))", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, m.pctReal))}%`, background: TONE_COLOR[m.tone], transition: "width .3s ease" }} />
                    </div>
                    <div style={{ fontSize: ".76rem", color: "var(--text-secondary,var(--muted))", marginTop: 5 }}>
                      {m.pctReal.toFixed(0)}% de {fmtBRL(m.valor)}
                      {m.falta > 0 ? (
                        <> · faltam <b style={{ color: "var(--text-primary,var(--text))" }}>{fmtBRL(m.falta)}</b>
                          {m.ritmoDia != null && <> · precisa de {fmtBRL(m.ritmoDia)}/dia</>}
                          {isMesAtualAtivo && <> · projeção {fmtBRL(m.projecao)}</>}
                        </>
                      ) : " · meta batida"}
                    </div>
                  </div>
                ))}
                {lucroProgresso && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: ".85rem" }}>Meta de lucro</span>
                      <span className="severity-chip" style={{ color: TONE_COLOR[lucroProgresso.tone], background: "transparent", border: `1px solid ${TONE_COLOR[lucroProgresso.tone]}` }}>{lucroProgresso.label}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--surface-raised,var(--surface2))", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, lucroProgresso.pctReal))}%`, background: TONE_COLOR[lucroProgresso.tone], transition: "width .3s ease" }} />
                    </div>
                    <div style={{ fontSize: ".76rem", color: "var(--text-secondary,var(--muted))", marginTop: 5 }}>
                      {fmtBRL(lucroProgresso.lucro)} de {fmtBRL(lucroProgresso.meta)}
                      {lucroProgresso.falta > 0 && <> · faltam <b style={{ color: "var(--text-primary,var(--text))" }}>{fmtBRL(lucroProgresso.falta)}</b></>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {cenarios && (
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 2 }}>Cenários de fechamento — {formatMesBR(activeEntry.mes)}</div>
              <div className="panel-sub" style={{ marginBottom: 12 }}>
                Mesmo ritmo atual ±15% pelo resto do mês — não é previsão estatística, só uma noção de sensibilidade.
              </div>
              <div className="kpi-grid">
                {([
                  { label: "Conservador", valor: cenarios.conservador, sub: "ritmo 15% mais fraco", cor: "var(--red)" },
                  { label: "Esperado", valor: cenarios.esperado, sub: "no ritmo atual", cor: "var(--accent)" },
                  { label: "Agressivo", valor: cenarios.agressivo, sub: "ritmo 15% mais forte", cor: "var(--green)" },
                ] as const).map((c) => (
                  <div key={c.label} className="kpi">
                    <div className="k-lbl">{c.label}</div>
                    <div className="k-val" style={{ color: c.cor }}>{fmtBRL(c.valor)}</div>
                    <div className="k-sub">
                      {c.sub}
                      {cenarios.activeMeta > 0 && (c.valor >= cenarios.activeMeta ? " · bate a meta" : ` · faltariam ${fmtBRL(cenarios.activeMeta - c.valor)}`)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="note note-purple">
        Defina as metas de faturamento e a margem de lucro líquido alvo. A <strong>meta diária</strong> sai automática (Meta 1 ÷ dias do mês) e o acompanhamento com velocímetros aparece no Dashboard.
      </div>

      {data.goalEntries.length > 0 && (
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 12 }}>Histórico — meta vs realizado</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[...data.goalEntries]
              .sort((a, b) => b.mes.localeCompare(a.mes))
              .map((entry) => {
                const realizado = historico[entry.mes];
                const meta = entry.meta1;
                const pct = realizado && meta > 0 ? (realizado.faturamentoLiquido / meta) * 100 : null;
                const margemMeta = entry.metaMargem ?? 10;
                const margemOk = realizado != null && realizado.margemComCustos >= margemMeta;
                return (
                  <div key={entry.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: ".85rem", textTransform: "capitalize" }}>{formatMesBR(entry.mes)}</span>
                      {realizado == null ? (
                        <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>carregando…</span>
                      ) : (
                        <span
                          className="severity-chip"
                          style={{
                            color: margemOk ? "var(--green)" : "var(--red)",
                            background: "transparent",
                            border: `1px solid ${margemOk ? "var(--green)" : "var(--red)"}`,
                          }}
                        >
                          margem {realizado.margemComCustos.toFixed(1)}% (meta {margemMeta}%)
                        </span>
                      )}
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--surface-raised,var(--surface2))", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, Math.max(0, pct ?? 0))}%`,
                          background: pct != null && pct >= 100 ? "var(--green)" : "var(--accent)",
                          transition: "width .3s ease",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: ".76rem", color: "var(--text-secondary,var(--muted))", marginTop: 5 }}>
                      {realizado == null
                        ? `meta ${fmtBRL(meta)}`
                        : `${fmtBRL(realizado.faturamentoLiquido)} de ${fmtBRL(meta)} (${(pct ?? 0).toFixed(0)}%)`}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 14 }}>Metas cadastradas</div>
        {data.goalEntries.length === 0 ? (
          <div className="empty-state">
            <span className="empty-ico">🎯</span>
            Nenhuma meta definida.<br />Clique em <strong>＋ Nova Meta</strong>.
          </div>
        ) : (
          <div className="list-stack">
            {data.goalEntries.map((entry) => (
              <GoalEntryRow
                key={entry.id}
                entry={entry}
                isActive={entry.id === activeEntry?.id}
                canEdit={canEdit}
                onEdit={() => setEditEntry(entry)}
                onDelete={() => {
                  if (!confirm("Remover esta meta?")) return;
                  deleteGoalEntry(uid, entry.id).catch(() => {});
                  logAudit({ acao: "excluir", entidade: "meta", entidadeId: entry.id, entidadeLabel: formatMesBR(entry.mes) }).catch(() => {});
                }}
              />
            ))}
          </div>
        )}
      </div>

      {openNew && <GoalEntryModal uid={uid} entry={null} open onClose={() => setOpenNew(false)} />}
      {editEntry && <GoalEntryModal uid={uid} entry={editEntry} open onClose={() => setEditEntry(null)} />}
    </div>
  );
}

function GoalEntryRow({
  entry,
  isActive,
  canEdit,
  onEdit,
  onDelete,
}: {
  entry: GoalEntry;
  isActive: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const chip = (label: string, valor: number | null, cor: string) =>
    valor ? (
      <span className="chip" style={{ background: `${cor}1f`, borderColor: cor, color: cor }}>
        <span style={{ opacity: .7, fontWeight: 600 }}>{label}</span> {fmtBRL(valor)}
      </span>
    ) : null;

  return (
    <div className={`list-row list-row-split${isActive ? " is-active" : ""}`}>
      <div className="list-row-main">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: ".95rem", textTransform: "capitalize" }}>{formatMesBR(entry.mes)}</span>
          {isActive && <span className="chip" style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", fontSize: ".66rem" }}>ATIVA</span>}
          {entry.label && <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>· {entry.label}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {chip("Meta 1", entry.meta1, "#E9A92D")}
          {chip("Meta 2", entry.meta2, "#F4B942")}
          {chip("Meta 3", entry.meta3, "#F4B942")}
          <span className="chip chip-green">margem {entry.metaMargem ?? 10}%</span>
        </div>
      </div>
      {canEdit && (
        <div className="row-actions">
          <button type="button" className="btn btn-warning btn-xs" onClick={onEdit}>Editar</button>
          <button type="button" className="btn btn-danger btn-xs" onClick={onDelete}>Excluir</button>
        </div>
      )}
    </div>
  );
}

function GoalEntryModal({
  uid,
  entry,
  open,
  onClose,
}: {
  uid: string;
  entry: GoalEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const [mes, setMes] = useState(entry ? entry.mes : mesAtual());
  const [m1, setM1] = useState(entry?.meta1 ? String(entry.meta1) : "");
  const [m2, setM2] = useState(entry?.meta2 ? String(entry.meta2) : "");
  const [m3, setM3] = useState(entry?.meta3 ? String(entry.meta3) : "");
  const [margem, setMargem] = useState(entry?.metaMargem != null ? String(entry.metaMargem) : "10");
  const [metaLucro, setMetaLucro] = useState(entry?.metaLucro != null ? String(entry.metaLucro) : "");
  const [label, setLabel] = useState(entry?.label ?? "");

  async function onSave() {
    const v1 = parseFloat(m1) || 0;
    if (!v1) { alert("Informe pelo menos a Meta 1."); return; }
    const newEntry: GoalEntry = {
      id: entry?.id || `goal_${Date.now()}`,
      mes: mes || mesAtual(),
      meta1: v1,
      meta2: parseFloat(m2) || null,
      meta3: parseFloat(m3) || null,
      metaMargem: parseFloat(margem) || 10,
      metaLucro: parseFloat(metaLucro) || null,
      // meta diária é derivada automaticamente da meta mensal (meta1 / dias)
      metaDiaria: null,
      meta2Diaria: null,
      meta3Diaria: null,
      // Firebase setDoc não aceita undefined em campos — usar null para ausência
      label: label || undefined,
    };
    if (entry) {
      await updateGoalEntry(uid, entry.id, newEntry);
      logAudit({ acao: "editar", entidade: "meta", entidadeId: entry.id, entidadeLabel: formatMesBR(newEntry.mes) }).catch(() => {});
    } else {
      await saveGoalEntry(uid, newEntry);
      logAudit({ acao: "criar", entidade: "meta", entidadeId: newEntry.id, entidadeLabel: formatMesBR(newEntry.mes) }).catch(() => {});
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-title">
        {entry ? "Editar Meta" : "Nova Meta"}
      </div>

      <div className="config-field">
        <label>Mês / Ano</label>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>

      <div className="config-field">
        <label>Nome da meta principal (opcional)</label>
        <input
          type="text"
          placeholder="Ex: Objetivo Principal, Meta agressiva…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="hint">Aparece no card principal e no histórico desta meta</div>
      </div>

      <hr className="config-sep" />
      <div className="config-section-title">Metas Mensais de Faturamento</div>

      <div className="config-field">
        <label>Meta 1 — Objetivo Principal (R$)</label>
        <input type="number" min="0" step="100" placeholder="Ex: 15000" value={m1} onChange={(e) => setM1(e.target.value)} />
      </div>
      <div className="config-field">
        <label>Meta 2 (opcional, R$)</label>
        <input type="number" min="0" step="100" placeholder="Ex: 20000" value={m2} onChange={(e) => setM2(e.target.value)} />
      </div>
      <div className="config-field">
        <label>Meta 3 (opcional, R$)</label>
        <input type="number" min="0" step="100" placeholder="Ex: 25000" value={m3} onChange={(e) => setM3(e.target.value)} />
      </div>

      <hr className="config-sep" />
      <div className="config-section-title">Meta de Lucro Líquido</div>

      <div className="config-field">
        <label>Margem de lucro líquido alvo (%)</label>
        <input type="number" min="0" step="0.5" placeholder="10" value={margem} onChange={(e) => setMargem(e.target.value)} />
        <div className="hint">
          Padrão 10%. A meta diária é calculada automaticamente pela meta mensal (Meta 1 ÷ dias do mês).
        </div>
      </div>

      <div className="config-field">
        <label>Meta de lucro líquido (opcional, R$)</label>
        <input type="number" min="0" step="100" placeholder="Ex: 1500" value={metaLucro} onChange={(e) => setMetaLucro(e.target.value)} />
        <div className="hint">
          Independente da margem % — bater a meta de faturamento com margem OK não garante bater esta meta em reais. Deixe em branco pra não acompanhar.
        </div>
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={onSave}>
          Salvar Meta
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
