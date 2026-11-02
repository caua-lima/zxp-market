import type { Task } from "@/lib/domain/types";

/**
 * A SEMANA DE TAREFAS — o quadro da aba Tarefas desenhado como uma agenda:
 *
 *   SEG  TER  QUA  QUI
 *   SEX  SÁB  DOM  SEM PRAZO
 *   ─────────────────────────
 *   CONCLUÍDAS (da semana)
 *
 * Cada tarefa em aberto cai no dia do prazo. Sem prazo, no último quadro.
 * Prazo de semana anterior que ninguém concluiu fica num quadro de
 * "atrasadas" (só na semana atual: olhando outra semana, o passado é passado).
 * Concluída vai pra baixo, na semana em que foi concluída.
 *
 * Datas são locais ("yyyy-mm-dd" no fuso do aparelho), como o campo de prazo.
 */

export type DiaDaSemana = { iso: string; curto: string; longo: string; hoje: boolean; tarefas: Task[] };
export type SemanaDeTarefas = {
  segunda: string;
  dias: DiaDaSemana[];
  semPrazo: Task[];
  atrasadas: Task[];
  concluidas: Task[];
};

const CURTO = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];
const LONGO = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** "yyyy-mm-dd" local de uma data. */
export function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

/** Meio-dia local do dia: nunca escorrega de dia no horário de verão. */
function dataDe(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function somarDias(iso: string, n: number): string {
  const d = dataDe(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

/** A segunda-feira da semana do dia (semana de segunda a domingo). */
export function segundaDaSemana(iso: string): string {
  const d = dataDe(iso);
  const desdeSegunda = (d.getDay() + 6) % 7; // dom=0 → 6
  return somarDias(iso, -desdeSegunda);
}

/** Quando a tarefa foi concluída: o último "concluida" do rastro; sem rastro, a última edição. */
export function concluidaEm(t: Task): number | null {
  if (t.status !== "done") return null;
  const ev = [...(t.atividade ?? [])].reverse().find((a) => a.tipo === "concluida");
  return ev?.em ?? t.updatedAt ?? t.createdAt ?? null;
}

/**
 * QUEM VÊ QUAL TAREFA. O dono vê todas. O resto do time vê as suas: as que
 * foram atribuídas a ele e as que ele mesmo criou (pediu pra alguém e quer
 * acompanhar). É a mesma regra do firestore.rules — aqui é a tela, lá é o
 * que de fato barra a leitura.
 */
export function tarefaVisivel(t: Task, email: string, isOwner: boolean): boolean {
  if (isOwner) return true;
  const eu = email.toLowerCase();
  return (t.assignedTo ?? "").toLowerCase() === eu || (t.createdBy ?? "").toLowerCase() === eu;
}

const PESO_STATUS: Record<string, number> = { doing: 0, todo: 1, done: 2 };
const PESO_PRIORIDADE: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };
function ordenar(a: Task, b: Task): number {
  return (PESO_STATUS[a.status] ?? 1) - (PESO_STATUS[b.status] ?? 1)
    || (PESO_PRIORIDADE[a.priority ?? "media"] ?? 2) - (PESO_PRIORIDADE[b.priority ?? "media"] ?? 2)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

export function montarSemana(tarefas: Task[], segunda: string, hoje: string): SemanaDeTarefas {
  const isos = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
  const ehSemanaAtual = segundaDaSemana(hoje) === segunda;
  const inicio = dataDe(segunda);
  inicio.setHours(0, 0, 0, 0);
  const fim = dataDe(somarDias(segunda, 7));
  fim.setHours(0, 0, 0, 0);

  const abertas = tarefas.filter((t) => t.status !== "done");
  const dias = isos.map((iso, i) => ({
    iso,
    curto: CURTO[i],
    longo: LONGO[i],
    hoje: iso === hoje,
    tarefas: abertas.filter((t) => t.dueDate === iso).sort(ordenar),
  }));
  const semPrazo = abertas.filter((t) => !t.dueDate).sort(ordenar);
  const atrasadas = ehSemanaAtual
    ? abertas.filter((t) => !!t.dueDate && t.dueDate < segunda).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    : [];
  const concluidas = tarefas
    .filter((t) => {
      const em = concluidaEm(t);
      if (em != null) return em >= inicio.getTime() && em < fim.getTime();
      return false;
    })
    .sort((a, b) => (concluidaEm(b) ?? 0) - (concluidaEm(a) ?? 0));

  return { segunda, dias, semPrazo, atrasadas, concluidas };
}

/** "02/11 a 08/11" — o título da semana. */
export function rotuloDaSemana(segunda: string): string {
  const f = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return `${f(segunda)} a ${f(somarDias(segunda, 6))}`;
}
