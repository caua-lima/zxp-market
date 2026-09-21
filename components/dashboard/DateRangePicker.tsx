"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  dataBR, dataPorExtenso, hojeNaOperacao, msAteAVirada, presetsDePeriodo, type PresetDePeriodo,
} from "@/lib/domain/periodos";

type Props = {
  from: string;                                   // yyyy-mm-dd
  to: string;                                     // yyyy-mm-dd
  onApply: (from: string, to: string) => void;
};

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const DOW_EXTENSO = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

// ── helpers de data (trabalham em yyyy-mm-dd, sem fuso) ──────────
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function parse(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}
function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const dt = new Date(y, m + delta, 1);
  return { y: dt.getFullYear(), m: dt.getMonth() };
}

/**
 * O "hoje" do seletor: o dia em Brasília, recalculado.
 *
 * Antes os atalhos saíam de um `useMemo(..., [])`: uma aba aberta na virada do
 * dia continuava com o "Hoje" de ontem. Agora `hoje` é estado, e ele muda (a) ao
 * abrir o seletor, (b) quando a aba volta a ficar visível e (c) na virada do dia,
 * por um temporizador até a próxima meia-noite de Brasília.
 */
function useHojeNaOperacao(): [string, () => void] {
  const [hoje, setHoje] = useState(() => hojeNaOperacao());
  const atualizar = () => setHoje((h) => { const n = hojeNaOperacao(); return n === h ? h : n; });

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const agendar = () => {
      t = setTimeout(() => { setHoje(hojeNaOperacao()); agendar(); }, msAteAVirada());
    };
    agendar();
    const aoVoltar = () => { if (document.visibilityState === "visible") setHoje((h) => { const n = hojeNaOperacao(); return n === h ? h : n; }); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, []);

  return [hoje, atualizar];
}

function MonthGrid({
  y, m, draftFrom, draftTo, hoje, onPick,
}: {
  y: number;
  m: number;
  draftFrom: string;
  draftTo: string;
  hoje: string;
  onPick: (day: string) => void;
}) {
  const firstWeekday = new Date(y, m, 1).getDay();       // 0 = domingo
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="drp-cal" role="group" aria-label={`${MONTHS[m]} de ${y}`}>
      <div className="drp-cal-title">{MONTHS[m]} {y}</div>
      <div className="drp-grid">
        {DOW.map((d, i) => <div key={d} className="drp-dow" aria-hidden="true" title={DOW_EXTENSO[i]}>{d}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} className="drp-day muted" />;
          const day = iso(y, m, d);
          const hasRange = !!draftFrom && !!draftTo;
          const inRange = hasRange && day >= draftFrom && day <= draftTo;
          const isFrom = day === draftFrom;
          const isTo = !!draftTo && day === draftTo;
          const cls = ["drp-day"];
          if (inRange) cls.push("in");
          if (isFrom || isTo) cls.push("edge");
          if (day === hoje) cls.push("today");
          // O nome do botão é a data COMPLETA e o estado dela: "18" sozinho não diz mês, ano nem se está escolhida.
          const estado = isFrom && isTo ? ", início e fim" : isFrom ? ", início do período" : isTo ? ", fim do período" : inRange ? ", dentro do período" : "";
          return (
            <button
              key={day} type="button" className={cls.join(" ")} onClick={() => onPick(day)}
              aria-label={`${dataPorExtenso(day)}${day === hoje ? ", hoje" : ""}${estado}`}
              aria-pressed={isFrom || isTo || inRange}
              aria-current={day === hoje ? "date" : undefined}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ from, to, onApply }: Props) {
  const [hoje, atualizarHoje] = useHojeNaOperacao();
  const presets: PresetDePeriodo[] = presetsDePeriodo(hoje);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [view, setView] = useState<{ y: number; m: number }>(() => parse(from)); // mês da esquerda
  const rootRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const titulo = useId();

  function toggle() {
    if (!open) {
      // ao abrir, sincroniza o rascunho com o intervalo atual e reconfere o dia
      atualizarHoje();
      setDraftFrom(from);
      setDraftTo(to);
      setView(parse(from));
    }
    setOpen((o) => !o);
  }

  function fechar() {
    setOpen(false);
    // O foco volta pro botão que abriu: sem isso ele se perde no fim do documento.
    gatilhoRef.current?.focus();
  }

  // Fecha ao clicar fora / Esc — e move o foco pra dentro ao abrir
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); gatilhoRef.current?.focus(); }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const id = requestAnimationFrame(() => popRef.current?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickDay(day: string) {
    // sem início, ou intervalo já completo começa de novo
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(day);
      setDraftTo("");
    } else if (day < draftFrom) {
      setDraftFrom(day);          // clicou antes do início vira o novo início
    } else {
      setDraftTo(day);
    }
  }

  function apply() {
    const f = draftFrom || from;
    const t = draftTo || draftFrom || to;   // um dia só = from
    onApply(f, t);
    fechar();
  }

  function pickPreset(p: PresetDePeriodo) {
    setDraftFrom(p.de);
    setDraftTo(p.ate);
    setView(parse(p.de));
    onApply(p.de, p.ate);
    fechar();
  }

  const activePreset = presets.find((p) => p.de === from && p.ate === to);

  const right = shiftMonth(view.y, view.m, 1);
  const rascunho = draftFrom
    ? `${dataBR(draftFrom)} até ${draftTo ? dataBR(draftTo) : "…"}`
    : "nenhuma data escolhida";

  return (
    <div className="drp" ref={rootRef}>
      <button
        type="button" className="drp-trigger" onClick={toggle} ref={gatilhoRef}
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Período: de ${dataPorExtenso(from)} até ${dataPorExtenso(to)}. Alterar período`}
      >
        <span>{dataBR(from)} <span className="drp-dash">–</span> {dataBR(to)}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div className="drp-pop" role="dialog" aria-labelledby={titulo} ref={popRef}>
          <span id={titulo} className="sr-only">Escolher período</span>
          <div className="drp-presets">
            {presets.map((p) => (
              <button
                key={p.chave}
                type="button"
                className={`drp-preset ${activePreset?.chave === p.chave ? "active" : ""}`}
                aria-pressed={activePreset?.chave === p.chave}
                title={`${dataBR(p.de)} a ${dataBR(p.ate)}`}
                onClick={() => pickPreset(p)}
              >
                {p.rotulo}
              </button>
            ))}
          </div>

          {/* O período em escolha, dito quando muda. Antes era só texto solto. */}
          <div className="drp-foot-label" role="status" aria-live="polite">
            {draftFrom ? dataBR(draftFrom) : "—"} até {draftTo ? dataBR(draftTo) : draftFrom ? "…" : "—"}
            <span className="sr-only"> — escolhido: {rascunho}</span>
          </div>

          <div className="drp-cals">
            <button type="button" className="drp-nav drp-nav-prev" onClick={() => setView(shiftMonth(view.y, view.m, -1))} aria-label="Mês anterior">‹</button>
            <MonthGrid y={view.y} m={view.m} draftFrom={draftFrom} draftTo={draftTo} hoje={hoje} onPick={pickDay} />
            <MonthGrid y={right.y} m={right.m} draftFrom={draftFrom} draftTo={draftTo} hoje={hoje} onPick={pickDay} />
            <button type="button" className="drp-nav drp-nav-next" onClick={() => setView(shiftMonth(view.y, view.m, 1))} aria-label="Próximo mês">›</button>
          </div>

          <div className="drp-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={fechar}>Cancelar</button>
            <button type="button" className="btn btn-sm btn-warning" onClick={apply}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}
