import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/domain/types";
import { concluidaEm, montarSemana, rotuloDaSemana, segundaDaSemana, somarDias, tarefaVisivel } from "./semana-tarefas";

const t = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, status: "todo", createdAt: 1, ...extra });
/** Meio-dia local de um dia (o mesmo jeito que a tela marca "concluída em"). */
const em = (iso: string, h = 12) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, h).getTime(); };

describe("segundaDaSemana", () => {
  it("de segunda a domingo, a semana começa na segunda", () => {
    expect(segundaDaSemana("2026-11-02")).toBe("2026-11-02"); // segunda
    expect(segundaDaSemana("2026-11-05")).toBe("2026-11-02"); // quinta
    expect(segundaDaSemana("2026-11-08")).toBe("2026-11-02"); // domingo
    expect(segundaDaSemana("2026-11-09")).toBe("2026-11-09");
  });
  it("vira mês e ano sem tropeçar", () => {
    expect(segundaDaSemana("2027-01-01")).toBe("2026-12-28");
    expect(somarDias("2026-12-28", 6)).toBe("2027-01-03");
  });
});

describe("montarSemana", () => {
  const SEG = "2026-11-02";
  const HOJE = "2026-11-04";

  it("cada tarefa em aberto no dia do prazo; sem prazo no último quadro", () => {
    const s = montarSemana([
      t("seg", { dueDate: "2026-11-02" }),
      t("qui", { dueDate: "2026-11-05", status: "doing" }),
      t("dom", { dueDate: "2026-11-08" }),
      t("solta"),
      t("semana-que-vem", { dueDate: "2026-11-09" }),
    ], SEG, HOJE);
    expect(s.dias.map((d) => d.curto)).toEqual(["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"]);
    expect(s.dias[0].tarefas.map((x) => x.id)).toEqual(["seg"]);
    expect(s.dias[3].tarefas.map((x) => x.id)).toEqual(["qui"]);
    expect(s.dias[6].tarefas.map((x) => x.id)).toEqual(["dom"]);
    expect(s.semPrazo.map((x) => x.id)).toEqual(["solta"]);
    expect(s.dias.flatMap((d) => d.tarefas).some((x) => x.id === "semana-que-vem")).toBe(false);
    expect(s.dias[2].hoje).toBe(true);
  });

  it("atrasada de semana passada aparece em 'atrasadas' só na semana atual", () => {
    const velha = t("velha", { dueDate: "2026-10-28" });
    expect(montarSemana([velha], SEG, HOJE).atrasadas.map((x) => x.id)).toEqual(["velha"]);
    expect(montarSemana([velha], "2026-11-09", HOJE).atrasadas).toEqual([]);
  });

  it("concluída vai pra baixo, na semana em que foi concluída (não no dia do prazo)", () => {
    const feita = t("feita", { status: "done", dueDate: "2026-11-03", atividade: [{ tipo: "concluida", por: "a@a.com", em: em("2026-11-04") }] });
    const antiga = t("antiga", { status: "done", atividade: [{ tipo: "concluida", por: "a@a.com", em: em("2026-10-30") }] });
    const s = montarSemana([feita, antiga], SEG, HOJE);
    expect(s.concluidas.map((x) => x.id)).toEqual(["feita"]);
    expect(s.dias[1].tarefas).toEqual([]);
    // domingo 23:59 ainda é desta semana; segunda 00:00 já é da próxima
    expect(montarSemana([t("d", { status: "done", updatedAt: em("2026-11-08", 23) })], SEG, HOJE).concluidas).toHaveLength(1);
    expect(montarSemana([t("d", { status: "done", updatedAt: em("2026-11-09", 0) })], SEG, HOJE).concluidas).toHaveLength(0);
  });

  it("dentro do dia: fazendo antes de a fazer, depois a prioridade", () => {
    const s = montarSemana([
      t("baixa", { dueDate: SEG, priority: "baixa" }),
      t("critica", { dueDate: SEG, priority: "critica" }),
      t("fazendo", { dueDate: SEG, status: "doing", priority: "baixa" }),
    ], SEG, HOJE);
    expect(s.dias[0].tarefas.map((x) => x.id)).toEqual(["fazendo", "critica", "baixa"]);
  });
});

describe("concluidaEm", () => {
  it("o último 'concluida' do rastro; sem rastro, a última edição; aberta, nada", () => {
    expect(concluidaEm(t("a", { status: "done", atividade: [{ tipo: "concluida", por: "x", em: 5 }, { tipo: "movida", por: "x", em: 9 }] }))).toBe(5);
    expect(concluidaEm(t("b", { status: "done", updatedAt: 7 }))).toBe(7);
    expect(concluidaEm(t("c", { updatedAt: 7 }))).toBeNull();
  });
});

describe("tarefaVisivel", () => {
  const minha = t("m", { assignedTo: "Ana@a.com", createdBy: "dono@a.com" });
  const pedi = t("p", { assignedTo: "beto@a.com", createdBy: "ana@a.com" });
  const deOutro = t("o", { assignedTo: "beto@a.com", createdBy: "dono@a.com" });
  it("o dono vê todas", () => {
    expect([minha, pedi, deOutro].every((x) => tarefaVisivel(x, "dono@a.com", true))).toBe(true);
  });
  it("o time vê as atribuídas a si e as que criou; a dos outros, não", () => {
    expect(tarefaVisivel(minha, "ana@a.com", false)).toBe(true);
    expect(tarefaVisivel(pedi, "ana@a.com", false)).toBe(true);
    expect(tarefaVisivel(deOutro, "ana@a.com", false)).toBe(false);
  });
});

it("rotuloDaSemana", () => {
  expect(rotuloDaSemana("2026-11-02")).toBe("02/11 a 08/11");
});
