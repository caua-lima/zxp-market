import type { Task, TaskAtividade, TaskPriority } from "@/lib/domain/types";

/**
 * Quando avisar que uma tarefa foi atribuída — decidido sobre o que está NO BANCO.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * A rota recebia do navegador o id da tarefa, o e-mail de quem receberia, o
 * título e a prioridade, e mandava o push com isso. Não olhava a tarefa. Então
 * qualquer pessoa com acesso à operação podia, com uma chamada manual:
 *
 *  - avisar QUALQUER pessoa de uma tarefa que nunca foi atribuída a ela;
 *  - escrever o título que aparece na tela de bloqueio do outro;
 *  - repetir a chamada quantas vezes quisesse: o `dedupeKey` levava
 *    `Date.now()`, então cada retry HTTP era um aviso novo.
 *
 * ─── O QUE VALE AGORA ───────────────────────────────────────────────────
 *
 * O navegador só diz QUAL tarefa. Todo o resto sai do documento gravado:
 * quem é o responsável, o título, a prioridade. E o aviso só existe se o banco
 * conta que ESTA pessoa acabou de atribuir a tarefa: a última entrada
 * `atribuida` do rastro da tarefa é a transição, e ela precisa ser de quem está
 * pedindo e recente.
 *
 * A identidade do aviso é a transição (`task_assigned:{tarefa}:{instante da
 * atribuição}`): repetir a mesma chamada é retry e não duplica; atribuir de
 * novo depois é uma transição nova e avisa outra vez.
 */

/** Quanto tempo depois da atribuição o aviso ainda pode ser pedido. Cobre o clique + a rede + um retry; além disso é replay. */
export const JANELA_DA_ATRIBUICAO_MS = 15 * 60_000;

const PRIORIDADES: readonly TaskPriority[] = ["baixa", "media", "alta", "critica"];
const TITULO_MAX = 120;

export type MotivoDeRecusa =
  | "sem_responsavel"
  | "auto_atribuicao"
  | "tarefa_concluida"
  | "sem_transicao"
  | "outra_pessoa_atribuiu"
  | "transicao_antiga";

export type AvaliacaoDaAtribuicao =
  | {
      ok: true;
      responsavel: string;
      /** A identidade do aviso: tarefa + instante da atribuição. */
      dedupeKey: string;
      titulo: string;
      prioridade: TaskPriority;
      prazo?: string;
    }
  | { ok: false; motivo: MotivoDeRecusa };

function ultimaAtribuicao(atividade: TaskAtividade[] | undefined): TaskAtividade | null {
  if (!Array.isArray(atividade)) return null;
  for (let i = atividade.length - 1; i >= 0; i--) {
    if (atividade[i]?.tipo === "atribuida") return atividade[i];
  }
  return null;
}

/**
 * Decide, sobre a tarefa gravada, se `solicitante` pode disparar o aviso agora.
 * Não confia em nada que tenha vindo do navegador.
 */
export function avaliarAtribuicao(
  tarefa: Partial<Task> & { id: string },
  solicitante: string,
  agora: number,
): AvaliacaoDaAtribuicao {
  const eu = solicitante.trim().toLowerCase();
  const responsavel = String(tarefa.assignedTo ?? "").trim().toLowerCase();

  if (!responsavel) return { ok: false, motivo: "sem_responsavel" };
  // Quem se atribuiu uma tarefa já sabe: ela mesma clicou em Salvar.
  if (responsavel === eu) return { ok: false, motivo: "auto_atribuicao" };
  if (tarefa.status === "done") return { ok: false, motivo: "tarefa_concluida" };

  const transicao = ultimaAtribuicao(tarefa.atividade);
  if (!transicao || !Number.isFinite(transicao.em)) return { ok: false, motivo: "sem_transicao" };
  // A atribuição que está no banco tem que ser DE QUEM PEDE o aviso.
  if (String(transicao.por ?? "").trim().toLowerCase() !== eu) return { ok: false, motivo: "outra_pessoa_atribuiu" };
  if (agora - transicao.em > JANELA_DA_ATRIBUICAO_MS || transicao.em - agora > JANELA_DA_ATRIBUICAO_MS) {
    return { ok: false, motivo: "transicao_antiga" };
  }

  const prioridade = PRIORIDADES.includes(tarefa.priority as TaskPriority) ? (tarefa.priority as TaskPriority) : "media";
  const titulo = String(tarefa.title ?? "").trim().slice(0, TITULO_MAX) || "Tarefa";
  const prazo = /^\d{4}-\d{2}-\d{2}$/.test(String(tarefa.dueDate ?? "")) ? String(tarefa.dueDate) : undefined;

  return {
    ok: true,
    responsavel,
    dedupeKey: `task_assigned:${tarefa.id}:${transicao.em}`,
    titulo,
    prioridade,
    prazo,
  };
}
