import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";
import { estadoDoPedido } from "@/lib/domain/estado-do-pedido";
import { gravarPedidos } from "@/lib/ml/gravar-pedido";

export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const adminDb = getAdminDb();
    const accessToken = await getMlAccessToken();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token do Mercado Livre não encontrado ou expirado" },
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://api.mercadolibre.com/orders/search?seller=me",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "Erro ao buscar pedidos", details: text },
        { status: response.status }
      );
    }

    const data = (await response.json()) as { results?: Record<string, unknown>[] };
    const results = data.results ?? [];

    /**
     * O mesmo estado e a mesma guarda de versão do sync e do webhook (S12).
     *
     * Esta rota tinha mapeamento próprio, e ele DESTRUÍA dado: itens sem
     * `item_id` nem `sale_fee` (o vínculo com o produto e a taxa do ML — a
     * margem desses pedidos virava outra), `shipping_status: null` por cima do
     * status real do envio (a busca não traz o status), e `raw` com o pedido
     * inteiro, dados do comprador inclusive, que nada no app lia.
     */
    await gravarPedidos(adminDb, results.map((order) => ({
      orderId: String(order.id),
      estado: estadoDoPedido(order),
    })));

    return NextResponse.json({
      ok: true,
      saved: results.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao sincronizar pedidos", details: msg },
      { status: 500 }
    );
  }
}