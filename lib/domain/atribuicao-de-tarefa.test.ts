import { describe, expect, it } from "vitest";
import { JANELA_DA_ATRIBUICAO_MS, avaliarAtribuicao } from "./atribuicao-de-tarefa";
import type { Task } from "./types";

const AGORA = 1_800_000_000_000;
const EU = "dono@zxp.com";
const ELE = "socio@zxp.com";

function tarefa(over: Partial<Task> = {}): Partial<Task> & { id: string } {
  return {
    id: "t1", title: "Conferir o custo da Menta", status: "todo", priority: "alta", dueDate: "2026-09-30",
    assignedTo: ELE, createdBy: EU,
    atividade: [
      { tipo: "criada", por: EU, em: AGORA - 3600_000 },
      { tipo: "atribuida", por: EU, em: AGORA - 5_000, detalhe: "Sócio" },
    ],
    ...over,
  };
}

describe("avaliarAtribuicao — o banco decide, o navegador só aponta", () => {
  it("a atribuição legítima recente: avisa o responsável GRAVADO, com o texto gravado", () => {
    const r = avaliarAtribuicao(tarefa(), EU, AGORA);
    expect(r).toMatchObject({ ok: true, responsavel: ELE, titulo: "Conferir o custo da Menta", prioridade: "alta", prazo: "2026-09-30" });
  });

  it("a identidade do aviso é a TRANSIÇÃO: tarefa + instante da atribuição", () => {
    const r = avaliarAtribuicao(tarefa(), EU, AGORA);
    expect(r.ok && r.dedupeKey).toBe(`task_assigned:t1:${AGORA - 5_000}`);
  });

  it("RETRY da mesma transição gera a MESMA chave — não duplica", () => {
    const a = avaliarAtribuicao(tarefa(), EU, AGORA);
    const b = avaliarAtribuicao(tarefa(), EU, AGORA + 30_000);
    expect(a.ok && b.ok && a.dedupeKey === b.dedupeKey).toBe(true);
  });

  it("REATRIBUIÇÃO legítima depois é uma transição nova: chave nova, avisa de novo", () => {
    const depois = tarefa({
      assignedTo: "outra@zxp.com",
      atividade: [
        { tipo: "atribuida", por: EU, em: AGORA - 3600_000 },
        { tipo: "atribuida", por: EU, em: AGORA - 1_000 },
      ],
    });
    const antes = avaliarAtribuicao(tarefa(), EU, AGORA);
    const r = avaliarAtribuicao(depois, EU, AGORA);
    expect(r.ok && antes.ok && r.dedupeKey !== antes.dedupeKey).toBe(true);
    expect(r.ok && r.responsavel).toBe("outra@zxp.com");
  });

  it("quem NÃO atribuiu a tarefa não consegue disparar o aviso dela", () => {
    expect(avaliarAtribuicao(tarefa(), "intruso@zxp.com", AGORA)).toEqual({ ok: false, motivo: "outra_pessoa_atribuiu" });
  });

  it("tarefa sem nenhuma atribuição registrada: recusa (corpo inventado não cria transição)", () => {
    expect(avaliarAtribuicao(tarefa({ atividade: [{ tipo: "criada", por: EU, em: AGORA - 10 }] }), EU, AGORA)).toEqual({ ok: false, motivo: "sem_transicao" });
    expect(avaliarAtribuicao(tarefa({ atividade: undefined }), EU, AGORA)).toEqual({ ok: false, motivo: "sem_transicao" });
  });

  it("transição ANTIGA: replay dias depois é recusado", () => {
    const antiga = tarefa({ atividade: [{ tipo: "atribuida", por: EU, em: AGORA - JANELA_DA_ATRIBUICAO_MS - 1 }] });
    expect(avaliarAtribuicao(antiga, EU, AGORA)).toEqual({ ok: false, motivo: "transicao_antiga" });
  });

  it("transição exatamente no limite da janela ainda vale", () => {
    const limite = tarefa({ atividade: [{ tipo: "atribuida", por: EU, em: AGORA - JANELA_DA_ATRIBUICAO_MS }] });
    expect(avaliarAtribuicao(limite, EU, AGORA).ok).toBe(true);
  });

  it("transição no FUTURO além da tolerância (relógio ou dado forjado) é recusada", () => {
    const futura = tarefa({ atividade: [{ tipo: "atribuida", por: EU, em: AGORA + JANELA_DA_ATRIBUICAO_MS + 1 }] });
    expect(avaliarAtribuicao(futura, EU, AGORA)).toEqual({ ok: false, motivo: "transicao_antiga" });
  });

  it("sem responsável, auto-atribuição e tarefa concluída: nada a avisar", () => {
    expect(avaliarAtribuicao(tarefa({ assignedTo: undefined }), EU, AGORA)).toEqual({ ok: false, motivo: "sem_responsavel" });
    expect(avaliarAtribuicao(tarefa({ assignedTo: EU }), EU, AGORA)).toEqual({ ok: false, motivo: "auto_atribuicao" });
    expect(avaliarAtribuicao(tarefa({ status: "done" }), EU, AGORA)).toEqual({ ok: false, motivo: "tarefa_concluida" });
  });

  it("a caixa do e-mail não dribla a regra", () => {
    expect(avaliarAtribuicao(tarefa({ assignedTo: "DONO@ZXP.com" }), EU, AGORA)).toEqual({ ok: false, motivo: "auto_atribuicao" });
    expect(avaliarAtribuicao(tarefa(), "Dono@Zxp.com", AGORA).ok).toBe(true);
  });

  it("título gigante é contido; prioridade inválida vira 'media'; prazo inválido some", () => {
    const r = avaliarAtribuicao(tarefa({ title: "x".repeat(5000), priority: "urgentissima" as never, dueDate: "amanha" }), EU, AGORA);
    expect(r.ok && r.titulo.length).toBe(120);
    expect(r.ok && r.prioridade).toBe("media");
    expect(r.ok && r.prazo).toBeUndefined();
  });

  it("uma atividade com 'em' inválido não vira transição", () => {
    const ruim = tarefa({ atividade: [{ tipo: "atribuida", por: EU, em: Number.NaN }] });
    expect(avaliarAtribuicao(ruim, EU, AGORA)).toEqual({ ok: false, motivo: "sem_transicao" });
  });
});
