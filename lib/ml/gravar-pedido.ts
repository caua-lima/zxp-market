import "server-only";
import { podeGravarEstado, versaoDoPedido, type MotivoEstado } from "@/lib/domain/estado-do-pedido";

export type PedidoParaGravar = {
  orderId: string;
  /** O estado do pedido (estadoDoPedido) — só é gravado se o retrato não for mais velho que o do documento. */
  estado: Record<string, unknown>;
  /** O que vem de outras APIs (envio, Mercado Pago): gravado sempre. */
  complemento?: Record<string, unknown>;
};

export type ResultadoGravacao = {
  orderId: string;
  gravouEstado: boolean;
  motivo: MotivoEstado;
  /** O documento como estava ANTES desta gravação — lido na mesma transação. */
  antes: FirebaseFirestore.DocumentData | undefined;
};

/**
 * Pedidos por transação. Menor que o lote de 400 do batch antigo: a transação
 * trava os documentos que leu, e um webhook que chega no meio espera por ela.
 */
const POR_TRANSACAO = 100;

/**
 * Grava pedidos em `ml_orders` sem deixar um retrato velho cobrir um novo (S12).
 *
 * Ler a versão e gravar na MESMA transação é o que fecha a corrida: uma leitura
 * fora dela daria a janela exata entre "conferi que o meu é mais novo" e
 * "gravei", e é nessa janela que o webhook grava o cancelamento.
 *
 * Nenhuma chamada de rede dentro da transação — o Firestore reexecuta o
 * callback quando há contenção, e o que se busca no ML é buscado antes.
 */
export async function gravarPedidos(
  db: FirebaseFirestore.Firestore,
  pedidos: PedidoParaGravar[],
): Promise<ResultadoGravacao[]> {
  /**
   * Um id só uma vez. A busca do ML pagina por offset, e um pedido novo que
   * entra no meio empurra o resto: o mesmo pedido pode vir em duas páginas.
   * Duas gravações do mesmo documento na mesma transação seriam decididas
   * contra a mesma leitura — fica o retrato mais novo.
   */
  const porId = new Map<string, PedidoParaGravar>();
  for (const p of pedidos) {
    const ja = porId.get(p.orderId);
    const vNovo = versaoDoPedido(p.estado.last_updated) ?? -Infinity;
    const vJa = ja ? versaoDoPedido(ja.estado.last_updated) ?? -Infinity : -Infinity;
    if (!ja || vNovo >= vJa) porId.set(p.orderId, p);
  }
  const unicos = [...porId.values()];

  const resultados: ResultadoGravacao[] = [];
  for (let i = 0; i < unicos.length; i += POR_TRANSACAO) {
    const lote = unicos.slice(i, i + POR_TRANSACAO);
    const refs = lote.map((p) => db.collection("ml_orders").doc(p.orderId));

    const doLote = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...refs);
      const saida: ResultadoGravacao[] = [];
      lote.forEach((p, k) => {
        const antes = snaps[k].exists ? snaps[k].data() : undefined;
        const { gravar, motivo } = podeGravarEstado(versaoDoPedido(p.estado.last_updated), antes?.last_updated);
        const dados = { ...(p.complemento ?? {}), ...(gravar ? p.estado : {}) };
        // Retrato velho e nada de outra API: não há o que gravar, e tocar o
        // documento só mudaria o `updatedAt` de algo que não mudou.
        if (Object.keys(dados).length > 0) {
          tx.set(refs[k], { ...dados, updatedAt: new Date().toISOString() }, { merge: true });
        }
        saida.push({ orderId: p.orderId, gravouEstado: gravar, motivo, antes });
      });
      return saida;
    });
    resultados.push(...doLote);
  }
  return resultados;
}
