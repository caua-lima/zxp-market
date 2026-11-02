"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import type { Task, TaskPriority } from "@/lib/domain/types";
import { montarSemana, rotuloDaSemana, segundaDaSemana, somarDias } from "@/lib/domain/semana-tarefas";
import s from "./SemanaDeTarefas.module.css";

/**
 * A aba Tarefas como uma agenda da semana (o desenho do dono):
 *
 *   SEG  TER  QUA  QUI
 *   SEX  SÁB  DOM  SEM PRAZO
 *   ~~~~~~~~~~~~~~~~~~~~~~~~
 *   CONCLUÍDAS
 *
 * Arrastar um card pra outro dia muda o prazo; pra "sem prazo", tira o prazo;
 * pras concluídas, conclui. No toque, só a alça (⠿) arrasta — o resto do card
 * rola a página — e os botões fazem o mesmo sem arrastar.
 */

const COR: Record<TaskPriority, string> = {
  critica: "var(--danger,var(--red))",
  alta: "var(--warning)",
  media: "var(--info-2,var(--info))",
  baixa: "var(--text-muted,var(--muted))",
};

type Props = {
  tarefas: Task[];
  /** Hoje, "yyyy-mm-dd" local. */
  hoje: string;
  /** O dono vê de quem é cada tarefa; quem só vê as suas não precisa. */
  mostrarResponsavel: boolean;
  onMoverParaDia: (t: Task, dia: string | null) => void;
  onConcluir: (t: Task) => void;
  onReabrir: (t: Task) => void;
  onEditar: (t: Task) => void;
  onNova: (prazo?: string) => void;
};

const ALVO_SEM_PRAZO = "sem-prazo";
const ALVO_CONCLUIDAS = "concluidas";
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function usePonteiroDeToque(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia("(pointer: coarse)");
      m.addEventListener("change", avisar);
      return () => m.removeEventListener("change", avisar);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

export default function SemanaDeTarefas({ tarefas, hoje, mostrarResponsavel, onMoverParaDia, onConcluir, onReabrir, onEditar, onNova }: Props) {
  const [segunda, setSegunda] = useState(() => segundaDaSemana(hoje));
  const semana = useMemo(() => montarSemana(tarefas, segunda, hoje), [tarefas, segunda, hoje]);
  const ehEstaSemana = segunda === segundaDaSemana(hoje);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [arrastando, setArrastando] = useState<Task | null>(null);

  function onDragStart(e: DragStartEvent) {
    setArrastando(tarefas.find((t) => t.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setArrastando(null);
    const t = tarefas.find((x) => x.id === e.active.id);
    const alvo = e.over?.id ? String(e.over.id) : null;
    if (!t || !alvo) return;
    if (alvo === ALVO_CONCLUIDAS) { if (t.status !== "done") onConcluir(t); return; }
    const dia = alvo === ALVO_SEM_PRAZO ? null : alvo.replace(/^dia:/, "");
    if (t.status === "done" || (t.dueDate ?? null) !== dia) onMoverParaDia(t, dia);
  }

  const cardProps = { mostrarResponsavel, hoje, onConcluir, onReabrir, onEditar };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className={s.topo}>
          <div className={s.navegacao}>
            <button type="button" className={s.seta} aria-label="Semana anterior" onClick={() => setSegunda((x) => somarDias(x, -7))}>←</button>
            <div className={s.tituloSemana}>
              <small>{ehEstaSemana ? "Esta semana" : segunda < segundaDaSemana(hoje) ? "Semana passada" : "Próxima semana"}</small>
              {rotuloDaSemana(segunda)}
            </div>
            <button type="button" className={s.seta} aria-label="Próxima semana" onClick={() => setSegunda((x) => somarDias(x, 7))}>→</button>
            {!ehEstaSemana && <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSegunda(segundaDaSemana(hoje))}>Hoje</button>}
          </div>
          <span className={s.dica}>Arraste um card pra outro dia (muda o prazo) ou pras concluídas.</span>
        </div>

        {semana.atrasadas.length > 0 && (
          <Quadro id="atrasadas" classe={s.quadroAtrasadas} titulo="ATRASADAS" subtitulo="prazo de semanas anteriores" contagem={semana.atrasadas.length} soltavel={false}>
            {semana.atrasadas.map((t) => <CardArrastavel key={t.id} tarefa={t} {...cardProps} />)}
          </Quadro>
        )}

        <div className={s.grade}>
          {semana.dias.map((d) => (
            <Quadro
              key={d.iso} id={`dia:${d.iso}`} classe={d.hoje ? s.quadroHoje : ""} titulo={d.curto} subtitulo={ddmm(d.iso)}
              rotulo={`${d.longo}, ${ddmm(d.iso)}${d.hoje ? " (hoje)" : ""}`} contagem={d.tarefas.length}
              onNova={() => onNova(d.iso)} arrastando={!!arrastando}
            >
              {d.tarefas.map((t) => <CardArrastavel key={t.id} tarefa={t} {...cardProps} />)}
            </Quadro>
          ))}
          <Quadro id={ALVO_SEM_PRAZO} classe={s.quadroSemPrazo} titulo="SEM PRAZO" contagem={semana.semPrazo.length} onNova={() => onNova()} arrastando={!!arrastando}>
            {semana.semPrazo.map((t) => <CardArrastavel key={t.id} tarefa={t} {...cardProps} />)}
          </Quadro>
        </div>

        <svg className={s.onda} viewBox="0 0 400 22" preserveAspectRatio="none" aria-hidden>
          <path d="M0 11 Q 25 1 50 11 T 100 11 T 150 11 T 200 11 T 250 11 T 300 11 T 350 11 T 400 11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>

        <Concluidas contagem={semana.concluidas.length} arrastando={!!arrastando}>
          {semana.concluidas.map((t) => <CardArrastavel key={t.id} tarefa={t} {...cardProps} />)}
        </Concluidas>
      </div>
      <DragOverlay>{arrastando ? <Card tarefa={arrastando} {...cardProps} /> : null}</DragOverlay>
    </DndContext>
  );
}

function Quadro({ id, classe, titulo, subtitulo, rotulo, contagem, onNova, arrastando, soltavel = true, children }: {
  id: string; classe: string; titulo: string; subtitulo?: string; rotulo?: string; contagem: number;
  onNova?: () => void; arrastando?: boolean; soltavel?: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !soltavel });
  return (
    <section ref={setNodeRef} className={`${s.quadro} ${classe} ${isOver ? s.quadroAlvo : ""}`} aria-label={rotulo ?? titulo}>
      <div className={s.cabeca}>
        <div><span className={s.dia}>{titulo}</span>{subtitulo && <span className={s.data}>{subtitulo}</span>}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {contagem > 0 && <span className={s.contagem}>{contagem}</span>}
          {onNova && <button type="button" className={s.mais} onClick={onNova} aria-label={`Nova tarefa — ${rotulo ?? titulo}`} title="Nova tarefa aqui">＋</button>}
        </div>
      </div>
      {contagem === 0 ? <div className={s.vazio}>{arrastando ? "solte aqui" : "—"}</div> : <div className={s.cards}>{children}</div>}
    </section>
  );
}

function Concluidas({ contagem, arrastando, children }: { contagem: number; arrastando: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: ALVO_CONCLUIDAS });
  return (
    <section ref={setNodeRef} className={`${s.concluidas} ${isOver ? s.concluidasAlvo : ""}`} aria-label="Concluídas nesta semana">
      <div className={s.concluidasTitulo}><span>CONCLUÍDAS</span><span className={s.contagem}>{contagem} nesta semana</span></div>
      {contagem === 0
        ? <div className={s.vazio}>{arrastando ? "solte aqui pra concluir" : "Nada concluído nesta semana ainda."}</div>
        : <div className={s.concluidasGrade}>{children}</div>}
    </section>
  );
}

type CardProps = {
  tarefa: Task; hoje: string; mostrarResponsavel: boolean;
  onConcluir: (t: Task) => void; onReabrir: (t: Task) => void; onEditar: (t: Task) => void;
  alca?: React.ReactNode;
};

function CardArrastavel(props: CardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: props.tarefa.id });
  const toque = usePonteiroDeToque();
  if (toque) {
    const alca = (
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className={s.alca}
        aria-label={`Arrastar a tarefa ${props.tarefa.title} pra outro dia`} title="Segure e arraste pra outro dia">⠿</button>
    );
    return <div ref={setNodeRef} style={{ opacity: isDragging ? 0.35 : 1 }}><Card {...props} alca={alca} /></div>;
  }
  return (
    <div ref={setNodeRef} {...listeners} style={{ opacity: isDragging ? 0.35 : 1, cursor: "grab", touchAction: "none" }}>
      <Card {...props} />
    </div>
  );
}

function Card({ tarefa: t, hoje, mostrarResponsavel, onConcluir, onReabrir, onEditar, alca }: CardProps) {
  const feita = t.status === "done";
  const atrasada = !feita && !!t.dueDate && t.dueDate < hoje;
  return (
    <div className={`${s.card} ${feita ? s.cardFeito : ""}`} style={{ "--prioridade": COR[t.priority ?? "media"] } as React.CSSProperties}>
      <div className={s.cardTitulo}>{t.title}</div>
      <div className={s.cardMeta}>
        {t.status === "doing" && <span className={`${s.chip} ${s.chipFazendo}`}>fazendo</span>}
        {atrasada && <span className={`${s.chip} ${s.chipAtrasada}`}>atrasada · {ddmm(t.dueDate!)}</span>}
        {mostrarResponsavel && t.assignedToName && <span className={s.chip}>👤 {t.assignedToName}</span>}
      </div>
      <div className={s.cardAcoes}>
        {feita
          ? <button type="button" className={s.acao} onClick={() => onReabrir(t)} aria-label={`Reabrir ${t.title}`}>↩ Reabrir</button>
          : <button type="button" className={`${s.acao} ${s.acaoConcluir}`} onClick={() => onConcluir(t)} aria-label={`Concluir ${t.title}`}>✓ Concluir</button>}
        <button type="button" className={s.acao} onClick={() => onEditar(t)} aria-label={`Editar ${t.title}`}>Editar</button>
        {alca}
      </div>
    </div>
  );
}
