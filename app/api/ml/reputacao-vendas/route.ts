import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getSellerId, resolverTenantDaRequisicao } from "@/lib/tenant";
import { fetchOrdersLive } from "@/lib/ml/orders";
import { montarBlocoVendas } from "@/lib/domain/reputacao-vendas";

export const maxDuration = 60;

/**
 * O bloco "Acompanhamos suas vendas nos últimos N dias" do Seller Center.
 *
 * ─── POR QUE AO VIVO, E NÃO DO BANCO ────────────────────────────────────
 *
 * O sync cobre mês atual + anterior. Uma janela de 60 dias alcança o mês
 * retrasado, e medindo em 22/08 o banco tinha ZERO pedidos de junho — a conta
 * fechava 691 contra 750 do painel. Buscar ao vivo fecha em 763/728/R$ 33.561
 * contra 750/727/R$ 33.377, e a diferença é só o que vendeu entre o print e a
 * consulta.
 *
 * As definições de cada número (três delas contraintuitivas) estão em
 * lib/domain/reputacao-vendas.ts.
 */

// Cache curto por lambda quente: são até 16 páginas do ML por chamada, e o
// painel de Desempenho recarrega a cada troca de aba.
/** Cache POR TENANT: uma variavel unica vazaria a resposta de um cliente pro outro. */
const cache = new Map<string, { at: number; dias: number; body: Record<string, unknown> }>();
const CACHE_TTL = 5 * 60 * 1000;

function diaBR(offset = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offset * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant", bloco: null }, { status: 403 });

  try {
    const url = new URL(req.url);
    // 60 é o que o Mercado Livre usa pra reputação; o parâmetro existe pra o
    // filtro de período da tela reaproveitar a mesma conta.
    const dias = Math.max(1, Math.min(180, Number(url.searchParams.get("dias") ?? 60) || 60));
    const de = url.searchParams.get("from") || diaBR(-dias);
    const ate = url.searchParams.get("to") || diaBR();

    const chave = `${de}|${ate}`;
    const hit = cache.get(tenant.tenantId);
    if (hit && hit.dias === dias && hit.body.chave === chave && Date.now() - hit.at < CACHE_TTL) {
      return NextResponse.json({ ...hit.body, cached: true });
    }

    const token = await getMlAccessToken(tenant.tenantId);
    if (!token) return NextResponse.json({ error: "sem_token", bloco: null }, { status: 200 });

    const pedidos = await fetchOrdersLive(
      await getSellerId(tenant.tenantId),
      token,
      `${de}T00:00:00.000-03:00`,
      `${ate}T23:59:59.999-03:00`,
    );
    if (!pedidos) {
      // null, nunca zeros: "não consegui perguntar" e "não vendeu nada" levam
      // a leituras opostas da reputação.
      return NextResponse.json({ error: "pedidos_indisponiveis", bloco: null, de, ate }, { status: 200 });
    }

    const bloco = montarBlocoVendas(
      pedidos.map((o) => ({
        orderId: String(o.order_id ?? ""),
        status: o.status,
        shippingId: (o.shipping_id as string | null | undefined) ?? null,
        packId: (o.pack_id as string | null | undefined) ?? null,
        total: Number(o.total_amount ?? 0),
      })),
    );

    const body = { bloco, de, ate, dias, chave };
    cache.set(tenant.tenantId, { at: Date.now(), dias, body });
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "reputacao_vendas_failed", details: msg, bloco: null }, { status: 500 });
  }
}
