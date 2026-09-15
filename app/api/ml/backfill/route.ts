import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { syncOrdersRange, syncReturnsRange, type SyncRange } from "@/lib/ml/sync";

export const maxDuration = 60;

/**
 * Backfill do histórico de pedidos, UM MÊS POR CHAMADA.
 *
 * POR QUE EXISTE
 * O sync normal (cron + botão) só cobre o mês corrente e o anterior. Isso
 * deixou o Firestore com ~3,5 meses de histórico, e é a causa raiz da taxa
 * de recompra travada: sem pedido ANTES do período, ninguém pode ser marcado
 * como comprador "frequente" — por definição, não por falta de recompra.
 * Também impede comparar ano a ano e ler sazonalidade.
 *
 * POR QUE UM MÊS POR VEZ, E NÃO TUDO DE UMA VEZ
 * Dois tetos reais, não teóricos:
 *  - a função da Vercel morre em 60s, e cada pedido puxa envio e pagamento;
 *  - o plano Spark do Firestore dá 20 mil ESCRITAS por dia, e este projeto
 *    já esgotou cota antes. Varrer 24 meses de uma vez estouraria os dois.
 * Quem chama controla o ritmo e vê o progresso (ver `proximo` na resposta),
 * em vez de disparar um job cego que falha no meio sem dizer onde parou.
 *
 * IDEMPOTENTE: syncOrdersRange grava por order_id, então repetir um mês
 * reescreve os mesmos documentos em vez de duplicar.
 */

function mesRange(ano: number, mes1a12: number): SyncRange {
  const mm = String(mes1a12).padStart(2, "0");
  const ld = String(new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate()).padStart(2, "0");
  return {
    from: `${ano}-${mm}-01T00:00:00.000-03:00`,
    to: `${ano}-${mm}-${ld}T23:59:59.999-03:00`,
  };
}

/** Mês anterior a (ano, mes) — usado pra apontar o próximo passo do backfill. */
function mesAnterior(ano: number, mes: number): { ano: number; mes: number } {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const hojeBR = new Date(Date.now() - 3 * 3600 * 1000);
    const ano = Number(url.searchParams.get("ano") ?? hojeBR.getUTCFullYear());
    const mes = Number(url.searchParams.get("mes") ?? hojeBR.getUTCMonth() + 1);

    if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return NextResponse.json({ error: "ano/mes inválidos" }, { status: 400 });
    }
    // Mês no futuro não tem o que buscar, e pedir isso costuma ser erro de
    // digitação — melhor recusar do que gastar chamada à toa.
    const limite = hojeBR.getUTCFullYear() * 12 + hojeBR.getUTCMonth() + 1;
    if (ano * 12 + mes > limite) {
      return NextResponse.json({ error: "mês no futuro" }, { status: 400 });
    }

    const accessToken = await getMlAccessToken();
    if (!accessToken) return NextResponse.json({ error: "Token ML não encontrado" }, { status: 400 });

    const range = mesRange(ano, mes);
    const [orders, returns] = await Promise.all([
      syncOrdersRange(accessToken, range),
      // Sem `.catch(() => 0)`: falha aqui virava "zero cancelamentos no mes",
      // e o backfill seguia declarando o mes coberto.
      syncReturnsRange(accessToken, range),
    ]);

    // Quanto do histórico já existe — deixa a tela mostrar progresso real em
    // vez de "rodou, e daí?".
    const db = getAdminDb();
    const total = await db.collection("ml_orders").count().get().catch(() => null);

    const anterior = mesAnterior(ano, mes);
    return NextResponse.json({
      ok: true,
      mes: `${ano}-${String(mes).padStart(2, "0")}`,
      // Quantos gravou E se a busca terminou — um backfill que parou no meio
      // nao pode passar por mes completo.
      orders: orders.gravados,
      returns: returns.gravados,
      completo: orders.completo && returns.completo,
      etapas: [orders, returns],
      totalNoBanco: total?.data().count ?? null,
      // Próximo mês a puxar, pra quem chama encadear sem recalcular data.
      proximo: { ano: anterior.ano, mes: anterior.mes },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "backfill_failed", details: msg }, { status: 500 });
  }
}
