"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import Modal from "@/components/Modal";
import { appendAtividade, isTaskAtrasada, type AccessEntry, type Task, type TaskAtividade, type TaskPriority, type TaskStatus } from "@/lib/domain/types";
import { deleteTask, upsertTask, watchAccessList, watchTasks } from "@/lib/firebase/data";
import { useAccess } from "@/components/tabs/AccessGuard";
import { authedFetch } from "@/lib/api/authed-fetch";

const PRIORIDADE_META: Record<TaskPriority, { label: string; cor: string; peso: number }> = {
  critica: { label: "Crítica", cor: "var(--danger,var(--red))", peso: 3 },
  alta: { label: "Alta", cor: "var(--warning)", peso: 2 },
  media: { label: "Média", cor: "var(--info-2,var(--info))", peso: 1 },
  baixa: { label: "Baixa", cor: "var(--text-muted,var(--muted))", peso: 0 },
};
/** Tarefa sem prioridade definida (dado antigo) lê como "média" — nunca inventa "crítica" nem "baixa" por omissão. */
function prioridadeDe(t: Task): TaskPriority {
  return t.priority ?? "media";
}

const ATIVIDADE_LABEL: Record<TaskAtividade["tipo"], string> = {
  criada: "Criada", atribuida: "Atribuída", movida: "Movida", concluida: "Concluída",
};

function newId() {
  return "t" + Date.now() + Math.random().toString(36).slice(2, 6);
}

const COLS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: "todo", label: "A Fazer", dot: "var(--accent)" },
  { status: "doing", label: "Fazendo", dot: "var(--yellow)" },
  { status: "done", label: "Concluído", dot: "var(--green)" },
];

function fmtData(iso?: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

const isAtrasada = isTaskAtrasada;

type Filtro = "todas" | "pra-mim" | "criei-eu";

export default function TarefasTab({ openTaskId }: { openTaskId?: string } = {}) {
  const { email } = useAccess();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pessoas, setPessoas] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [responsavelFiltro, setResponsavelFiltro] = useState("");
  const [prioridadeFiltro, setPrioridadeFiltro] = useState<TaskPriority | "">("");
  const [somenteAtrasadas, setSomenteAtrasadas] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [openNew, setOpenNew] = useState(false);

  // Deep link de uma notificação de tarefa (?tab=tarefas&task=...) — abre o
  // modal de edição assim que a tarefa aparecer na lista carregada. Mesmo
  // padrão/mesma ressalva de PedidosTab.tsx (setState síncrono no efeito é
  // sincronizar com um prop que só fica pronto depois da lista carregar).
  useEffect(() => {
    if (openTaskId) {
      const t = tasks.find((x) => x.id === openTaskId);
      if (t) setEditTask(t);
    }
  }, [openTaskId, tasks]);

  useEffect(() => {
    const u1 = watchTasks((ts) => { setTasks(ts); setLoading(false); });
    const u2 = watchAccessList((es) => setPessoas(es));
    return () => { u1(); u2(); };
  }, []);

  const visiveis = useMemo(() => {
    let lista = tasks;
    if (filtro === "pra-mim") lista = lista.filter((t) => t.assignedTo === email);
    else if (filtro === "criei-eu") lista = lista.filter((t) => t.createdBy === email);
    if (responsavelFiltro) lista = lista.filter((t) => t.assignedTo === responsavelFiltro);
    if (prioridadeFiltro) lista = lista.filter((t) => prioridadeDe(t) === prioridadeFiltro);
    if (somenteAtrasadas) lista = lista.filter((t) => isAtrasada(t));
    return lista;
  }, [tasks, filtro, email, responsavelFiltro, prioridadeFiltro, somenteAtrasadas]);

  const porColuna = (status: TaskStatus) => visiveis.filter((t) => t.status === status);

  async function mover(t: Task, status: TaskStatus) {
    if (t.status === status) return;
    const evento: TaskAtividade = {
      tipo: status === "done" ? "concluida" : "movida",
      por: email, em: Date.now(),
      detalhe: `${COLS.find((c) => c.status === t.status)?.label} → ${COLS.find((c) => c.status === status)?.label}`,
    };
    await upsertTask({ ...t, status, lastEditedBy: email, atividade: appendAtividade(t.atividade, evento) }).catch(() => {});
  }

  async function excluir(t: Task) {
    if (!confirm(`Excluir a tarefa "${t.title}"?`)) return;
    await deleteTask(t.id).catch(() => {});
  }

  const minhas = tasks.filter((t) => t.assignedTo === email).length;
  const criadas = tasks.filter((t) => t.createdBy === email).length;
  const abertas = tasks.filter((t) => t.status !== "done").length;

  // Distância mínima antes de considerar arrasto (não clique) — sem isso, um
  // toque simples pra abrir "Editar" já dispararia um drag. PointerSensor
  // cobre mouse e toque igual, então funciona no celular também.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);

  function onDragStart(e: DragStartEvent) {
    const t = tasks.find((x) => x.id === e.active.id) ?? null;
    setDraggingTask(t);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDraggingTask(null);
    const overStatus = e.over?.id as TaskStatus | undefined;
    const t = tasks.find((x) => x.id === e.active.id);
    if (!t || !overStatus) return;
    await mover(t, overStatus);
  }

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left"><h2 className="tab-title">Tarefas</h2></div>
        <div className="tab-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenNew(true)}>＋ Nova Tarefa</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Em aberto</div><div className="k-val">{abertas}</div><div className="k-sub">{tasks.length} no total</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Pra mim</div><div className="k-val" style={{ color: "var(--yellow)" }}>{minhas}</div><div className="k-sub">atribuídas a você</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Criadas por mim</div><div className="k-val" style={{ color: "var(--green)" }}>{criadas}</div></div>
      </div>

      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button type="button" className={`seg-btn ${filtro === "todas" ? "active" : ""}`} onClick={() => setFiltro("todas")}>Todas</button>
        <button type="button" className={`seg-btn ${filtro === "pra-mim" ? "active" : ""}`} onClick={() => setFiltro("pra-mim")}>Pra mim</button>
        <button type="button" className={`seg-btn ${filtro === "criei-eu" ? "active" : ""}`} onClick={() => setFiltro("criei-eu")}>Criei eu</button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={responsavelFiltro} onChange={(e) => setResponsavelFiltro(e.target.value)} aria-label="Filtrar por responsável" style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}>
          <option value="">Todos os responsáveis</option>
          {pessoas.map((p) => <option key={p.email} value={p.email}>{p.displayName || p.email}</option>)}
        </select>
        <select value={prioridadeFiltro} onChange={(e) => setPrioridadeFiltro(e.target.value as TaskPriority | "")} aria-label="Filtrar por prioridade" style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}>
          <option value="">Todas as prioridades</option>
          {(["critica", "alta", "media", "baixa"] as const).map((p) => <option key={p} value={p}>{PRIORIDADE_META[p].label}</option>)}
        </select>
        <button
          type="button" onClick={() => setSomenteAtrasadas((v) => !v)}
          style={{
            fontSize: ".78rem", fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer",
            background: somenteAtrasadas ? "var(--red)" : "var(--surface2)", color: somenteAtrasadas ? "#fff" : "var(--muted)",
            border: `1px solid ${somenteAtrasadas ? "var(--red)" : "var(--border)"}`,
          }}
        >
          Só atrasadas
        </button>
        {(responsavelFiltro || prioridadeFiltro || somenteAtrasadas) && (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setResponsavelFiltro(""); setPrioridadeFiltro(""); setSomenteAtrasadas(false); }}>Limpar</button>
        )}
      </div>

      {loading ? (
        <div className="empty-state">Carregando…</div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="kanban-board">
            {COLS.map((col) => {
              const itens = porColuna(col.status);
              return (
                <KanbanColuna key={col.status} status={col.status} label={col.label} dot={col.dot} count={itens.length}>
                  {itens.length === 0 ? (
                    <div className="kanban-empty">Nenhuma tarefa aqui{draggingTask ? " · solte pra mover" : ""}</div>
                  ) : (
                    itens.map((t) => (
                      <DraggableTaskCard
                        key={t.id}
                        task={t}
                        onMover={(s) => mover(t, s)}
                        onEditar={() => setEditTask(t)}
                        onExcluir={() => excluir(t)}
                      />
                    ))
                  )}
                </KanbanColuna>
              );
            })}
          </div>
          <DragOverlay>
            {draggingTask ? <TaskCard task={draggingTask} onMover={() => {}} onEditar={() => {}} onExcluir={() => {}} arrastando /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {openNew && (
        <TaskModal pessoas={pessoas} minhaEmail={email} task={null} onClose={() => setOpenNew(false)} />
      )}
      {editTask && (
        <TaskModal pessoas={pessoas} minhaEmail={email} task={editTask} onClose={() => setEditTask(null)} />
      )}
    </div>
  );
}

/** Coluna do quadro — é o alvo do "solte aqui" do drag-and-drop. */
function KanbanColuna({ status, label, dot, count, children }: {
  status: TaskStatus; label: string; dot: string; count: number; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="kanban-col" ref={setNodeRef} style={isOver ? { borderColor: "var(--accent)", background: "rgba(233,169,45,.05)" } : undefined}>
      <div className="kanban-col-head">
        <span className="kanban-col-title">
          <span className="kanban-dot" style={{ background: dot }} />{label} ({count})
        </span>
      </div>
      <div className="kanban-cards">{children}</div>
    </div>
  );
}

/**
 * Envolve o card com o arrasto — o card INTEIRO é a área de arrastar agora
 * (antes só um grip de 12x16px no canto era arrastável, fácil de não achar).
 * Continua seguro clicar em Editar/Excluir/mover: o PointerSensor do
 * DndContext (ver activationConstraint mais abaixo) só considera "arrasto"
 * depois de 6px de movimento — um clique parado num botão nunca dispara o
 * drag, só o clique normal do botão.
 */
function DraggableTaskCard({ task, onMover, onEditar, onExcluir }: {
  task: Task;
  onMover: (s: TaskStatus) => void;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.35 : 1, cursor: "grab", touchAction: "none" }}
    >
      <TaskCard task={task} onMover={onMover} onEditar={onEditar} onExcluir={onExcluir} arrastavel />
    </div>
  );
}

function TaskCard({ task, onMover, onEditar, onExcluir, arrastavel, arrastando }: {
  task: Task;
  onMover: (s: TaskStatus) => void;
  onEditar: () => void;
  onExcluir: () => void;
  /** Só visual (ícone de grip) — quem de fato liga o arrasto é o wrapper em DraggableTaskCard. */
  arrastavel?: boolean;
  arrastando?: boolean;
}) {
  const idx = COLS.findIndex((c) => c.status === task.status);
  const atrasada = isAtrasada(task);
  return (
    <div className={`kanban-card pri-${task.status}`} title={arrastavel ? "Arraste o card pra mover entre colunas" : undefined} style={arrastando ? { boxShadow: "0 10px 30px rgba(0,0,0,.45)", cursor: "grabbing" } : undefined}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {arrastavel && (
          <span aria-hidden style={{ color: "var(--muted)", flexShrink: 0, marginTop: 2, padding: "2px 2px" }}>
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
              <circle cx="3" cy="2" r="1.4" /><circle cx="9" cy="2" r="1.4" />
              <circle cx="3" cy="8" r="1.4" /><circle cx="9" cy="8" r="1.4" />
              <circle cx="3" cy="14" r="1.4" /><circle cx="9" cy="14" r="1.4" />
            </svg>
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
      <div className="kanban-card-title">{task.title}</div>
      {task.description && <div className="kanban-card-desc">{task.description}</div>}
      <div className="kanban-card-meta">
        <span className="severity-chip" style={{ color: PRIORIDADE_META[prioridadeDe(task)].cor, background: "transparent", border: `1px solid ${PRIORIDADE_META[prioridadeDe(task)].cor}` }}>
          {PRIORIDADE_META[prioridadeDe(task)].label}
        </span>
        {task.assignedToName && <span className="chip chip-accent">👤 {task.assignedToName}</span>}
        {task.dueDate && <span className={`chip ${atrasada ? "chip-red" : "chip-muted"}`}>{atrasada ? "atrasada · " : ""}{fmtData(task.dueDate)}</span>}
      </div>
      <div className="kanban-card-foot">
        <span style={{ fontSize: ".68rem", color: "var(--muted)" }}>
          {task.createdByName ? `por ${task.createdByName}` : ""}
        </span>
        <div className="row-actions">
          <div className="kanban-move-btns">
            <button type="button" className="btn btn-ghost btn-xs" title="Mover pra trás" aria-label="Mover pra trás" disabled={idx <= 0} onClick={() => onMover(COLS[idx - 1].status)}>←</button>
            <button type="button" className="btn btn-ghost btn-xs" title="Mover pra frente" aria-label="Mover pra frente" disabled={idx >= COLS.length - 1} onClick={() => onMover(COLS[idx + 1].status)}>→</button>
          </div>
          <button type="button" className="btn btn-warning btn-xs" onClick={onEditar}>Editar</button>
          <button type="button" className="btn btn-danger btn-xs" onClick={onExcluir}>Excluir</button>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}

function TaskModal({ pessoas, minhaEmail, task, onClose }: {
  pessoas: AccessEntry[];
  minhaEmail: string;
  task: Task | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? minhaEmail);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(task ? prioridadeDe(task) : "media");
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!title.trim()) { alert("Dê um título pra tarefa."); return; }
    setSaving(true);
    try {
      const pessoa = pessoas.find((p) => p.email === assignedTo);
      const eu = pessoas.find((p) => p.email === minhaEmail);

      // Rastro de atividade — compara contra a tarefa original (task) pra só
      // registrar o que de fato mudou nesta edição.
      let atividade = task?.atividade;
      // Atribuição NOVA pra alguém (não vazio, diferente de antes) — é o
      // gatilho da notificação abaixo. Comparado antes de sobrescrever
      // `atividade`, pra não depender da string formatada do rastro.
      const atribuicaoMudou = (task?.assignedTo ?? "") !== (assignedTo || "") && !!assignedTo;
      if (!task) {
        atividade = appendAtividade(atividade, { tipo: "criada", por: minhaEmail, em: Date.now() });
      } else {
        if ((task.assignedTo ?? "") !== (assignedTo || "")) {
          atividade = appendAtividade(atividade, { tipo: "atribuida", por: minhaEmail, em: Date.now(), detalhe: pessoa?.displayName || assignedTo || "ninguém" });
        }
        if (task.status !== status) {
          atividade = appendAtividade(atividade, { tipo: status === "done" ? "concluida" : "movida", por: minhaEmail, em: Date.now() });
        }
      }

      const next: Task = {
        id: task?.id || newId(),
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assignedTo: assignedTo || undefined,
        assignedToName: pessoa?.displayName || assignedTo || undefined,
        dueDate: dueDate || undefined,
        createdBy: task?.createdBy ?? minhaEmail,
        createdByName: task?.createdByName ?? (eu?.displayName || minhaEmail),
        createdAt: task?.createdAt ?? Date.now(),
        lastEditedBy: minhaEmail,
        atividade,
      };
      await upsertTask(next);

      // Notifica quem recebeu a tarefa — só quando a atribuição é nova e não
      // é a própria pessoa se auto-atribuindo (a rota também garante isso,
      // aqui é só pra não gastar um round-trip à toa). Fire-and-forget: uma
      // falha aqui não pode travar o salvamento da tarefa, que já aconteceu.
      if (atribuicaoMudou && assignedTo !== minhaEmail) {
        authedFetch("/api/notify/task-assigned", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: next.id, assigneeEmail: assignedTo, title: next.title, priority: next.priority, dueDate: next.dueDate }),
        }).catch(() => {});
      }

      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">{task ? "Editar Tarefa" : "Nova Tarefa"}</div>

      <div className="config-field">
        <label>Título</label>
        <input type="text" placeholder="Ex: Responder cliente sobre devolução" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>

      <div className="config-field">
        <label>Descrição (opcional)</label>
        <input type="text" placeholder="Detalhes da tarefa…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="form-grid">
        <div className="config-field" style={{ margin: 0 }}>
          <label>Atribuir pra</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">— ninguém —</option>
            {pessoas.map((p) => (
              <option key={p.email} value={p.email}>
                {p.displayName || p.email}{p.email === minhaEmail ? " (eu)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="config-field" style={{ margin: 0 }}>
          <label>Prazo (opcional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <div className="config-field">
        <label>Prioridade</label>
        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
          {(["critica", "alta", "media", "baixa"] as const).map((p) => (
            <option key={p} value={p}>{PRIORIDADE_META[p].label}</option>
          ))}
        </select>
      </div>

      <div className="config-field">
        <label>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
          {COLS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
        </select>
      </div>

      {task?.atividade && task.atividade.length > 0 && (
        <details style={{ marginTop: 4, marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: ".78rem", color: "var(--text-secondary,var(--muted))" }}>Atividade ({task.atividade.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {[...task.atividade].reverse().map((ev, i) => (
              <div key={i} style={{ fontSize: ".76rem", color: "var(--text-secondary,var(--muted))" }}>
                <b style={{ color: "var(--text-primary,var(--text))" }}>{ATIVIDADE_LABEL[ev.tipo]}</b>
                {ev.detalhe ? ` — ${ev.detalhe}` : ""} · {ev.por} · {new Date(ev.em).toLocaleString("pt-BR")}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={onSave} disabled={saving}>
          {saving ? "Salvando…" : "Salvar Tarefa"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
