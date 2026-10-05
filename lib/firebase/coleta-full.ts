import { traduzirCaminho } from "./caminhos";
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { remessaDoMovimento } from "@/lib/domain/remessa-agrupada";
import type { BaixaDeRemessa, CustoGuardado } from "@/lib/domain/coleta-full";

/**
 * O que o Firestore já sabe da coleta pro Full — a metade da DRE que NÃO
 * depende do Mercado Livre estar respondendo (ver lib/domain/coleta-full.ts).
 *
 *   · `full_remessas`       → custo digitado (+ a data da remessa, quando salva);
 *   · `estoque_movimentos`  → as baixas `full-{remessa}-{produto}`, cuja data é a
 *                             da remessa.
 *
 * Injetável (`db`) pra ser testado contra o emulador — o `getFirebase()` do app
 * exige `window`.
 *
 * ─── POR QUE DUAS LEITURAS DE BAIXA ─────────────────────────────────────
 *
 * 1. As do PERÍODO (`data` entre from e to — consulta de campo único, sem
 *    índice composto): remessas que tiveram baixa neste intervalo.
 * 2. As das remessas com custo digitado e SEM data salva, buscadas pelo id
 *    (`full-{remessa}-…`): sem isto, um custo antigo cuja baixa caiu em OUTRO
 *    mês seria acusado de "sem data" em todo período, embora a data exista.
 */

const ESCAPE_DO_ID = "";

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type DocBaixa = { id: string; data: () => Record<string, unknown> };

function paraBaixa(d: DocBaixa): BaixaDeRemessa | null {
  const x = d.data();
  if (x.tipo !== "saida_full") return null;
  const remessa = remessaDoMovimento(d.id, String(x.productId ?? ""));
  const data = typeof x.data === "string" ? x.data : "";
  if (!remessa || !data) return null;
  return { remessa, data, unidades: Math.max(0, numero(x.quantidade) ?? 0) };
}

export async function lerFonteDaColeta(
  db: Firestore,
  periodo: { from: string; to: string },
): Promise<{ guardados: CustoGuardado[]; baixas: BaixaDeRemessa[] }> {
  const remessasSnap = await getDocs(collection(db, traduzirCaminho("full_remessas")));
  const guardados: CustoGuardado[] = remessasSnap.docs.map((d) => {
    const x = d.data();
    return {
      remessa: d.id,
      custoManual: numero(x.custoManual),
      data: typeof x.data === "string" ? x.data : null,
      recebido: numero(x.recebido),
    };
  });

  const colMov = collection(db, traduzirCaminho("estoque_movimentos"));
  const doPeriodo = await getDocs(query(colMov, where("data", ">=", periodo.from), where("data", "<=", periodo.to)));
  const baixas = new Map<string, BaixaDeRemessa>();
  const guardar = (d: DocBaixa) => {
    const b = paraBaixa(d);
    if (b) baixas.set(d.id, b);
  };
  doPeriodo.docs.forEach(guardar);

  // Custos digitados sem data: procura a baixa deles em qualquer mês.
  const semData = guardados.filter((g) => g.custoManual != null && !g.data && !hasBaixa(baixas, g.remessa));
  await Promise.all(semData.map(async (g) => {
    const prefixo = `full-${g.remessa}-`;
    const snap = await getDocs(query(
      colMov,
      where(documentId(), ">=", prefixo),
      where(documentId(), "<=", prefixo + ESCAPE_DO_ID),
    ));
    snap.docs.forEach(guardar);
  }));

  return { guardados, baixas: [...baixas.values()] };
}

function hasBaixa(baixas: Map<string, BaixaDeRemessa>, remessa: string): boolean {
  for (const b of baixas.values()) if (b.remessa === remessa) return true;
  return false;
}
