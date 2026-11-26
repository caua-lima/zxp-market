import "server-only";
import { origemDaSeparacao, type PedidoParaOrigem } from "@/lib/domain/separacao-pacote";

/**
 * Pedidos nascidos de SEPARAÇÃO DE PACOTE herdam a data da compra — ver
 * `origemDaSeparacao` (lib/domain/separacao-pacote.ts) pro porquê e pra regra.
 *
 * Roda depois de cada gravação de pedidos (sync, webhook, rota de pedidos):
 * pega os pedidos da separação ainda não resolvidos, acha o original pelo
 * comprador e grava, no pedido novo:
 *   · `date_created`      ← a data da compra (o que o resto do app lê);
 *   · `date_created_ml`   ← a hora da separação, como o ML mandou;
 *   · `separado_de`       ← os pedidos originais;
 *   · `pack_original`     ← o pacote da compra (pra lista juntar os envios);
 *   · `separacao_resolvida: true`.
 *
 * Se o original ainda não chegou (o webhook do pedido novo pode vir antes do
 * cancelamento), tenta de novo na próxima rodada. Depois de 7 dias sem achar,
 * desiste e marca `separacao_sem_origem` — a venda fica no dia do ML, como era.
 *
 * Idempotente: pedido já resolvido não é tocado; a data herdada é protegida
 * nas regravações por `manterDataHerdada` (lib/ml/gravar-pedido.ts).
 */
const DESISTE_APOS_MS = 7 * 86400000;

type Doc = FirebaseFirestore.DocumentData;

function paraOrigem(id: string, d: Doc): PedidoParaOrigem {
  return {
    orderId: id,
    buyerId: d.buyer_id ?? null,
    status: d.status,
    motivoCancelamento: d.motivo_cancelamento ?? null,
    canceladoEm: d.cancelado_em ?? null,
    dateCreated: String(d.date_created ?? ""),
    packId: d.pack_id ? String(d.pack_id) : null,
    itens: (Array.isArray(d.items) ? d.items : []).map((it: { item_id?: unknown }) => String(it?.item_id ?? "")),
  };
}

export async function herdarDatasDaSeparacao(
  db: FirebaseFirestore.Firestore,
  /** Restringe aos pedidos recém-gravados (webhook). Sem isto, varre todos os pendentes. */
  somente?: string[],
): Promise<{ resolvidos: number; pendentes: number }> {
  let docs: FirebaseFirestore.DocumentSnapshot[];
  if (somente) {
    if (!somente.length) return { resolvidos: 0, pendentes: 0 };
    docs = (await db.getAll(...somente.map((id) => db.collection("ml_orders").doc(id)))).filter((s) => s.exists && s.get("pedido_da_separacao") === true);
  } else {
    docs = (await db.collection("ml_orders").where("pedido_da_separacao", "==", true).get()).docs;
  }
  const pendentes = docs.filter((s) => s.get("separacao_resolvida") !== true && !s.get("date_created_ml"));

  let resolvidos = 0;
  let aindaPendentes = 0;
  const porComprador = new Map<string, PedidoParaOrigem[]>();
  for (const s of pendentes) {
    const d = s.data() as Doc;
    const comprador = String(d.buyer_id ?? "").trim();
    if (!comprador) { aindaPendentes += 1; continue; }
    if (!porComprador.has(comprador)) {
      const q = await db.collection("ml_orders").where("buyer_id", "==", comprador).get();
      porComprador.set(comprador, q.docs.map((x) => paraOrigem(x.id, x.data())));
    }
    const origem = origemDaSeparacao(
      { buyerId: comprador, dateCreated: String(d.date_created ?? ""), itens: paraOrigem(s.id, d).itens },
      porComprador.get(comprador)!,
    );
    const ref = db.collection("ml_orders").doc(s.id);
    if (origem) {
      await db.runTransaction(async (tx) => {
        const atual = await tx.get(ref);
        if (!atual.exists || atual.get("date_created_ml")) return; // outra rodada já resolveu
        tx.set(ref, {
          date_created: origem.dateCreated,
          date_created_ml: String(atual.get("date_created") ?? ""),
          separado_de: origem.pedidos,
          ...(origem.packId ? { pack_original: origem.packId } : {}),
          separacao_resolvida: true,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      });
      resolvidos += 1;
    } else if (Date.now() - Date.parse(String(d.date_created ?? "")) > DESISTE_APOS_MS) {
      await ref.set({ separacao_resolvida: true, separacao_sem_origem: true }, { merge: true });
    } else {
      aindaPendentes += 1;
    }
  }
  return { resolvidos, pendentes: aindaPendentes };
}
