/**
 * A regra da transação OAuth, separada do Firestore pra poder ser testada.
 *
 * O valor está aqui: a decisão de aceitar ou recusar uma volta do Mercado
 * Livre é o que separa "o dono religou a conta" de "um estranho ligou a conta
 * dele no painel da VAZXPRESS". Deixar isso preso dentro de uma transação do
 * Firestore significaria não conseguir testar nenhum dos casos de recusa.
 */

export type MotivoRecusa =
  | "state_ausente"
  | "state_desconhecido"
  | "state_ja_usado"
  | "state_expirado"
  | "transacao_incompleta";

export type Veredito =
  | { ok: true; verifier: string; solicitante: string }
  | { ok: false; motivo: MotivoRecusa };

/** O que o documento da transação guarda. `null` = documento inexistente. */
export type DocTransacao = {
  verifier?: unknown;
  solicitante?: unknown;
  expiraEm?: unknown;
  usado?: unknown;
} | null;

/**
 * Decide se esta volta pode substituir a conexão.
 *
 * Recusa é o padrão: só passa o que satisfaz todas as condições. Um documento
 * sem `verifier` é recusado em vez de seguir com string vazia — o PKCE vazio
 * derrubaria a troca no ML de qualquer jeito, e o erro ficaria ilegível.
 */
export function avaliarTransacao(doc: DocTransacao, agora: number): Veredito {
  if (!doc) return { ok: false, motivo: "state_desconhecido" };
  if (doc.usado === true) return { ok: false, motivo: "state_ja_usado" };

  // Sem prazo legível, trata como vencida: um documento torto não vale acesso.
  if (typeof doc.expiraEm !== "number" || !Number.isFinite(doc.expiraEm)) {
    return { ok: false, motivo: "state_expirado" };
  }
  if (agora > doc.expiraEm) return { ok: false, motivo: "state_expirado" };

  const verifier = typeof doc.verifier === "string" ? doc.verifier : "";
  if (!verifier) return { ok: false, motivo: "transacao_incompleta" };

  const solicitante = typeof doc.solicitante === "string" ? doc.solicitante : "";
  return { ok: true, verifier, solicitante };
}

/** Texto pra tela, a partir do motivo que volta na URL. */
export function explicarRecusa(motivo: string): string {
  switch (motivo) {
    case "state_ausente":
    case "state_desconhecido":
      return "A conexão não começou por aqui. Clique em Conectar Mercado Livre dentro do app.";
    case "state_ja_usado":
      return "Esse link de conexão já foi usado. Clique em Conectar Mercado Livre de novo.";
    case "state_expirado":
      return "O pedido de conexão expirou. Clique em Conectar Mercado Livre de novo.";
    case "transacao_incompleta":
      return "O pedido de conexão ficou incompleto. Tente conectar de novo.";
    case "code_ausente":
      return "O Mercado Livre não devolveu a autorização. Tente conectar de novo.";
    case "perfil_indisponivel":
      return "Não deu para confirmar qual conta autorizou. A conexão atual foi mantida.";
    case "vendedor_inesperado":
      return "A conta autorizada no Mercado Livre não é a da VAZXPRESS. A conexão atual foi mantida.";
    default:
      return "Não foi possível concluir a conexão com o Mercado Livre.";
  }
}
