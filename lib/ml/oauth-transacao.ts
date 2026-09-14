import "server-only";
import crypto from "crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { generatePkce, getAuthURL } from "@/lib/ml/client";
import { avaliarTransacao } from "@/lib/domain/oauth-estado";

/**
 * A transação OAuth — o que amarra quem PEDIU o vínculo a quem VOLTA dele.
 *
 * ─── O QUE FALTAVA ──────────────────────────────────────────────────────
 *
 * O início do fluxo era `GET /api/ml/auth`, público: qualquer pessoa na
 * internet abria a URL, era mandada ao Mercado Livre e voltava no callback.
 * O callback aceitava o `code` e gravava em `ml_tokens/main` — o documento
 * ÚNICO que todo o app usa — sem validar nada:
 *
 *   · sem autorização de administrador pra começar;
 *   · sem `state`, então nada ligava a volta ao pedido;
 *   · sem conferir QUAL vendedor autorizou.
 *
 * Na prática, um estranho podia ligar a CONTA DELE no painel da VAZXPRESS, e
 * o app passaria a sincronizar pedidos de outra loja. Ou, ao contrário, um
 * link de callback forjado sequestrava a sessão OAuth de quem estava
 * conectando.
 *
 * ─── COMO FICA ──────────────────────────────────────────────────────────
 *
 * O owner pede o vínculo (POST autenticado). O servidor cria esta transação
 * — `state` aleatório, PKCE, prazo e dono — e só então devolve a URL. Na
 * volta, o callback exige o `state`, consome a transação uma única vez
 * (transação do Firestore, então duas voltas simultâneas não passam as duas)
 * e confere o vendedor antes de substituir a conexão.
 *
 * O PKCE continua: o `verifier` mora aqui, no servidor, em vez de num cookie
 * — some o risco de o cookie vazar e não depende do navegador manter o
 * cookie durante o redirecionamento.
 */

const COLECAO = "ml_oauth_transacoes";
/** Dez minutos: tempo de sobra pra autorizar, curto pra um link vazado servir. */
const VALIDADE_MS = 10 * 60 * 1000;

export type TransacaoConsumida = {
  verifier: string;
  solicitante: string;
};

/** Cria a transação e devolve a URL de autorização já com o `state`. */
export async function criarTransacao(solicitante: string): Promise<{ state: string; url: string }> {
  const state = crypto.randomBytes(32).toString("base64url");
  const { verifier, challenge } = generatePkce();
  const agora = Date.now();

  await getAdminDb().collection(COLECAO).doc(state).set({
    solicitante,
    verifier,
    criadoEm: agora,
    expiraEm: agora + VALIDADE_MS,
    usado: false,
  });

  return { state, url: getAuthURL(challenge, state) };
}

/**
 * Consome a transação — uma vez só.
 *
 * A marcação de uso acontece DENTRO de uma transação do Firestore: duas
 * voltas simultâneas com o mesmo `state` (retry do navegador, link clicado
 * duas vezes) não podem passar as duas.
 *
 * @throws o motivo da recusa (ver `MotivoRecusa` em lib/domain/oauth-estado).
 */
export async function consumirTransacao(state: string | null): Promise<TransacaoConsumida> {
  if (!state) throw new Error("state_ausente");

  const db = getAdminDb();
  const ref = db.collection(COLECAO).doc(state);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const veredito = avaliarTransacao(snap.exists ? (snap.data() ?? {}) : null, Date.now());
    if (!veredito.ok) throw new Error(veredito.motivo);

    // Marca como usada DENTRO da transacao: e isso que impede a segunda volta.
    tx.update(ref, { usado: true, usadoEm: Date.now() });
    return { verifier: veredito.verifier, solicitante: veredito.solicitante };
  });
}

/**
 * Remove transações vencidas. Chamado quando uma nova é criada — não vale um
 * cron próprio, e sem limpeza a coleção só cresce.
 */
export async function limparVencidas(limite = 50): Promise<number> {
  try {
    const db = getAdminDb();
    const velhas = await db.collection(COLECAO)
      .where("expiraEm", "<", Date.now())
      .limit(limite)
      .get();
    if (velhas.empty) return 0;
    const lote = db.batch();
    velhas.docs.forEach((d) => lote.delete(d.ref));
    await lote.commit();
    return velhas.size;
  } catch {
    // Limpeza é manutenção: falhar aqui não pode derrubar o vínculo.
    return 0;
  }
}
